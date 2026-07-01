const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class Emailer {
  constructor(configPath) {
    this.configPath = configPath;
    this.logsDir = path.join(path.dirname(configPath), 'logs');
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

  // Fallback logging when SMTP is not configured
  logFallback(recipient, subject, text, html) {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
    const logFile = path.join(this.logsDir, 'sent_emails.log');
    const timestamp = new Date().toISOString();
    const logEntry = `
========================================
[EMAIL SENT - ${timestamp}]
Recipient: ${recipient}
Subject: ${subject}
Text Body:
${text}
----------------------------------------
HTML Body (Raw):
${html}
========================================
\n`;
    fs.appendFileSync(logFile, logEntry);
    console.log(`[Email Fallback] SMTP not configured. Logged alert to ${logFile}`);
  }

  // Send an alert for matching post(s)
  async sendAlert(posts) {
    const config = this.getConfig();
    const recipient = process.env.EMAIL_RECIPIENT || config.emailRecipient || 'nnnx02@gmail.com';
    const smtp = {
      host: process.env.SMTP_HOST || (config.smtp && config.smtp.host),
      port: process.env.SMTP_PORT || (config.smtp && config.smtp.port),
      secure: process.env.SMTP_SECURE !== undefined ? (process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === true) : (config.smtp && (config.smtp.secure === true || config.smtp.secure === 'true')),
      user: process.env.SMTP_USER || (config.smtp && config.smtp.user),
      pass: process.env.SMTP_PASS || (config.smtp && config.smtp.pass),
      from: process.env.SMTP_FROM || (config.smtp && config.smtp.from)
    };

    if (!posts || posts.length === 0) return { success: false, message: 'No posts to send' };

    // Format the subject
    let subject = '';
    if (posts.length === 1) {
      subject = `🚨 ALERTE INVESTEER : Achat Spéculatif sur ${posts[0].title}`;
    } else {
      subject = `🚨 ALERTE INVESTEER : ${posts.length} opportunités d'Achat Spéculatif détectées`;
    }

    // Build plain text version
    let plainText = `Alertes d'Achat Spéculatif - Investeer \n\n`;
    posts.forEach((p, idx) => {
      plainText += `${idx + 1}. ${p.title}\n`;
      plainText += `   Conseil : ${p.adviceLabel} (Prix d'entrée: ${p.price || '-'} ${p.currency || ''}, Objectif: ${p.targetPrice || '-'} ${p.currency || ''})\n`;
      plainText += `   Lien : ${p.url}\n`;
      plainText += `   Description : ${p.description}\n\n`;
    });

    // Build HTML version
    let htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alerte Investeer</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f4f6f8;
      color: #041624;
      margin: 0;
      padding: 0;
    }
    .wrapper {
      width: 100%;
      background-color: #f4f6f8;
      padding: 20px 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 15px rgba(0, 85, 165, 0.08);
      border: 1px solid #dce5f1;
    }
    .header {
      background-color: #082a44;
      background-image: linear-gradient(135deg, #082a44 0%, #1b74b3 100%);
      color: #ffffff;
      padding: 30px 24px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .header p {
      margin: 8px 0 0 0;
      font-size: 14px;
      color: #b1c1d5;
    }
    .content {
      padding: 24px;
    }
    .intro {
      font-size: 16px;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .card {
      background-color: #f2f7ff;
      border-left: 4px solid #009f6a;
      border-radius: 4px 8px 8px 4px;
      padding: 20px;
      margin-bottom: 24px;
      border-top: 1px solid #dce5f1;
      border-right: 1px solid #dce5f1;
      border-bottom: 1px solid #dce5f1;
    }
    .card-title {
      font-size: 18px;
      font-weight: 700;
      color: #082a44;
      margin-top: 0;
      margin-bottom: 10px;
    }
    .badge {
      display: inline-block;
      background-color: #009f6a;
      color: #ffffff;
      font-size: 12px;
      font-weight: bold;
      padding: 4px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .details {
      font-size: 14px;
      margin-bottom: 12px;
      color: #315271;
    }
    .details span {
      font-weight: 600;
      color: #082a44;
    }
    .description {
      font-size: 14px;
      line-height: 1.5;
      color: #4f6c8d;
      background-color: #ffffff;
      padding: 12px;
      border-radius: 6px;
      border: 1px dashed #c7d3e3;
      margin-top: 12px;
    }
    .btn-container {
      text-align: center;
      margin-top: 20px;
    }
    .btn {
      display: inline-block;
      background-color: #1b74b3;
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 24px;
      font-size: 14px;
      font-weight: bold;
      border-radius: 30px;
      box-shadow: 0 4px 10px rgba(27, 116, 179, 0.2);
    }
    .footer {
      background-color: #f4f6f8;
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #859db9;
      border-top: 1px solid #dce5f1;
    }
    .footer a {
      color: #1b74b3;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>Opportunité Spéculative Détectée</h1>
        <p>Surveillance Investeer</p>
      </div>
      <div class="content">
        <p class="intro">Bonjour,</p>
        <p class="intro">Le scraper automatique a détecté le(s) conseil(s) d'<strong>Achat Spéculatif</strong> suivant(s) sur le site d'Investir :</p>
        
        ${posts.map(p => `
          <div class="card">
            <span class="badge">${p.adviceLabel || 'Achat spéculatif'}</span>
            <h3 class="card-title">${p.title}</h3>
            <div class="details">
              <div>📈 Conseil : <span>${p.adviceLabel}</span></div>
              ${p.price ? `<div>💰 Cours à la date du conseil : <span>${p.price} ${p.currency}</span></div>` : ''}
              ${p.targetPrice ? `<div>🎯 Objectif de cours : <span>${p.targetPrice} ${p.currency}</span></div>` : ''}
              <div>📅 Date : <span>${new Date(p.publicationDate).toLocaleDateString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span></div>
            </div>
            <div class="description">
              <strong>Analyse de la rédaction :</strong><br>
              ${p.description || "Aucune description fournie."}
            </div>
            <div class="btn-container">
              <a href="${p.url}" target="_blank" class="btn">Consulter l'article sur Investir</a>
            </div>
          </div>
        `).join('')}
        
      </div>
      <div class="footer">
        Cet e-mail a été envoyé automatiquement par le détecteur d'alertes Investeer.<br>
        Vous pouvez modifier les paramètres de notification sur la <a href="http://localhost:3010/config.html" target="_blank">page de configuration</a>.
      </div>
    </div>
  </div>
</body>
</html>
`;

    // Check if SMTP is configured
    if (!smtp.host || !smtp.user || !smtp.pass) {
      this.logFallback(recipient, subject, plainText, htmlContent);
      return {
        success: false,
        mode: 'fallback',
        message: 'SMTP not configured. Email logged to file.'
      };
    }

    try {
      console.log(`Sending email alert to ${recipient} via SMTP...`);
      const portVal = parseInt(smtp.port) || 587;
      const isSecure = portVal === 465;

      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: portVal,
        secure: isSecure,
        auth: {
          user: smtp.user,
          pass: smtp.pass
        },
        family: 4 // Force IPv4 to prevent ENETUNREACH on systems with broken IPv6
      });

      const info = await transporter.sendMail({
        from: smtp.from || `"Alertes Investeer" <${smtp.user}>`,
        to: recipient,
        subject: subject,
        text: plainText,
        html: htmlContent
      });

      console.log('Email sent successfully via SMTP! Message ID:', info.messageId);
      return {
        success: true,
        mode: 'smtp',
        messageId: info.messageId
      };
    } catch (err) {
      console.error('ERROR SENDING EMAIL VIA SMTP:', err);
      // Fallback to file logging if SMTP fails so alerts are not lost
      this.logFallback(recipient, `[SMTP FAIL] ${subject}`, plainText, htmlContent);
      return {
        success: false,
        mode: 'fallback_error',
        message: `SMTP Failed (${err.message}). Alert logged to file.`
      };
    }
  }

  // Send a test email to verify SMTP configuration
  async sendTestEmail() {
    const config = this.getConfig();
    const recipient = process.env.EMAIL_RECIPIENT || config.emailRecipient || 'nnnx02@gmail.com';
    const smtp = {
      host: process.env.SMTP_HOST || (config.smtp && config.smtp.host),
      port: process.env.SMTP_PORT || (config.smtp && config.smtp.port),
      secure: process.env.SMTP_SECURE !== undefined ? (process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === true) : (config.smtp && (config.smtp.secure === true || config.smtp.secure === 'true')),
      user: process.env.SMTP_USER || (config.smtp && config.smtp.user),
      pass: process.env.SMTP_PASS || (config.smtp && config.smtp.pass),
      from: process.env.SMTP_FROM || (config.smtp && config.smtp.from)
    };

    if (!smtp.host || !smtp.user || !smtp.pass) {
      throw new Error('SMTP not configured.');
    }

    const portVal = parseInt(smtp.port) || 587;
    const isSecure = portVal === 465;

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: portVal,
      secure: isSecure,
      auth: {
        user: smtp.user,
        pass: smtp.pass
      },
      family: 4 // Force IPv4 to prevent ENETUNREACH on systems with broken IPv6
    });

    const info = await transporter.sendMail({
      from: smtp.from || `"Test Alertes Investeer" <${smtp.user}>`,
      to: recipient,
      subject: '🛠️ Test de configuration SMTP - Alertes Investeer',
      text: 'Félicitations ! Votre configuration SMTP fonctionne correctement pour les alertes Investeer.',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #dce5f1; border-radius: 8px; max-width: 600px;">
          <h2 style="color: #009f6a;">🛠️ Test de Connexion SMTP Réussi</h2>
          <p>Bonjour,</p>
          <p>Ce message confirme que les paramètres de votre serveur SMTP pour les **Alertes Investeer** sont valides.</p>
          <p>Vous recevrez désormais les alertes de conseils d'Achat Spéculatif directement à cette adresse.</p>
          <hr style="border: 0; border-top: 1px solid #dce5f1; margin: 20px 0;">
          <p style="font-size: 12px; color: #859db9;">Alertes Investeer - Détecteur Automatique</p>
        </div>
      `
    });

    return info.messageId;
  }
}

module.exports = Emailer;
