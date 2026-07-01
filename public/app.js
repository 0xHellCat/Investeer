// API Base Endpoints
const API_STATUS = '/api/status';
const API_POSTS = '/api/posts';
const API_CONFIG = '/api/config';
const API_TRIGGER = '/api/trigger';
const API_LOGS = '/api/logs';
const API_TEST_EMAIL = '/api/test-email';

// Keep track of logs length to only append or scroll when needed
let previousLogsLength = 0;
let previousPostsJson = '';

// DOM Elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const lastScanTime = document.getElementById('last-scan-time');
const nextScanTime = document.getElementById('next-scan-time');
const matchesBadge = document.getElementById('matches-badge');
const alertsList = document.getElementById('alerts-list');
const terminalBody = document.getElementById('terminal-body');
const toast = document.getElementById('toast');
const settingsForm = document.getElementById('settings-form');

// Inputs
const invUser = document.getElementById('inv-user');
const invPass = document.getElementById('inv-pass');
const emailRecipient = document.getElementById('email-recipient');
const smtpHost = document.getElementById('smtp-host');
const smtpPort = document.getElementById('smtp-port');
const smtpUser = document.getElementById('smtp-user');
const smtpPass = document.getElementById('smtp-pass');
const smtpFrom = document.getElementById('smtp-from');
const smtpSecure = document.getElementById('smtp-secure');

// Buttons
const btnTrigger = document.getElementById('btn-trigger');
const btnTestEmail = document.getElementById('btn-test-email');
const btnClearLogs = document.getElementById('btn-clear-logs');

// Show helper toast notifications
function showToast(message, isError = false) {
  toast.innerText = message;
  toast.className = 'toast show';
  if (isError) {
    toast.classList.add('error');
  }
  
  setTimeout(() => {
    toast.className = 'toast';
  }, 4000);
}

// Format ISO string into a human readable Paris time
function formatTime(isoString) {
  if (!isoString) return 'Jamais';
  const date = new Date(isoString);
  return date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Paris'
  });
}

// Fetch dashboard stats
async function updateStatus() {
  try {
    const res = await fetch(API_STATUS);
    if (!res.ok) throw new Error('Failed to fetch status');
    
    const data = await res.json();
    
    // Status Text and DOT
    if (data.isScraping) {
      statusText.innerText = 'Scan en cours...';
      statusDot.className = 'pulse-dot running';
      btnTrigger.disabled = true;
      btnTrigger.innerHTML = '<span class="btn-icon"><i data-lucide="loader"></i></span> Scan en cours...';
      lucide.createIcons();
    } else {
      statusText.innerText = 'En veille';
      statusDot.className = 'pulse-dot';
      btnTrigger.disabled = false;
      btnTrigger.innerHTML = '<span class="btn-icon"><i data-lucide="zap"></i></span> Déclencher un scan maintenant';
      lucide.createIcons();
    }
    
    // Last and Next Times
    lastScanTime.innerText = formatTime(data.lastRunTime);
    nextScanTime.innerText = formatTime(data.nextRunTime);
    matchesBadge.innerText = `${data.matchesCount} alerte${data.matchesCount > 1 ? 's' : ''}`;
    
  } catch (err) {
    console.error('Error fetching status:', err);
    statusText.innerText = 'Erreur serveur';
    statusDot.className = 'pulse-dot idle';
  }
}

// Fetch and render matched posts
async function updatePosts() {
  try {
    const res = await fetch(API_POSTS);
    if (!res.ok) throw new Error('Failed to fetch posts');
    
    const posts = await res.json();
    const postsJson = JSON.stringify(posts);
    if (postsJson === previousPostsJson) return;
    previousPostsJson = postsJson;
    
    if (posts.length === 0) {
      alertsList.innerHTML = `
        <div class="no-alerts">
          <div class="no-alerts-icon"><i data-lucide="search"></i></div>
          <p>Aucune alerte détectée pour le moment.</p>
          <span class="hint">Les opportunités d'achat spéculatif apparaîtront ici dès leur publication.</span>
        </div>
      `;
      lucide.createIcons();
      return;
    }
    
    let html = '';
    posts.forEach(post => {
      const pubDate = new Date(post.publicationDate).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Paris'
      });
      
      const emailStatusHtml = post.emailSent
        ? '<span class="email-status success"><i data-lucide="check-circle" class="icon-inline"></i> Mail envoyé</span>'
        : `<span class="email-status warning" title="${post.emailError || 'SMTP non configuré'}"><i data-lucide="alert-circle" class="icon-inline"></i> Loggé (SMTP off)</span>`;

      html += `
        <div class="alert-card">
          <div class="card-header">
            <a href="${post.url}" target="_blank" class="card-title-link">${post.title}</a>
            <span class="card-badge reco-achat">${post.adviceLabel || 'Achat'}</span>
          </div>
          <div class="card-meta">
            <span><i data-lucide="calendar" class="icon-inline"></i> Publié le : <strong>${pubDate}</strong></span>
            ${post.price ? `<span><i data-lucide="coins" class="icon-inline"></i> Cours : <strong>${post.price} ${post.currency}</strong></span>` : ''}
            ${post.targetPrice ? `<span><i data-lucide="target" class="icon-inline"></i> Cible : <strong>${post.targetPrice} ${post.currency}</strong></span>` : ''}
          </div>
          ${post.description ? `<div class="card-description">${post.description}</div>` : ''}
          <div class="card-footer">
            <span>ID: ${post.id}</span>
            ${emailStatusHtml}
          </div>
        </div>
      `;
    });
    
    alertsList.innerHTML = html;
    lucide.createIcons();
    
  } catch (err) {
    console.error('Error fetching posts:', err);
  }
}

// Fetch and append terminal logs
async function updateLogs() {
  try {
    const res = await fetch(API_LOGS);
    if (!res.ok) throw new Error('Failed to fetch logs');
    
    const logs = await res.json();
    
    // Only update and scroll if logs actually changed
    if (logs.length !== previousLogsLength) {
      previousLogsLength = logs.length;
      
      let html = '';
      logs.forEach(line => {
        let lineClass = 'log-line';
        if (line.includes('ERROR') || line.includes('CRITICAL')) {
          lineClass += ' error-line';
        } else if (line.includes('NEW MATCH DETECTED')) {
          lineClass += ' match-line';
        } else if (line.includes('CET]')) {
          lineClass += ' system-line';
        }
        
        html += `<div class="${lineClass}">${escapeHtml(line)}</div>`;
      });
      
      terminalBody.innerHTML = html;
      
      // Auto-scroll terminal to bottom
      terminalBody.scrollTop = terminalBody.scrollHeight;
    }
  } catch (err) {
    console.error('Error fetching logs:', err);
  }
}

// Escape HTML characters to prevent rendering bugs
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Fetch and populate configuration settings form
async function loadConfig() {
  try {
    const res = await fetch(API_CONFIG);
    if (!res.ok) throw new Error('Failed to fetch configuration');
    
    const config = await res.json();
    
    invUser.value = config.investirUsername || '';
    invPass.value = config.investirPassword || '';
    emailRecipient.value = config.emailRecipient || '';
    
    if (config.smtp) {
      smtpHost.value = config.smtp.host || '';
      smtpPort.value = config.smtp.port || '';
      smtpUser.value = config.smtp.user || '';
      smtpPass.value = config.smtp.pass || '';
      smtpFrom.value = config.smtp.from || '';
      smtpSecure.checked = config.smtp.secure === true;
    }
  } catch (err) {
    console.error('Error loading configuration:', err);
    showToast('Erreur lors du chargement de la configuration.', true);
  }
}

// Save configuration settings
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const payload = {
    investirUsername: invUser.value,
    investirPassword: invPass.value,
    emailRecipient: emailRecipient.value,
    smtp: {
      host: smtpHost.value,
      port: smtpPort.value ? parseInt(smtpPort.value) : 587,
      secure: smtpSecure.checked,
      user: smtpUser.value,
      pass: smtpPass.value,
      from: smtpFrom.value
    },
    // Keep target keywords and timezone defaults
    keywords: [
      "achat spéculatif",
      "achat spécutatif"
    ],
    timezone: "Europe/Paris"
  };
  
  try {
    const res = await fetch(API_CONFIG, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) throw new Error('Failed to save settings');
    
    showToast('Configuration enregistrée avec succès !');
    loadConfig(); // Reload to refresh masked fields
  } catch (err) {
    showToast(`Erreur d'enregistrement : ${err.message}`, true);
  }
});

// Trigger manual check
btnTrigger.addEventListener('click', async () => {
  try {
    const res = await fetch(API_TRIGGER, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to trigger scan');
    
    showToast('Scan manuel démarré en tâche de fond.');
    updateStatus();
  } catch (err) {
    showToast(`Erreur : ${err.message}`, true);
  }
});

// Send test email
btnTestEmail.addEventListener('click', async () => {
  showToast('Envoi du mail de test en cours...');
  try {
    const res = await fetch(API_TEST_EMAIL, { method: 'POST' });
    const data = await res.json();
    
    if (res.ok && data.success) {
      showToast('E-mail de test envoyé avec succès ! Vérifiez votre boîte.');
    } else {
      showToast(`Échec : ${data.message}`, true);
    }
  } catch (err) {
    showToast(`Erreur : ${err.message}`, true);
  }
});

// Clear terminal logs visually
btnClearLogs.addEventListener('click', () => {
  terminalBody.innerHTML = '<div class="log-line system-line">[SYSTEM CET] Historique des logs effacé localement.</div>';
  previousLogsLength = 0;
});

// Initial load
loadConfig();
updateStatus();
updatePosts();
updateLogs();
lucide.createIcons();

// Live polling intervals (every 3 seconds)
setInterval(() => {
  updateStatus();
  updatePosts();
  updateLogs();
}, 3000);
