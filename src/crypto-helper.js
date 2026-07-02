const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 32-byte key for AES-256-CBC
const ENCRYPTION_KEY = Buffer.from('4a729e8c3b1d5f6a70e8c9d0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', 'hex');
const IV_LENGTH = 16;

function encrypt(text) {
  if (!text) return '';
  if (text.startsWith('enc:')) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `enc:${iv.toString('hex')}:${encrypted}`;
}

function decrypt(text) {
  if (!text || !text.startsWith('enc:')) return text || '';
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts[1], 'hex');
    const encryptedText = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return text;
  }
}

function decryptEnv() {
  const envPath = path.join(path.resolve(__dirname, '..'), '.env');
  if (fs.existsSync(envPath)) {
    try {
      let content = fs.readFileSync(envPath, 'utf8');
      let lines = content.split('\n');
      let modified = false;
      let newLines = [];
      for (let line of lines) {
        let trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          newLines.push(line);
          continue;
        }
        let match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          let key = match[1].trim();
          let val = match[2].trim();
          // If it's a value and does not start with enc: and is not empty
          if (val && !val.startsWith('enc:')) {
            let encrypted = encrypt(val);
            newLines.push(`${key}=${encrypted}`);
            modified = true;
          } else {
            newLines.push(line);
          }
        } else {
          newLines.push(line);
        }
      }
      if (modified) {
        fs.writeFileSync(envPath, newLines.join('\n'));
        console.log('◇ Encrypted raw values in .env file successfully.');
      }
    } catch (e) {
      console.error('Failed to auto-encrypt .env values:', e);
    }
  }

  // Now decrypt everything in process.env
  for (const key of Object.keys(process.env)) {
    const val = process.env[key];
    if (val && val.startsWith('enc:')) {
      process.env[key] = decrypt(val);
    }
  }
}

module.exports = { encrypt, decrypt, decryptEnv };
