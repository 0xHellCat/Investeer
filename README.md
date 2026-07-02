# Détecteur d'Achat Spéculatif - Investeer 📊

Ce projet est un automate intelligent conçu pour surveiller la page des conseils actions d'Investir (`https://investir.lesechos.fr/conseils-boursiers/conseils-actions`), s'y connecter, identifier les nouveaux articles recommandant un **"Achat Spéculatif"** (même en cas de faute de frappe comme "Achat Spécutatif"), et envoyer une notification email instantanée.

Il inclut un **Dashboard Web Local** interactif et esthétique pour consulter les alertes envoyées, forcer des scans manuels et configurer les paramètres de notification (SMTP).

---

## 🚀 Fonctionnalités Clés

*   🕵️ **Contournement Anti-Bot Akamai** : Émulation avancée de navigateur desktop (User-Agent, Client Hints, désactivation de `navigator.webdriver`).
*   📈 **Extraction Directe du Cache React** : Extraction du cache JSON `window.__REACT_QUERY_STATE__`, garantissant une lecture fiable des données sans risque de cassure liée au HTML.
*   💾 **Persistance de Session** : Sauvegarde des cookies de connexion dans `database/session.json` pour éviter les connexions répétées et les blocages de compte.
*   ⏰ **Planificateur Heure Française (CET)** :
    *   Premier scan à **08h03**.
    *   Deuxième scan à **08h40**.
    *   Puis scans toutes les **5 à 15 minutes** (intervalle aléatoire recalculé à chaque run) jusqu'à **19h00**.
    *   **Pas de scan le week-end** (samedi et dimanche) : report automatique au lundi matin à 08h03.
    *   Mise en veille automatique la nuit (de 19h01 à 08h02 le lendemain).
*   ✉️ **Alertes E-mails (Nodemailer)** : Envoi automatique de rapports HTML modernes. Si aucun serveur SMTP n'est configuré, les alertes sont loggées dans `logs/sent_emails.log`.
*   🖥️ **Dashboard Web local (Glassmorphism)** :
    *   Suivi en direct du statut du robot et comptes à rebours.
    *   Historique visuel des opportunités détectées.
    *   Logs d'exécution en direct.
    *   Formulaire de configuration.

---

## 🛠️ Installation

### 1. Récupérer le projet

Clonez le dépôt et accédez au dossier :
```bash
git clone https://github.com/0xHellCat/Investeer.git
cd Investeer
```

### Option 1 : Installation Locale (Node.js)

#### Prérequis
*   **Node.js** (version 18 ou supérieure recommandée)

#### Configuration
1. Installez les dépendances :
   ```bash
   npm install
   ```
2. Les identifiants Investir sont déjà pré-configurés dans `config.json`.
3. Lancez l'application (voir ci-dessous).

### Option 2 : Installation avec Docker (Recommandé)

Cette méthode est la plus simple car elle embarque toutes les dépendances nécessaires (notamment pour Playwright/Chromium) dans un conteneur isolé.

#### Prérequis
*   **Docker** et **Docker Compose** installés.

#### Configuration et Lancement
1. **Créer le fichier d'environnement** :
   Copiez le fichier d'exemple et configurez-le :
   ```bash
   cp .env.example .env
   ```
   Éditez ensuite le fichier `.env` pour y renseigner vos identifiants, mots de passe et paramètres SMTP.

2. **Lancer l'application** :
   Démarrez les services en arrière-plan (mode détaché) :
   ```bash
   docker compose up -d
   ```
   *Note de sécurité (Linux)* : Pour des raisons de sécurité, le conteneur tourne avec l'utilisateur non-root `node` (UID 1000). Si vous rencontrez une erreur de droit d'accès (`EACCES: permission denied`), corrigez la propriété des dossiers montés sur l'hôte en exécutant :
   ```bash
   sudo chown -R 1000:1000 database logs
   ```

3. **Consulter les logs** :
   Pour suivre l'exécution en temps réel :
   ```bash
   docker compose logs -f
   ```

4. **Arrêter l'application** :
   ```bash
   docker compose down
   ```

*Note : Les dossiers `database` (pour stocker la session et l'historique) et `logs` sont montés automatiquement en volume pour conserver les données persistantes même si le conteneur est recréé.*

Une fois le conteneur démarré, vous pouvez accéder au Dashboard à l'adresse [http://localhost:3010](http://localhost:3010) (et la configuration locale sur [http://localhost:3010/config.html](http://localhost:3010/config.html)). Le serveur utilise en interne `HOST=0.0.0.0` pour être accessible depuis le conteneur Docker, tout en restant par défaut sur `127.0.0.1` en installation locale classique pour des raisons de sécurité.

---

## 🏎️ Utilisation

### Mode 1 : Mode Démon avec Dashboard Web (Recommandé)
Ce mode lance le serveur de planification en arrière-plan et l'interface Web d'administration sur le port 3010, liée exclusivement en local (`127.0.0.1`) pour des raisons de sécurité.
```bash
npm start
```
*   **Interface Client (Lecture seule)** : [http://127.0.0.1:3010](http://127.0.0.1:3010) (Affiche uniquement les alertes, conçue pour être consultée par le client ou partagée).
*   **Interface de Configuration (Strictement locale)** : [http://127.0.0.1:3010/config.html](http://127.0.0.1:3010/config.html) (Configuration, logs en direct, déclenchements manuels).
*   **Fonctionnement** : Le script reste actif et déclenche automatiquement les scans selon la planification française, puis passe en veille la nuit. Un scan initial est automatiquement lancé au démarrage si vous êtes dans la plage horaire active (08h00 - 19h00).

### Mode 2 : Mode Exécution Unique (Idéal pour Cron Job)
Si vous préférez planifier les exécutions via le planificateur de tâches de votre système (ex: `crontab` sous Linux), vous pouvez exécuter le script pour un scan unique :
```bash
node index.js --run-once
```
Le script effectuera le scan, enverra l'email si un nouveau match est détecté, et s'arrêtera immédiatement.

---

## 📁 Structure du Projet

*   `config.json` : Fichier de paramètres (identifiants, SMTP, destinataires, mots clés).
*   `database/`
    *   `seen_posts.json` : Base de données locale des posts déjà analysés.
    *   `matches.json` : Historique des alertes d'Achat Spéculatif détectées.
    *   `session.json` : Session navigateur persistante (cookies) d'Investir.
*   `src/`
    *   `scraper.js` : Moteur de scraping Playwright avec bypass Akamai.
    *   `emailer.js` : Gestionnaire d'envoi d'e-mails et modèles graphiques.
    *   `server.js` : API Express et Planificateur heure française.
*   `public/` : Interface Web du Dashboard (HTML, CSS Glassmorphism, JS interactif).
*   `logs/` : Dossier contenant `sent_emails.log` (logs des emails en cas d'absence de serveur SMTP).

---

## ✉️ Configuration du Serveur SMTP (Mail)

Pour activer les notifications par email :
1. Rendez-vous sur le Dashboard à l'adresse [http://localhost:3010](http://localhost:3010).
2. Dans la section **Configuration Serveur SMTP (Mail)**, saisissez les informations de votre fournisseur d'e-mail (ex: Host, Port, Utilisateur, Mot de passe).
3. Cliquez sur **Enregistrer les paramètres**.
4. Vous pouvez tester la connexion en cliquant sur **Tester la connexion SMTP**. Un e-mail de test vous sera envoyé.
