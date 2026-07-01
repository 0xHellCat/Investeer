const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class Scraper {
  constructor(configPath) {
    this.configPath = configPath;
    this.sessionPath = path.join(path.dirname(configPath), 'database', 'session.json');
  }

  // Load configuration
  getConfig() {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (e) {
      console.error('Error reading configuration file:', e);
      return {};
    }
  }

  // Check if string matches target keywords (case-insensitive, typo-tolerant)
  isMatch(text, keywords) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    
    // Check direct keywords
    for (const kw of keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        return true;
      }
    }

    // Typo-tolerant regex: "achat sp[eé]cu[tl]atif"
    const regex = /achat\s+sp[eé]cu[tl]atif/i;
    return regex.test(lowerText);
  }

  async run(logCallback = console.log) {
    const config = this.getConfig();
    const username = process.env.INVESTIR_USERNAME || config.investirUsername || 'nnnx02@gmail.com';
    const password = process.env.INVESTIR_PASSWORD || config.investirPassword || 'Nathannvx5151++';
    const keywords = config.keywords || ['achat spéculatif', 'achat spécutatif'];

    logCallback('Launching headless browser...');
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    let context;
    const hasSession = fs.existsSync(this.sessionPath);

    const contextOptions = {
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      extraHTTPHeaders: {
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"'
      }
    };

    if (hasSession) {
      logCallback('Loading existing session from session.json...');
      context = await browser.newContext({
        ...contextOptions,
        storageState: this.sessionPath
      });
    } else {
      logCallback('No active session found. Creating a new browser context...');
      context = await browser.newContext(contextOptions);
    }

    // Bypass webdriver detection
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    const page = await context.newPage();
    let posts = [];
    let authenticated = false;

    try {
      logCallback('Navigating to target page: https://investir.lesechos.fr/conseils-boursiers/conseils-actions');
      const response = await page.goto('https://investir.lesechos.fr/conseils-boursiers/conseils-actions', {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      if (!response) {
        throw new Error('Navigation failed, no response received.');
      }

      logCallback(`Page loaded. Status: ${response.status()}`);
      if (response.status() === 403) {
        throw new Error('Access Denied (403). Akamai blocked the request.');
      }

      await page.waitForTimeout(3000);

      // Check if we are already authenticated from saved session
      const html = await page.content();
      authenticated = html.includes('name="ad:isAuthenticated" content="true"') || html.includes('content="true" name="ad:isAuthenticated"');

      if (authenticated) {
        logCallback('Session is valid. Already logged in!');
      } else {
        logCallback('Session invalid or missing. Starting login flow...');

        // Accept Didomi cookie consent banner if present
        logCallback('Checking for cookie consent banner...');
        const accepterBtn = page.locator('button:has-text("Accepter")');
        if (await accepterBtn.count() > 0 && await accepterBtn.first().isVisible()) {
          logCallback('Clicking cookie consent "Accepter" button...');
          await accepterBtn.first().click();
          await page.waitForTimeout(2000);
        } else {
          logCallback('No consent banner visible.');
        }

        // Click login button in the header
        logCallback('Opening login form...');
        const headerLoginBtn = page.locator('button[data-testid="sign-in-button-header"]');
        if (await headerLoginBtn.count() === 0) {
          throw new Error('Sign-in button not found in header.');
        }
        await headerLoginBtn.click();
        await page.waitForTimeout(3000);

        // Fill credentials
        logCallback(`Entering credentials for ${username}...`);
        await page.fill('input[name="email"]', username);
        await page.fill('input[name="password"]', password);

        // Click submit
        logCallback('Submitting login form...');
        const submitBtn = page.locator('button:has-text("Se connecter")').and(page.locator('.w-full')).first();
        if (await submitBtn.count() > 0) {
          await submitBtn.click();
        } else {
          await page.locator('button:has-text("Se connecter")').first().click();
        }

        logCallback('Waiting for authentication to complete (8s)...');
        await page.waitForTimeout(8000);

        // Check authentication state again
        const postLoginHtml = await page.content();
        authenticated = postLoginHtml.includes('name="ad:isAuthenticated" content="true"') || postLoginHtml.includes('content="true" name="ad:isAuthenticated"');

        if (authenticated) {
          logCallback('Login successful! Saving browser state to session.json...');
          // Ensure directory exists
          const dir = path.dirname(this.sessionPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          
          await context.storageState({ path: this.sessionPath });
          logCallback('Session state saved.');
        } else {
          logCallback('WARNING: Login might have failed. Checking anyway...');
        }
      }

      // Extract React Query state
      logCallback('Extracting react-query page state...');
      const scriptContent = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        // Look for the script defining __REACT_QUERY_STATE__
        const targetScript = scripts.find(s => s.textContent && s.textContent.includes('window.__REACT_QUERY_STATE__'));
        return targetScript ? targetScript.textContent : null;
      });

      if (!scriptContent) {
        throw new Error('React Query state script tag not found on the page.');
      }

      // Parse the JSON string out of the script content
      const match = scriptContent.match(/window\.__REACT_QUERY_STATE__\s*=\s*([\s\S]+?);?\s*window\./);
      let jsonStr = '';
      if (match) {
        jsonStr = match[1];
      } else {
        const altMatch = scriptContent.match(/window\.__REACT_QUERY_STATE__\s*=\s*([\s\S]+)$/);
        if (altMatch) {
          jsonStr = altMatch[1].trim();
          if (jsonStr.endsWith(';')) jsonStr = jsonStr.substring(0, jsonStr.length - 1);
        }
      }

      if (!jsonStr) {
        throw new Error('Could not extract JSON string for react query state.');
      }

      const state = JSON.parse(jsonStr);
      const queries = state.queries || [];
      
      // Find the query corresponding to the section /conseils-boursiers/conseils-actions
      const sectionQuery = queries.find(q => 
        q.queryKey && 
        q.queryKey[0] === 'section' && 
        q.queryKey[1] === '/conseils-boursiers/conseils-actions'
      );

      if (!sectionQuery || !sectionQuery.state || !sectionQuery.state.data) {
        throw new Error('Section data not found in React Query cache.');
      }

      const stripes = sectionQuery.state.data.stripes || [];
      logCallback(`Found ${stripes.length} stripes in page layout. Processing articles...`);

      stripes.forEach(stripe => {
        if (stripe.mainContent) {
          stripe.mainContent.forEach(block => {
            if (block.items) {
              block.items.forEach(item => {
                // We only care about adviceArticles
                if (item.type === 'adviceArticle' || item.advice) {
                  const adviceLabel = item.advice?.label || '';
                  const title = item.title || '';
                  const description = item.advice?.description || '';
                  
                  // Check if it matches "Achat Spéculatif" in label, title, or description
                  const matched = this.isMatch(adviceLabel, keywords) || 
                                  this.isMatch(title, keywords) || 
                                  this.isMatch(description, keywords);

                  const instrument = item.instruments && item.instruments[0];
                  posts.push({
                    id: item.id,
                    title: title,
                    path: item.path,
                    url: `https://investir.lesechos.fr${item.path}`,
                    publicationDate: item.publicationDate || item.updateDate,
                    updateDate: item.updateDate,
                    adviceLabel: adviceLabel,
                    adviceType: item.advice?.type || '',
                    price: item.advice?.price || null,
                    targetPrice: item.advice?.targetPrice || null,
                    currency: item.advice?.currency || '',
                    description: description,
                    companyName: instrument ? instrument.name : null,
                    isin: instrument ? instrument.isin : null,
                    symbol: instrument ? instrument.symbol : null,
                    mic: instrument ? instrument.mic : null,
                    isMatch: matched
                  });
                }
              });
            }
          });
        }
      });

      logCallback(`Successfully extracted ${posts.length} articles.`);
      const matches = posts.filter(p => p.isMatch);
      logCallback(`Detected ${matches.length} articles matching "Achat Spéculatif".`);

    } catch (err) {
      logCallback(`ERROR DURING SCRAPING: ${err.message}`);
      console.error(err);
      
      // Save error state screenshot if possible for debugging
      try {
        await page.screenshot({ path: 'error_screenshot.png' });
        logCallback('Saved error screenshot to error_screenshot.png');
      } catch (screenshotErr) {
        logCallback(`Could not take error screenshot: ${screenshotErr.message}`);
      }
      
      throw err;
    } finally {
      logCallback('Closing browser...');
      await browser.close();
    }

    return {
      authenticated,
      posts
    };
  }
}

module.exports = Scraper;
