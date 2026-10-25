'use strict';

// Issue #305 : couverture de la capture HAR dans main.js — câblage
// `did-attach-webview` -> `demarrerCaptureHAR` (débogueur CDP du webview).
// Même principe que test/main-debug.test.js : `require('electron')` est
// remplacé par un module simulé, tout se passe dans un dossier temporaire.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');

const ROOT = path.join(__dirname, '..');
const MAIN_PATH = path.join(ROOT, 'main.js');

function createElectronMock(appDataDir, { rejeterUserData } = {}) {
  const appListeners = new Map();
  const windows = [];
  const ipcHandlers = new Map();
  const calls = { readyCallbacks: [] };
  // Drapeau activable APRÈS ready() : getPath('userData') sert aussi à la
  // chaîne de démarrage (journal, diagnostics) — seul l'appel runtime de la
  // capture HAR doit rejeter.
  const etat = { rejeterMaintenant: false };

  const app = {
    getPath: (name) => {
      if (name === 'userData' && etat.rejeterMaintenant) throw rejeterUserData;
      return name === 'appData' ? appDataDir : path.join(appDataDir, name);
    },
    setPath() {},
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    setName() {},
    requestSingleInstanceLock: () => true,
    quit() {},
    on(event, fn) { appListeners.set(event, fn); return this; },
    whenReady: () => ({ then(fn) { calls.readyCallbacks.push(fn); return this; } })
  };

  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.getURL = () => 'file:///index.html';
      windows.push(this);
    }
    loadFile() {}
    setMenuBarVisibility() {}
    static getAllWindows() { return windows; }
  }

  const ipcMain = {
    handle(channel, fn) { ipcHandlers.set(channel, fn); },
    on() {}
  };
  const session = {
    fromPartition: () => ({ on() {}, clearStorageData: async () => {}, clearCache: async () => {} }),
    defaultSession: {}
  };
  const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
  const shell = { openExternal() {} };

  return { app, BrowserWindow, ipcMain, dialog, shell, session, appListeners, windows, ipcHandlers, calls, etat };
}

// Charge main.js avec un réglage harCapture optionnel (settings.json écrit AVANT
// le require : le chemin du fichier est résolu au chargement du module).
function loadMain({ harCapture, murHar, rejeterUserData } = {}) {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-main-har-'));
  fs.mkdirSync(path.join(appDataDir, 'userData'), { recursive: true });
  if (harCapture !== undefined) {
    fs.writeFileSync(
      path.join(appDataDir, 'userData', 'settings.json'),
      JSON.stringify({ harCapture: harCapture })
    );
  }
  // « mur » : un FICHIER à la place du dossier har fait échouer la sauvegarde.
  if (murHar) fs.writeFileSync(path.join(appDataDir, 'userData', 'har'), 'pas un dossier');
  const electron = createElectronMock(appDataDir, { rejeterUserData });
  const output = [];
  const original = { warn: console.warn, log: console.log, error: console.error };
  const capture = () => {
    console.log = console.warn = console.error = (...a) => output.push(a.join(' '));
  };
  const release = () => { Object.assign(console, original); };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === 'electron') return electron;
    return originalLoad.apply(this, arguments);
  };
  capture();
  try {
    delete require.cache[MAIN_PATH];
    require(MAIN_PATH);
  } finally {
    Module._load = originalLoad;
    release();
  }

  const logFile = path.join(appDataDir, 'userData', 'logs', 'iao.log');
  return {
    electron,
    output,
    appDataDir,
    readLog: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : ''),
    async ready() {
      capture();
      try { for (const fn of electron.calls.readyCallbacks) await fn(); } finally { release(); }
    },
    cleanup() {
      delete require.cache[MAIN_PATH];
      fs.rmSync(appDataDir, { recursive: true, force: true });
    }
  };
}

// Attache une fausse <webview> avec débogueur CDP simulé et renvoie le tout.
// (la capture démarre après une lecture asynchrone des réglages : on attend un peu)
async function attacherWebview(h, { url = 'https://exemple.fr/parametrage', echecAttach, echecEnable, echecDetach, attachBrut, enableBrut, corpsAbsent, corpsRejete, urlSecondeEchec } = {}) {
  const guest = new EventEmitter();
  let appelsGetURL = 0;
  guest.getURL = () => {
    appelsGetURL++;
    // La trace d'attachement appelle getURL une première fois : c'est l'appel
    // de la capture (le second) qui échoue (webview déjà détruite).
    if (urlSecondeEchec && appelsGetURL > 1) throw new Error('webview parti');
    return url;
  };
  guest.setWindowOpenHandler = () => {};
  guest.session = {};
  const dbg = new EventEmitter();
  const appels = { attach: [], commandes: [], detach: 0 };
  dbg.attach = (version, libelle) => {
    if (echecAttach) throw new Error('Another debugger is already attached');
    if (attachBrut) throw 'débogueur occupé'; // rejet sans message -> repli « ? »
    appels.attach.push([version, libelle]);
  };
  dbg.sendCommand = async (commande, params) => {
    appels.commandes.push([commande, params]);
    if (echecEnable && commande === 'Network.enable') throw new Error('Command not found');
    if (enableBrut && commande === 'Network.enable') throw 'domaine refusé'; // sans message
    if (commande === 'Network.getResponseBody') {
      if (corpsRejete) throw new Error('session fermée'); // corps parti -> HAR sans ce corps
      if (corpsAbsent) return null; // réponse sans corps relisible
      return { body: '{"ok": true}' };
    }
    return {};
  };
  dbg.detach = () => {
    appels.detach++;
    if (echecDetach) throw new Error('détaché deux fois');
  };
  guest.debugger = dbg;
  h.electron.windows[0].webContents.emit('did-attach-webview', {}, guest);
  await new Promise((r) => setTimeout(r, 25));
  return { guest, dbg, appels };
}

function evenementRequete(id, url) {
  return {
    methode: 'Network.requestWillBeSent',
    params: {
      requestId: id,
      type: 'Document',
      timestamp: 1.0,
      wallTime: 1760000000,
      request: { url: url, method: 'GET', headers: {} }
    }
  };
}

test('HAR : réglage inactif ou réglages absents -> aucune capture', async () => {
  const h = loadMain({ harCapture: false });
  try {
    await h.ready();
    const { appels } = await attacherWebview(h);
    assert.equal(appels.attach.length, 0);
  } finally { h.cleanup(); }

  const h2 = loadMain(); // pas de settings.json du tout
  try {
    await h2.ready();
    const { appels } = await attacherWebview(h2);
    assert.equal(appels.attach.length, 0);
  } finally { h2.cleanup(); }
});

test('HAR : réglage actif -> débogueur attaché, événements capturés, fichier écrit à la fermeture', async () => {
  const h = loadMain({ harCapture: true });
  try {
    await h.ready();
    const { guest, dbg, appels } = await attacherWebview(h);
    assert.deepEqual(appels.attach, [['1.3', 'IAO-HAR']]);
    assert.ok(appels.commandes.some(([c]) => c === 'Network.enable'));

    // Deux requêtes, dont une terminée avec corps relisible.
    dbg.emit('message', 'event', 'Network.requestWillBeSent', evenementRequete('r1', 'https://exemple.fr/a').params);
    dbg.emit('message', 'event', 'Network.responseReceived', { requestId: 'r1', response: { status: 200 } });
    dbg.emit('message', 'event', 'Network.loadingFinished', { requestId: 'r1', encodedDataLength: 100 });
    dbg.emit('message', 'event', 'Network.requestWillBeSent', evenementRequete('r2', 'https://exemple.fr/b').params);

    guest.emit('destroyed'); // finalisation : écriture + détachement
    await new Promise((r) => setTimeout(r, 50)); // écriture asynchrone

    const dossierHar = path.join(h.appDataDir, 'userData', 'har');
    const fichiers = fs.readdirSync(dossierHar);
    assert.equal(fichiers.length, 1);
    assert.match(fichiers[0], /^exemple\.fr-\d{8}-\d{6}\.har$/);
    const har = JSON.parse(fs.readFileSync(path.join(dossierHar, fichiers[0]), 'utf-8'));
    assert.equal(har.log.entries.length, 2);
    assert.equal(har.log.entries[0].response.content.text, '{"ok": true}');
    assert.ok(appels.detach >= 1);
    // Double finalisation (detach après destroyed) : une seule écriture.
    dbg.emit('detach');
    assert.equal(fs.readdirSync(dossierHar).length, 1);
  } finally { h.cleanup(); }
});

test('HAR : URL sans hôte -> fichier « inconnu »', async () => {
  const h = loadMain({ harCapture: true });
  try {
    await h.ready();
    const { guest } = await attacherWebview(h, { url: 'file:///' });
    guest.emit('destroyed');
    await new Promise((r) => setTimeout(r, 50));
    const dossierHar = path.join(h.appDataDir, 'userData', 'har');
    const fichiers = fs.readdirSync(dossierHar);
    assert.equal(fichiers.length, 1);
    assert.ok(fichiers[0].startsWith('inconnu-'));
  } finally { h.cleanup(); }
});

test('HAR : attachement du débogueur refusé -> avertissement, capture abandonnée', async () => {
  const h = loadMain({ harCapture: true });
  try {
    await h.ready();
    const { appels } = await attacherWebview(h, { echecAttach: true });
    assert.equal(appels.attach.length, 0);
    const log = h.readLog();
    assert.match(log, /débogueur non attaché/);
  } finally { h.cleanup(); }
});

test('HAR : Network.enable refusé -> détachement et avertissement', async () => {
  const h = loadMain({ harCapture: true });
  try {
    await h.ready();
    const { guest, appels } = await attacherWebview(h, { echecEnable: true });
    guest.emit('destroyed');
    assert.equal(appels.detach, 1); // détaché une seule fois, dans le chemin d'échec
    assert.match(h.readLog(), /Network.enable refusé/);
  } finally { h.cleanup(); }
});

test('HAR : quota d\'entrées -> finalisation automatique, échec d\'écriture journalisé', async () => {
  const h = loadMain({ harCapture: true, murHar: true }); // <userData>/har est un fichier
  try {
    await h.ready();
    const { guest, dbg, appels } = await attacherWebview(h, { echecDetach: true });
    // 2000 requestWillBeSent : le quota de lib/har.js déclenche « termine ».
    for (let i = 0; i < 2000; i++) {
      dbg.emit('message', 'event', 'Network.requestWillBeSent', evenementRequete('r' + i, 'https://exemple.fr/x').params);
    }
    await new Promise((r) => setTimeout(r, 50));
    assert.match(h.readLog(), /échouée/); // écriture impossible : journalisée en warning
    assert.equal(appels.detach, 1); // un seul appel retenu, le second lève (ignoré)
    guest.emit('destroyed'); // finalisation déjà faite : rien de nouveau
  } finally { h.cleanup(); }
});

test('HAR : échecs sans message (rejets non-Error) -> repli « ? » dans les warnings', async () => {
  const h = loadMain({ harCapture: true });
  try {
    await h.ready();
    // attach lève une chaîne (pas une Error) -> repli « ? ».
    const a1 = await attacherWebview(h, { attachBrut: true });
    assert.equal(a1.appels.attach.length, 0);
    assert.match(h.readLog(), /débogueur non attaché \(\?\)/);
  } finally { h.cleanup(); }

  const h2 = loadMain({ harCapture: true });
  try {
    await h2.ready();
    // Network.enable rejette une chaîne -> repli « ? ».
    const a2 = await attacherWebview(h2, { enableBrut: true });
    assert.equal(a2.appels.detach, 1);
    assert.match(h2.readLog(), /Network.enable refusé : \?/);
  } finally { h2.cleanup(); }
});

test('HAR : corps de réponse illisible -> HAR écrit sans ce corps', async () => {
  const h = loadMain({ harCapture: true });
  try {
    await h.ready();
    const { guest, dbg } = await attacherWebview(h, { corpsAbsent: true });
    dbg.emit('message', 'event', 'Network.requestWillBeSent', evenementRequete('r1', 'https://exemple.fr/a').params);
    dbg.emit('message', 'event', 'Network.loadingFinished', { requestId: 'r1', encodedDataLength: 100 });
    guest.emit('destroyed');
    await new Promise((r) => setTimeout(r, 50));
    const dossierHar = path.join(h.appDataDir, 'userData', 'har');
    const fichiers = fs.readdirSync(dossierHar);
    assert.equal(fichiers.length, 1);
    const har = JSON.parse(fs.readFileSync(path.join(dossierHar, fichiers[0]), 'utf-8'));
    assert.equal(har.log.entries.length, 1);
    assert.equal(har.log.entries[0].response.content.text, undefined); // corps absent, métadonnées conservées
  } finally { h.cleanup(); }

  // Même scénario avec une relecture du corps qui rejette (session fermée).
  const h2 = loadMain({ harCapture: true });
  try {
    await h2.ready();
    const { guest, dbg } = await attacherWebview(h2, { corpsRejete: true });
    dbg.emit('message', 'event', 'Network.requestWillBeSent', evenementRequete('r1', 'https://exemple.fr/a').params);
    dbg.emit('message', 'event', 'Network.loadingFinished', { requestId: 'r1', encodedDataLength: 100 });
    guest.emit('destroyed');
    await new Promise((r) => setTimeout(r, 50));
    const dossierHar = path.join(h2.appDataDir, 'userData', 'har');
    const fichiers = fs.readdirSync(dossierHar);
    assert.equal(fichiers.length, 1);
    const har = JSON.parse(fs.readFileSync(path.join(dossierHar, fichiers[0]), 'utf-8'));
    assert.equal(har.log.entries[0].response.content.text, undefined); // échec de relecture absorbé
  } finally { h2.cleanup(); }
});

test('HAR : Network.enable refusé et détachement impossible -> double échec absorbé', async () => {
  const h = loadMain({ harCapture: true });
  try {
    await h.ready();
    const { appels } = await attacherWebview(h, { echecEnable: true, echecDetach: true });
    assert.equal(appels.detach, 1); // le détachement raté du chemin d'échec est absorbé
    assert.match(h.readLog(), /Network.enable refusé/);
    assert.equal(fs.existsSync(path.join(h.appDataDir, 'userData', 'har')), false);
  } finally { h.cleanup(); }
});

test('HAR : webview détruite avant la capture (getURL en échec) -> hôte « inconnu »', async () => {
  const h = loadMain({ harCapture: true });
  try {
    await h.ready();
    const { guest } = await attacherWebview(h, { urlSecondeEchec: true });
    guest.emit('destroyed');
    await new Promise((r) => setTimeout(r, 50));
    const dossierHar = path.join(h.appDataDir, 'userData', 'har');
    const fichiers = fs.readdirSync(dossierHar);
    assert.equal(fichiers.length, 1);
    assert.ok(fichiers[0].startsWith('inconnu-'));
  } finally { h.cleanup(); }
});

test('HAR : rejet runtime de getPath -> « capture interrompue » journalisé (avec et sans message)', async () => {
  const h = loadMain({ harCapture: true, rejeterUserData: new Error('userData cassé') });
  try {
    await h.ready();
    h.electron.etat.rejeterMaintenant = true; // l'appel runtime de la capture rejettera
    const { appels } = await attacherWebview(h);
    assert.equal(appels.attach.length, 0);
    assert.match(h.readLog(), /capture interrompue : userData cassé/);
  } finally { h.cleanup(); }

  const h2 = loadMain({ harCapture: true, rejeterUserData: 'panne de disque' });
  try {
    await h2.ready();
    h2.electron.etat.rejeterMaintenant = true;
    await attacherWebview(h2);
    assert.match(h2.readLog(), /capture interrompue : \?/); // rejet sans message -> repli « ? »
  } finally { h2.cleanup(); }
});
