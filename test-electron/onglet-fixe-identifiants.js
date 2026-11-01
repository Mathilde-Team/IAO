'use strict';
// ---------------------------------------------------------------------------
// test-electron/onglet-fixe-identifiants.js — harnais d'intégration (issue
// #363) : l'onglet immuable propose les identifiants partagés (Réglages →
// Identifiants des connecteurs) du site choisi dans les réglages.
//
// L'onglet immuable est créé PAR L'APPLICATION (pas par le harnais) : le
// réglage « ongletFixeActif + ongletFixeUrl » est écrit dans settings.json
// avant le démarrage ; le webview persist:onglet-fixe se charge de la page
// servie par interception https (hôte fictif context7.test, aucun réseau
// réel). Au focus d'un champ de connexion, le menu doit proposer les
// identifiants enregistrés pour l'hôte de l'onglet immuable.
//
// Phases :
//   1. Site choisi (context7.test) : focus d'un champ de connexion ->
//      signal main + menu proposé avec l'hôte du site choisi et le login
//      enregistré.
//   2. Issue #363, repli : le site sert sa page de connexion depuis un
//      sous-domaine (login.context7.test — le verrou de navigation
//      l'autorise). L'hôte affiché n'a pas d'identifiants : ce sont ceux du
//      site CHOISI dans les réglages qui doivent être proposés.
//
// Usage : xvfb-run -a npx electron --no-sandbox test-electron/onglet-fixe-identifiants.js
// (via npm run test:electron:onglet-fixe)
// ---------------------------------------------------------------------------

process.env.IAO_LANG = 'fr';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, BrowserWindow, Menu, ipcMain, webContents } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const MAIN_JS = path.join(ROOT, 'main.js');
const FAIT = []; // liste des affirmations passées

function ok(phrase, cond, detail) {
  FAIT.push({ phrase, cond, detail });
  process.stdout.write(`${cond ? 'ok  ' : 'FAIL'}  ${phrase}${cond ? '' : '  ' + JSON.stringify(detail || '')}\n`);
}

// Page de l'onglet immuable : formulaire de connexion banal.
const PAGE_CONNEXION = '<!doctype html><html><head><meta charset="utf-8">' +
  '<title>Onglet immuable</title></head><body>' +
  '<h1 id="h1">Espace de connexion</h1>' +
  '<input id="login" type="text" name="login" autocomplete="username">' +
  '<input id="mdp" type="password" name="password" autocomplete="current-password">' +
  '<button id="envoyer" type="submit">Se connecter</button>' +
  '</body></html>';

// ---------------------------------------------------------------------------
// Préparation : dossier de données temporaire, réglages (onglet immuable sur
// un site https de test), identifiants partagés pour cet hôte.
// ---------------------------------------------------------------------------
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-onglet-fixe-'));
app.setPath('appData', dossier);
app.setAppPath(path.join(__dirname, '..')); // l'interface charge index.html de la racine
const userData = path.join(dossier, 'ai-manager');
fs.mkdirSync(userData, { recursive: true });
// Écrit AVANT le chargement de main.js : le verrou de navigation de l'onglet
// immuable lit l'URL au démarrage (comme le fera l'utilisateur).
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  language: 'fr',
  ongletFixeActif: true,
  ongletFixeUrl: 'https://context7.test/connexion'
}, null, 2));

// Espions posés AVANT le chargement de main.js : signal de focus côté main,
// construction des menus (le menu proposé au focus d'un champ de connexion).
const focusRecus = [];
ipcMain.on('iao-identifiants:focus', (e, idFocus, drapeaux) => {
  try { focusRecus.push({ url: e.sender.getURL(), idFocus, drapeaux }); } catch (_) { focusRecus.push({ url: null, idFocus, drapeaux }); }
});

const menusConstruits = [];
const vraiBuildFromTemplate = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = (items) => {
  try { menusConstruits.push(items.map((i) => i.label)); } catch (_) { menusConstruits.push(null); }
  return vraiBuildFromTemplate(items);
};

require(MAIN_JS);

// ---------------------------------------------------------------------------
// Interception https sur la session de l'onglet immuable : la page est servie
// par le harnais (pas de site externe, pas de certificat à ignorer).
// Chemin RÉEL : la session persist:onglet-fixe est créée par l'attachement du
// webview de l'application — l'interception est posée sur CETTE session (via
// le webContents du webview) au moment de sa création, avant le chargement.
// Au démarrage le seul webview est celui de l'onglet immuable (aucun compte).
// ---------------------------------------------------------------------------
let sesOngletFixe = null;
const sessionPrete = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('timeout : session de l’onglet immuable')), 25000);
  const brancher = (wc) => {
    if (!wc || wc.isDestroyed() || sesOngletFixe) return;
    if (typeof wc.getType !== 'function' || wc.getType() !== 'webview') return;
    const ses = wc.session;
    if (!ses) return;
    sesOngletFixe = ses;
    ses.protocol.interceptStringProtocol('https', (request, callback) => {
      callback({ data: PAGE_CONNEXION, mimeType: 'text/html' });
    });
    clearTimeout(timeout);
    resolve(ses);
  };
  app.on('web-contents-created', (e, wc) => brancher(wc));
  setInterval(() => {
    webContents.getAllWebContents().forEach((wc) => {
      try { brancher(wc); } catch (_) {}
    });
  }, 250).unref();
});

(async function () {
  process.stdout.write('— Onglet immuable (issue #363) : identifiants du site choisi —\n');
  process.stdout.write('Données : ' + userData + '\n');

  // L'application doit créer d'elle-même l'onglet immuable à partir du réglage.
  const mainWin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout : fenêtre principale')), 25000);
    const onWindow = (w) => { if (w.getParentWindow()) return; clearTimeout(timeout); resolve(w); };
    BrowserWindow.getAllWindows().forEach(onWindow);
    app.on('browser-window-created', (e, w) => onWindow(w));
  });
  await new Promise((r) => (mainWin.webContents.isLoading() ? mainWin.webContents.once('did-finish-load', r) : r()));
  ok('la fenêtre principale charge l’interface', true);

  const sesOngletFixe = await sessionPrete;

  // L'onglet immuable : webview créé par l'application, partition persist:onglet-fixe.
  const ongletFixe = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout : onglet immuable')), 25000);
    const essai = () => {
      const wc = webContents.getAllWebContents().find((c) =>
        c.getType() === 'webview' && c.getURL().includes('context7.test'));
      if (wc) { clearTimeout(timeout); resolve(wc); }
    };
    essai();
    setInterval(essai, 250).unref();
  });
  await new Promise((r) => setTimeout(r, 1000));
  ok('l’application crée l’onglet immuable sur le site choisi dans les réglages',
     ongletFixe.getType() === 'webview' && ongletFixe.getURL().includes('context7.test'),
     ongletFixe.getURL());

  // Précharge : le preload des identifiants est posé sur la session de
  // l'onglet immuable (même mécanisme que les profils).
  ok('le preload des identifiants est posé sur la session de l’onglet immuable',
     (sesOngletFixe.getPreloads() || []).some((p) => p.includes('identifiants-preload.js')),
     sesOngletFixe.getPreloads());

  // Identifiants partagés pour l'hôte : écrit après le démarrage, comme le
  // ferait l'utilisateur dans Réglages → Identifiants des connecteurs.
  // Format : { "<hôte>": [{ login, secret (base64), ajoute }] }.
  fs.writeFileSync(path.join(userData, 'identifiants.json'), JSON.stringify({
    'context7.test': [{ login: 'moi@exemple.fr', secret: Buffer.from('s3cr3t-test-onglet-fixe').toString('base64'), ajoute: 1 }]
  }, null, 2));

  // Focus des champs de connexion : sous xvfb (sans gestionnaire de fenêtres)
  // le document invité ne reçoit jamais le focus natif — comme le harnais
  // #278, on déclenche l'événement focusin synthétiquement (même chemin que
  // le vrai focus utilisateur : listener capture du preload de session).
  const focusSynthetique = (wc, id) => wc.executeJavaScript(
    `document.getElementById('${id}').focus();` +
    `document.getElementById('${id}').dispatchEvent(new Event('focusin', { bubbles: true })); 'ok'`);
  const menusAvec = (hote, login) => menusConstruits.filter((labels) =>
    labels && labels.some((l) => typeof l === 'string' && l.includes(hote)) &&
    (!login || labels.some((l) => typeof l === 'string' && l.includes(login))));

  // --- Phase 1 : site choisi, focus d'un champ de connexion ---------------
  await focusSynthetique(ongletFixe, 'login');
  await new Promise((r) => setTimeout(r, 500));
  await focusSynthetique(ongletFixe, 'mdp');
  await new Promise((r) => setTimeout(r, 800));

  const focusOngletFixe = focusRecus.find((f) => f.url && f.url.includes('context7.test'));
  ok('le focus d’un champ de connexion de l’onglet immuable signale le main process',
     !!focusOngletFixe, focusRecus);
  ok('le menu proposé par l’onglet immuable contient l’hôte du site choisi',
     menusAvec('context7.test').length > 0, menusConstruits);
  ok('le menu proposé contient l’identifiant enregistré pour ce site',
     menusAvec('context7.test', 'moi@exemple.fr').length > 0, menusConstruits);

  // --- Phase 2 (issue #363, repli) : page de connexion servie depuis un
  // sous-domaine du site choisi — le verrou l'autorise (memeSite). L'hôte
  // affiché (login.context7.test) n'a pas d'identifiants : ce sont ceux du
  // site choisi qui doivent être proposés. -------------------------------
  menusConstruits.length = 0;
  focusRecus.length = 0;
  await ongletFixe.loadURL('https://login.context7.test/connexion');
  await new Promise((r) => setTimeout(r, 1500));
  ok('l’onglet immuable navigue vers le sous-domaine du site choisi (verrou)',
     ongletFixe.getURL().includes('login.context7.test'), ongletFixe.getURL());
  await focusSynthetique(ongletFixe, 'mdp');
  await new Promise((r) => setTimeout(r, 800));

  const focusSousDomaine = focusRecus.find((f) => f.url && f.url.includes('login.context7.test'));
  ok('le focus d’un champ du sous-domaine signale le main process',
     !!focusSousDomaine, focusRecus);
  ok('le menu proposé sur le sous-domaine contient les identifiants du site choisi',
     menusAvec('context7.test', 'moi@exemple.fr').length > 0, menusConstruits);

  app.exit(0);
})().catch((err) => {
  process.stdout.write('\nERREUR du harnais onglet immuable (issue #363) : ' + err.message + '\n');
  app.exit(1);
});

// ---------------------------------------------------------------------------
// Rapport de vérification en fin de process.
// ---------------------------------------------------------------------------
process.on('exit', (code) => {
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (_) {}
  const fails = FAIT.filter((f) => !f.cond);
  process.stdout.write('\n— Bilan de la vérification (issue #363 : onglet immuable et identifiants) —\n');
  process.stdout.write('Vérifications passées : ' + (FAIT.length - fails.length) + ' / ' + FAIT.length + '\n');
  if (fails.length || code !== 0) {
    process.stdout.write('Échecs :\n' + fails.map((f) => '  - ' + f.phrase + ' ' + JSON.stringify(f.detail || '')).join('\n') + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('Aucun échec : l’onglet immuable propose les identifiants du site choisi.\n');
  }
});
