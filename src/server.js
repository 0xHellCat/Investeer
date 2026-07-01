const express = require('express');
const dotenv = require('dotenv');
dotenv.config();

// Parse cookie helper
function getCookie(req, name) {
  const rc = req.headers.cookie;
  if (!rc) return null;
  const list = {};
  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const k = parts.shift().trim();
    try {
      list[k] = decodeURIComponent(parts.join('='));
    } catch (e) {
      list[k] = parts.join('=');
    }
  });
  return list[name];
}

// Custom page/session authentication middleware
function authMiddleware(req, res, next) {
  const isDashboard = req.path === '/' || req.path === '/index.html';
  const isConfig = req.path === '/config.html';
  const isApi = req.path.startsWith('/api/');

  // Skip auth for login page or public resources
  if (req.path === '/login.html' || req.path === '/style.css' || req.path === '/app.js' || req.path === '/api/login') {
    return next();
  }

  const dashAuth = getCookie(req, 'dashboard_auth');
  const confAuth = getCookie(req, 'config_auth');

  const dashboardPass = process.env.DASHBOARD_PASSWORD;
  const configPass = process.env.CONFIG_PASSWORD;

  const isDashAuthed = dashboardPass && dashAuth === dashboardPass;
  const isConfAuthed = configPass && confAuth === configPass;

  // Protect Dashboard HTML
  if (isDashboard) {
    if (isDashAuthed) return next();
    return res.redirect('/login.html');
  }

  // Protect Config HTML
  if (isConfig) {
    if (isConfAuthed) return next();
    return res.redirect('/login.html');
  }

  // Protect API endpoints
  if (isApi) {
    const configEndpoints = ['/api/config', '/api/trigger', '/api/test-email', '/api/logs'];
    const isConfigEndpoint = configEndpoints.some(p => req.path.startsWith(p));

    if (isConfigEndpoint) {
      if (isConfAuthed) return next();
      return res.status(401).json({ success: false, message: 'Accès non autorisé à la configuration.' });
    } else {
      if (isDashAuthed || isConfAuthed) return next();
      return res.status(401).json({ success: false, message: 'Non authentifié.' });
    }
  }

  return next();
}

const fs = require('fs');
const path = require('path');
const Scraper = require('./scraper');
const Emailer = require('./emailer');

class Server {
  constructor(configPath) {
    this.configPath = configPath;
    this.workspaceDir = path.dirname(configPath);
    this.seenPath = path.join(this.workspaceDir, 'database', 'seen_posts.json');
    this.matchesPath = path.join(this.workspaceDir, 'database', 'matches.json');
    this.logs = [];
    this.isScraping = false;
    this.lastRunTime = null;
    this.nextRunTime = null;
    this.app = express();
    this.app.use(express.json());
    this.app.use(authMiddleware);
    this.app.use(express.static(path.join(this.workspaceDir, 'public')));
    
    this.setupRoutes();
    this.initScheduler();
    
    // Trigger initial market prices update in background on startup
    this.updateAllPrices().catch(err => this.log(`Erreur lors de la mise à jour initiale des cours : ${err.message}`));
  }

  // Logger helper
  log(message) {
    const timestamp = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' });
    const formatted = `[${timestamp} CET] ${message}`;
    console.log(formatted);
    this.logs.push(formatted);
    // Keep only last 500 logs
    if (this.logs.length > 500) {
      this.logs.shift();
    }
  }

  // Load configs
  getConfig() {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (e) {
      return {};
    }
  }

  // Save configs
  saveConfig(config) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  // Save sensitive environment configurations
  saveEnvConfig(envVars) {
    const envPath = path.join(this.workspaceDir, '.env');
    let content = '';
    try {
      content = fs.readFileSync(envPath, 'utf8');
    } catch (e) {
      // If .env doesn't exist yet, we start fresh
    }

    const lines = content.split('\n');
    const updatedKeys = new Set();
    const newLines = [];

    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        newLines.push(line);
        continue;
      }
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        if (envVars.hasOwnProperty(key)) {
          newLines.push(`${key}=${envVars[key]}`);
          updatedKeys.add(key);
        } else {
          newLines.push(line);
        }
      } else {
        newLines.push(line);
      }
    }

    for (const key of Object.keys(envVars)) {
      if (!updatedKeys.has(key)) {
        newLines.push(`${key}=${envVars[key]}`);
      }
    }

    fs.writeFileSync(envPath, newLines.join('\n'));

    // Also update process.env globally so the app uses the new values immediately
    for (const [key, val] of Object.entries(envVars)) {
      process.env[key] = val;
    }
  }

  // Helper to get current Date object in Paris timezone
  getParisTime() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    
    // Parse parts manually
    const parts = formatter.formatToParts(now);
    const getPart = name => parseInt(parts.find(p => p.type === name).value);
    
    return {
      year: getPart('year'),
      month: getPart('month') - 1, // JS Month is 0-indexed
      day: getPart('day'),
      hour: getPart('hour'),
      minute: getPart('minute'),
      dateStr: `${getPart('year')}-${String(getPart('month')).padStart(2, '0')}-${String(getPart('day')).padStart(2, '0')}`
    };
  }

  // Helper to check if current Paris time is within Paris trading hours (Weekdays 9h to 17h30)
  isParisTradingHours() {
    const pt = this.getParisTime();
    const parisDate = new Date(pt.year, pt.month, pt.day, pt.hour, pt.minute, 0);
    const day = parisDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // Weekdays check (Monday = 1, ..., Friday = 5)
    if (day < 1 || day > 5) return false;

    // Time check (9:00 - 17:30)
    const timeMinutes = pt.hour * 60 + pt.minute;
    const startMinutes = 9 * 60;
    const endMinutes = 17 * 60 + 30;

    return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
  }

  // Calculate next run time based on user requirements
  calculateNextRunTime() {
    const pt = this.getParisTime();
    const currentParisDate = new Date(pt.year, pt.month, pt.day, pt.hour, pt.minute, 0);
    
    // Weekend check (Saturday = 6, Sunday = 0)
    const dayOfWeek = currentParisDate.getDay();
    if (dayOfWeek === 6 || dayOfWeek === 0) {
      const daysToAdd = dayOfWeek === 6 ? 2 : 1;
      const nextMonday = new Date(pt.year, pt.month, pt.day + daysToAdd, 8, 3, 0);
      const dateStr = nextMonday.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      this.log(`Week-end détecté. Prochain scan planifié pour le ${dateStr} à 08h03 CET.`);
      return nextMonday;
    }

    const run1Today = new Date(pt.year, pt.month, pt.day, 8, 3, 0);
    const run2Today = new Date(pt.year, pt.month, pt.day, 8, 40, 0);
    const endToday = new Date(pt.year, pt.month, pt.day, 19, 0, 0);
    
    let nextRun;

    if (currentParisDate < run1Today) {
      // Before 8h03: next is 8h03 today
      nextRun = run1Today;
      this.log(`Next run scheduled for today at 08h03 CET.`);
    } else if (currentParisDate < run2Today) {
      // Between 8h03 and 8h40: next is 8h40 today
      nextRun = run2Today;
      this.log(`Next run scheduled for today at 08h40 CET.`);
    } else if (currentParisDate < endToday) {
      // Between 8h40 and 19h00: run in a random interval between 5 and 15 minutes
      const intervalMinutes = Math.floor(Math.random() * 11) + 5; // [5, 15] minutes
      nextRun = new Date(currentParisDate.getTime() + intervalMinutes * 60 * 1000);
      
      // If the randomized next run crosses 19h00, push to tomorrow 8h03
      if (nextRun > endToday) {
        const tomorrow = new Date(pt.year, pt.month, pt.day + 1, 8, 3, 0);
        nextRun = tomorrow;
        this.log(`Random interval crossed 19h00. Next run scheduled for tomorrow at 08h03 CET.`);
      } else {
        const timeStr = nextRun.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        this.log(`Next run scheduled for today at ${timeStr} CET (interval of ${intervalMinutes} minutes).`);
      }
    } else {
      // After 19h00: next is 8h03 tomorrow
      const tomorrow = new Date(pt.year, pt.month, pt.day + 1, 8, 3, 0);
      nextRun = tomorrow;
      this.log(`Current time is past 19h00. Next run scheduled for tomorrow at 08h03 CET.`);
    }

    // Verify if nextRun lands on a weekend, if so, defer to Monday 8h03
    const nextRunDay = nextRun.getDay();
    if (nextRunDay === 6) { // Saturday
      nextRun = new Date(nextRun.getFullYear(), nextRun.getMonth(), nextRun.getDate() + 2, 8, 3, 0);
      this.log(`Next run target landed on Saturday. Deferred to Monday at 08h03 CET.`);
    } else if (nextRunDay === 0) { // Sunday
      nextRun = new Date(nextRun.getFullYear(), nextRun.getMonth(), nextRun.getDate() + 1, 8, 3, 0);
      this.log(`Next run target landed on Sunday. Deferred to Monday at 08h03 CET.`);
    }

    return nextRun;
  }

  // Initial Scheduler setting
  initScheduler() {
    this.nextRunTime = this.calculateNextRunTime();
    
    // Start interval ticking every 30 seconds to check if we should run
    setInterval(() => this.checkScheduler(), 30000);
    
    // Start interval to update stock market prices every 10 minutes (600,000 ms)
    setInterval(() => {
      this.updateAllPrices().catch(err => this.log(`Erreur lors de la mise à jour périodique des cours : ${err.message}`));
    }, 600000);
    
    this.log(`Scheduler initialized. Waiting for next run.`);
  }

  // Check if we should trigger the scraper
  async checkScheduler() {
    if (this.isScraping || !this.nextRunTime) return;

    const pt = this.getParisTime();
    const currentParisDate = new Date(pt.year, pt.month, pt.day, pt.hour, pt.minute, 0);

    if (currentParisDate >= this.nextRunTime) {
      this.log(`Scheduled time reached (${this.nextRunTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}). Starting automatic check...`);
      await this.triggerScrape();
    }
  }

  // Core execution flow
  async triggerScrape() {
    if (this.isScraping) {
      this.log('Check already in progress. Skipping...');
      return { success: false, message: 'Scraping already in progress.' };
    }

    this.isScraping = true;
    this.lastRunTime = new Date();
    
    try {
      const scraper = new Scraper(this.configPath);
      const emailer = new Emailer(this.configPath);

      // Run scraper
      const result = await scraper.run(msg => this.log(msg));
      const extractedPosts = result.posts || [];

      // Load database files
      let seenIds = [];
      try {
        seenIds = JSON.parse(fs.readFileSync(this.seenPath, 'utf8'));
      } catch (e) {
        seenIds = [];
      }

      let matches = [];
      try {
        matches = JSON.parse(fs.readFileSync(this.matchesPath, 'utf8'));
      } catch (e) {
        matches = [];
      }

      const newMatches = [];
      const updatedSeenIds = [...seenIds];

      extractedPosts.forEach(post => {
        // If not seen before, add it to seen
        if (!updatedSeenIds.includes(post.id)) {
          updatedSeenIds.push(post.id);
          
          // If it matches target keywords, process it
          if (post.isMatch) {
            this.log(`🔥 NEW MATCH DETECTED: "${post.title}" (Link: ${post.url})`);
            
            const matchRecord = {
              ...post,
              detectedAt: new Date().toISOString(),
              emailSent: false,
              emailError: null
            };
            
            newMatches.push(matchRecord);
            matches.push(matchRecord);
          }
        }
      });

      // Save updated databases
      fs.writeFileSync(this.seenPath, JSON.stringify(updatedSeenIds, null, 2));
      fs.writeFileSync(this.matchesPath, JSON.stringify(matches, null, 2));

      // Update market prices and target status for matches
      this.updateAllPrices().catch(err => this.log(`Erreur lors de la mise à jour des cours suite au scan : ${err.message}`));

      // Send emails for new matches if any
      if (newMatches.length > 0) {
        this.log(`Sending email alerts for ${newMatches.length} new matches...`);
        const emailResult = await emailer.sendAlert(newMatches);
        
        // Update email status in matches database
        let updatedMatches = JSON.parse(fs.readFileSync(this.matchesPath, 'utf8'));
        newMatches.forEach(nm => {
          const match = updatedMatches.find(m => m.id === nm.id);
          if (match) {
            match.emailSent = emailResult.success;
            if (!emailResult.success) {
              match.emailError = emailResult.message;
            }
          }
        });
        fs.writeFileSync(this.matchesPath, JSON.stringify(updatedMatches, null, 2));
        this.log(`Emails dispatched. Status: ${emailResult.message}`);
      } else {
        this.log('No new matches found in this run.');
      }

      this.log('Check completed successfully.');
    } catch (err) {
      this.log(`CRITICAL SCHEDULER ERROR: ${err.message}`);
    } finally {
      this.isScraping = false;
      this.nextRunTime = this.calculateNextRunTime();
    }

    return { success: true, message: 'Check completed.' };
  }

  // Express API routing
  setupRoutes() {
    // POST /api/login
    this.app.post('/api/login', (req, res) => {
      const { password } = req.body;
      const dashboardPass = process.env.DASHBOARD_PASSWORD;
      const configPass = process.env.CONFIG_PASSWORD;

      if (configPass && password === configPass) {
        // Admin gets access to both config and dashboard
        res.cookie('config_auth', password, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, path: '/' });
        res.cookie('dashboard_auth', dashboardPass || '', { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, path: '/' });
        return res.json({ success: true, redirect: '/config.html' });
      }

      if (dashboardPass && password === dashboardPass) {
        // Standard user gets access only to dashboard
        res.cookie('dashboard_auth', password, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, path: '/' });
        return res.json({ success: true, redirect: '/index.html' });
      }

      return res.json({ success: false, message: 'Mot de passe incorrect.' });
    });

    // GET /api/status
    this.app.get('/api/status', (req, res) => {
      let seenCount = 0;
      try {
        seenCount = JSON.parse(fs.readFileSync(this.seenPath, 'utf8')).length;
      } catch (e) {}

      let matchesCount = 0;
      try {
        matchesCount = JSON.parse(fs.readFileSync(this.matchesPath, 'utf8')).length;
      } catch (e) {}

      res.json({
        isScraping: this.isScraping,
        lastRunTime: this.lastRunTime ? this.lastRunTime.toISOString() : null,
        nextRunTime: this.nextRunTime ? this.nextRunTime.toISOString() : null,
        seenCount,
        matchesCount,
        serverTime: new Date().toISOString()
      });
    });

    // GET /api/posts
    this.app.get('/api/posts', (req, res) => {
      try {
        const matches = JSON.parse(fs.readFileSync(this.matchesPath, 'utf8'));
        // Sort by publication date descending (most recent first)
        matches.sort((a, b) => {
          const dateA = a.publicationDate ? new Date(a.publicationDate) : 0;
          const dateB = b.publicationDate ? new Date(b.publicationDate) : 0;
          return dateB - dateA;
        });
        res.json(matches);
      } catch (e) {
        res.json([]);
      }
    });

    // GET /api/config
    this.app.get('/api/config', (req, res) => {
      const config = this.getConfig();
      
      const mergedConfig = {
        investirUsername: process.env.INVESTIR_USERNAME || config.investirUsername || '',
        investirPassword: process.env.INVESTIR_PASSWORD || config.investirPassword || '',
        emailRecipient: process.env.EMAIL_RECIPIENT || config.emailRecipient || '',
        smtp: {
          host: process.env.SMTP_HOST || (config.smtp && config.smtp.host) || '',
          port: process.env.SMTP_PORT || (config.smtp && config.smtp.port) || 587,
          secure: process.env.SMTP_SECURE !== undefined ? (process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === true) : (config.smtp && config.smtp.secure) || false,
          user: process.env.SMTP_USER || (config.smtp && config.smtp.user) || '',
          pass: process.env.SMTP_PASS || (config.smtp && config.smtp.pass) || '',
          from: process.env.SMTP_FROM || (config.smtp && config.smtp.from) || ''
        },
        keywords: config.keywords || [],
        timezone: config.timezone || 'Europe/Paris'
      };

      // Mask password for safety
      const safeConfig = {
        ...mergedConfig,
        investirPassword: mergedConfig.investirPassword ? '********' : '',
        smtp: {
          ...mergedConfig.smtp,
          pass: mergedConfig.smtp.pass ? '********' : ''
        }
      };
      res.json(safeConfig);
    });

    // POST /api/config
    this.app.post('/api/config', (req, res) => {
      const config = this.getConfig();
      const currentMerged = {
        investirUsername: process.env.INVESTIR_USERNAME || config.investirUsername || '',
        investirPassword: process.env.INVESTIR_PASSWORD || config.investirPassword || '',
        emailRecipient: process.env.EMAIL_RECIPIENT || config.emailRecipient || '',
        smtp: {
          host: process.env.SMTP_HOST || (config.smtp && config.smtp.host) || '',
          port: process.env.SMTP_PORT || (config.smtp && config.smtp.port) || 587,
          secure: process.env.SMTP_SECURE !== undefined ? (process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === true) : (config.smtp && config.smtp.secure) || false,
          user: process.env.SMTP_USER || (config.smtp && config.smtp.user) || '',
          pass: process.env.SMTP_PASS || (config.smtp && config.smtp.pass) || '',
          from: process.env.SMTP_FROM || (config.smtp && config.smtp.from) || ''
        },
        keywords: config.keywords || [],
        timezone: config.timezone || 'Europe/Paris'
      };

      const submitted = req.body;

      // Handle masked passwords
      let newInvestirPass = submitted.investirPassword;
      if (newInvestirPass === '********') {
        newInvestirPass = currentMerged.investirPassword;
      }
      let newSmtpPass = submitted.smtp?.pass || '';
      if (newSmtpPass === '********') {
        newSmtpPass = currentMerged.smtp.pass;
      }

      // 1. Save sensitive data to .env
      const envVars = {
        INVESTIR_USERNAME: submitted.investirUsername || '',
        INVESTIR_PASSWORD: newInvestirPass || '',
        EMAIL_RECIPIENT: submitted.emailRecipient || '',
        SMTP_HOST: submitted.smtp?.host || '',
        SMTP_PORT: submitted.smtp?.port || '587',
        SMTP_SECURE: submitted.smtp?.secure !== undefined ? String(submitted.smtp.secure) : 'false',
        SMTP_USER: submitted.smtp?.user || '',
        SMTP_PASS: newSmtpPass || '',
        SMTP_FROM: submitted.smtp?.from || ''
      };
      this.saveEnvConfig(envVars);

      // 2. Save non-sensitive data to config.json
      const newConfigJson = {
        keywords: submitted.keywords || [],
        timezone: submitted.timezone || 'Europe/Paris'
      };
      this.saveConfig(newConfigJson);

      this.log('Configuration updated via Web UI (credentials stored in .env).');
      
      // Recalculate next run time if keywords or parameters changed
      this.nextRunTime = this.calculateNextRunTime();

      res.json({ success: true, message: 'Configuration saved.' });
    });

    // POST /api/trigger
    this.app.post('/api/trigger', async (req, res) => {
      if (this.isScraping) {
        return res.status(409).json({ success: false, message: 'Scrape already in progress.' });
      }
      
      this.log('Manual check triggered from Web UI.');
      // Execute in background
      this.triggerScrape();
      
      res.json({ success: true, message: 'Check started in background.' });
    });

    // GET /api/logs
    this.app.get('/api/logs', (req, res) => {
      res.json(this.logs);
    });

    // POST /api/test-email
    this.app.post('/api/test-email', async (req, res) => {
      const emailer = new Emailer(this.configPath);
      try {
        const messageId = await emailer.sendTestEmail();
        res.json({ success: true, message: `Email de test envoyé avec succès ! ID: ${messageId}` });
      } catch (err) {
        res.status(500).json({ success: false, message: `Erreur d'envoi: ${err.message}` });
      }
    });
  }

  // Start server listening
  start(port = 3010) {
    this.app.listen(port, '127.0.0.1', () => {
      this.log(`Dashboard web interface running at http://127.0.0.1:${port} (local access only)`);
    });
    
    // Run an initial check on start if we are within running hours and it's a weekday
    const pt = this.getParisTime();
    const dayOfWeek = new Date(pt.year, pt.month, pt.day).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (pt.hour >= 8 && pt.hour < 19 && !isWeekend) {
      this.log('Server started during active weekday scanning hours. Running initial startup check...');
      this.triggerScrape();
    } else {
      this.log('Server started outside active scanning hours or on a weekend. Startup check skipped.');
    }
  }

  // Get Yahoo Finance ticker for post
  getTickerForPost(post) {
    if (post.symbol) {
      const symbol = post.symbol;
      const mic = post.mic || '';
      if (mic === 'XBRU') return symbol + '.BR';
      if (mic === 'XAMS') return symbol + '.AS';
      if (mic === 'XPAR' || mic === 'ALXP') return symbol + '.PA';
      if (mic.includes('NAS') || mic.includes('NYS') || symbol === 'MRNA') return symbol;
      return symbol + '.PA';
    }
    return null;
  }

  // Resolve ticker symbol dynamically using Yahoo Search and price comparison
  async resolveTickerDynamically(post) {
    try {
      const words = post.title.split(/[^a-zA-ZÀ-ÿ]+/);
      const candidates = words.filter(w => w.length > 2 && w[0] === w[0].toUpperCase() && !['Les', 'Des', 'Aux', 'Sur', 'Pour', 'Mais', 'Une', 'Dans', 'Avec'].includes(w));
      
      if (candidates.length === 0) return null;
      
      const targetPrice = parseFloat(post.price);
      if (isNaN(targetPrice)) return null;
      
      let bestTicker = null;
      let bestDiff = Infinity;
      let bestQuote = null;
      
      for (const query of candidates) {
        const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`;
        const sRes = await fetch(searchUrl);
        if (!sRes.ok) continue;
        const sData = await sRes.json();
        
        const quotes = sData.quotes || [];
        for (const quote of quotes.slice(0, 10)) {
          if (quote.quoteType === 'EQUITY' && quote.symbol) {
            const symbol = quote.symbol;
            // Fetch live price
            const priceUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
            const pRes = await fetch(priceUrl);
            if (!pRes.ok) continue;
            const pData = await pRes.json();
            const livePrice = pData.chart?.result?.[0]?.meta?.regularMarketPrice;
            
            if (livePrice !== undefined && livePrice !== null) {
              let diff = Math.abs(livePrice - targetPrice) / targetPrice;
              
              // Apply exchange preferences
              // Penalize German, London, and other secondary OTC listings
              const isSecondaryExchange = 
                /\.(F|SG|DE|MU|DU|L|XD|XC|BE|QA)$/i.test(symbol) ||
                quote.exchange === 'PNK' ||
                quote.exchDisp === 'OTC Markets' ||
                (symbol.length === 5 && (symbol.endsWith('F') || symbol.endsWith('Y')));
                
              if (isSecondaryExchange) {
                diff += 0.25; // Significant penalty to secondary listings
              }
              
              // Prefer Euronext Paris (.PA) or primary US exchanges (no suffix)
              const isPreferredExchange = symbol.endsWith('.PA') || !symbol.includes('.');
              if (isPreferredExchange) {
                diff -= 0.05; // Minor bonus
              }

              if (diff < bestDiff) {
                bestDiff = diff;
                bestTicker = symbol;
                bestQuote = quote;
              }
            }
          }
        }
      }
      
      // Accept if price difference is less than 40%
      if (bestTicker && bestDiff < 0.4) {
        let symbol = bestTicker;
        let mic = 'XNAS';
        if (bestTicker.endsWith('.PA')) {
          symbol = bestTicker.slice(0, -3);
          mic = 'XPAR';
        } else if (bestTicker.endsWith('.BR')) {
          symbol = bestTicker.slice(0, -3);
          mic = 'XBRU';
        } else if (bestTicker.endsWith('.AS')) {
          symbol = bestTicker.slice(0, -3);
          mic = 'XAMS';
        }
        
        const companyName = bestQuote ? (bestQuote.longname || bestQuote.shortname) : null;
        return { symbol, mic, companyName };
      }
    } catch (e) {
      this.log(`Erreur lors de la résolution dynamique de ticker pour "${post.title}" : ${e.message}`);
    }
    return null;
  }

  // Query Yahoo Finance for current price and historical chart data to check target hit date
  async fetchStockData(ticker, targetPrice, publicationDate) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5y`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      
      const result = data.chart?.result?.[0];
      if (!result) return null;
      
      const currentPrice = result.meta?.regularMarketPrice || null;
      const currency = result.meta?.currency || '';
      
      // Determine target hit date (check quotes.high for daily highs)
      let targetHitDate = null;
      const targetVal = parseFloat(targetPrice);
      const pubTime = new Date(publicationDate).getTime();
      
      const timestamps = result.timestamp || [];
      const quotes = result.indicators?.quote?.[0] || {};
      const highs = quotes.high || [];
      const closes = quotes.close || [];
      
      for (let i = 0; i < timestamps.length; i++) {
        const dateMs = timestamps[i] * 1000;
        if (dateMs >= pubTime) {
          const highVal = highs[i] !== null ? highs[i] : null;
          const closeVal = closes[i] !== null ? closes[i] : null;
          const checkVal = highVal !== null ? highVal : closeVal;
          
          if (checkVal !== null && checkVal >= targetVal) {
            targetHitDate = new Date(dateMs).toISOString();
            break;
          }
        }
      }
      
      return {
        currentPrice,
        targetHitDate,
        currency
      };
    } catch (err) {
      this.log(`Erreur de fetch Yahoo Finance pour ${ticker}: ${err.message}`);
      return null;
    }
  }

  // Loop through matches and update market prices and target status
  async updateAllPrices() {
    if (!this.isParisTradingHours()) {
      return;
    }

    this.log('Mise à jour des cours actuels et des statuts objectifs depuis Yahoo Finance...');
    try {
      if (!fs.existsSync(this.matchesPath)) return;
      
      let matches = [];
      try {
        matches = JSON.parse(fs.readFileSync(this.matchesPath, 'utf8'));
      } catch (e) {
        return;
      }
      
      let updated = false;
      
      for (let m of matches) {
        // Self-healing: if the match record lacks a symbol, resolve it dynamically
        if (!m.symbol) {
          this.log(`Résolution dynamique du ticker pour l'alerte historique : "${m.title}"`);
          const resolved = await this.resolveTickerDynamically(m);
          if (resolved) {
            m.symbol = resolved.symbol;
            m.mic = resolved.mic;
            m.companyName = resolved.companyName;
            this.log(`-> Résolu avec succès : ${resolved.symbol} (${resolved.mic}) - ${resolved.companyName}`);
            updated = true;
          } else {
            this.log(`-> Impossible de résoudre le ticker pour : "${m.title}"`);
          }
        }

        const ticker = this.getTickerForPost(m);
        if (ticker && m.targetPrice) {
          const data = await this.fetchStockData(ticker, m.targetPrice, m.publicationDate);
          if (data) {
            if (m.currentPrice !== data.currentPrice || m.targetHitDate !== data.targetHitDate) {
              m.currentPrice = data.currentPrice;
              m.targetHitDate = data.targetHitDate;
              if (data.currency) m.currency = data.currency;
              updated = true;
            }
          }
        }
      }
      
      if (updated) {
        fs.writeFileSync(this.matchesPath, JSON.stringify(matches, null, 2));
        this.log('Base matches.json mise à jour avec les nouveaux cours boursiers.');
      } else {
        this.log('Aucune modification des cours de bourse détectée.');
      }
    } catch (err) {
      this.log(`Erreur lors de la mise à jour des cours : ${err.message}`);
    }
  }
}

module.exports = Server;
