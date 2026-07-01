const fs = require('fs');
const path = require('path');
const Emailer = require('./src/emailer');

const configPath = path.join(__dirname, 'config.json');
const matchesPath = path.join(__dirname, 'database', 'matches.json');

async function run() {
  console.log('Loading configuration and alert matches...');
  
  if (!fs.existsSync(matchesPath)) {
    console.log('No matches database found.');
    return;
  }

  let matches = [];
  try {
    matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
  } catch (err) {
    console.error('Error reading matches.json:', err);
    return;
  }

  // Filter posts that haven't been emailed yet
  const pendingPosts = matches.filter(m => m.emailSent === false);

  if (pendingPosts.length === 0) {
    console.log('Aucune alerte en attente d\'envoi (toutes ont déjà été envoyées).');
    return;
  }

  console.log(`Trouvé ${pendingPosts.length} alerte(s) en attente d'envoi. Tentative d'envoi via SMTP...`);

  const emailer = new Emailer(configPath);
  const result = await emailer.sendAlert(pendingPosts);

  if (result.success) {
    console.log('E-mail envoyé avec succès ! Mise à jour de matches.json...');
    
    // Mark as sent
    matches.forEach(m => {
      if (m.emailSent === false) {
        m.emailSent = true;
        m.emailError = null;
      }
    });

    fs.writeFileSync(matchesPath, JSON.stringify(matches, null, 2));
    console.log('Base de données matches.json mise à jour avec succès.');
  } else {
    console.error('L\'envoi d\'e-mail a échoué. Détails:', result.message);
  }
}

run().catch(console.error);
