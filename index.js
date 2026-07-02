const path = require('path');
const fs = require('fs');
const Server = require('./src/server');
const Scraper = require('./src/scraper');
const Emailer = require('./src/emailer');

require('dotenv').config();
require('./src/crypto-helper').decryptEnv();

// Ensure database and logs folders exist
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Move config.json to database directory for persistence ease
const configPath = path.join(dbDir, 'config.json');
if (!fs.existsSync(configPath)) {
  const rootConfig = path.join(__dirname, 'config.json');
  if (fs.existsSync(rootConfig)) {
    try {
      fs.copyFileSync(rootConfig, configPath);
    } catch (e) {
      console.error('Error migrating configuration file:', e);
    }
  } else {
    fs.writeFileSync(configPath, JSON.stringify({ keywords: ["achat spéculatif", "achat spécutatif"], timezone: "Europe/Paris" }, null, 2));
  }
}

// Read CLI arguments
const args = process.argv.slice(2);
const runOnce = args.includes('--run-once');

if (runOnce) {
  console.log('--- RUNNING DETECTOR ONCE (CLI MODE) ---');
  
  const scraper = new Scraper(configPath);
  const emailer = new Emailer(configPath);
  const seenPath = path.join(dbDir, 'seen_posts.json');
  const matchesPath = path.join(dbDir, 'matches.json');

  async function executeOnce() {
    try {
      const result = await scraper.run(msg => console.log(msg));
      const extractedPosts = result.posts || [];
      
      let seenIds = [];
      try {
        seenIds = JSON.parse(fs.readFileSync(seenPath, 'utf8'));
      } catch (e) {
        seenIds = [];
      }
      
      let matches = [];
      try {
        matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
      } catch (e) {
        matches = [];
      }

      const newMatches = [];
      const updatedSeenIds = [...seenIds];

      extractedPosts.forEach(post => {
        if (!updatedSeenIds.includes(post.id)) {
          updatedSeenIds.push(post.id);
          
          if (post.isMatch) {
            console.log(`🔥 Match! Title: "${post.title}" (Link: ${post.url})`);
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

      fs.writeFileSync(seenPath, JSON.stringify(updatedSeenIds, null, 2));
      fs.writeFileSync(matchesPath, JSON.stringify(matches, null, 2));

      if (newMatches.length > 0) {
        console.log(`Sending email alerts for ${newMatches.length} matching posts...`);
        const emailResult = await emailer.sendAlert(newMatches);
        
        // Reload matches to update status
        let updatedMatches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
        newMatches.forEach(nm => {
          const match = updatedMatches.find(m => m.id === nm.id);
          if (match) {
            match.emailSent = emailResult.success;
            if (!emailResult.success) {
              match.emailError = emailResult.message;
            }
          }
        });
        fs.writeFileSync(matchesPath, JSON.stringify(updatedMatches, null, 2));
        console.log(`Email process complete: ${emailResult.message}`);
      } else {
        console.log('No new matches found.');
      }
      
      console.log('CLI execution finished successfully.');
      process.exit(0);
    } catch (err) {
      console.error('CLI execution failed:', err);
      process.exit(1);
    }
  }

  executeOnce();
} else {
  // Daemon Server Mode (runs Express and scheduler loop)
  console.log('--- STARTING DETECTOR DAEMON & WEB SERVER ---');
  const server = new Server(configPath);
  const port = process.env.PORT || 3010;
  server.start(port);
}
