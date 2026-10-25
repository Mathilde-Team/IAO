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

function createElectronMock(appDataDir) {
  const appListeners = new Map();
  const windows = [];
  const ipcHandlers = new Map();
  const calls = { readyCallbacks: [] };

  const app = {
    getPath: (name) => (name === 'appData' ? appDataDir : path.join(appDataDir, name)),
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

  return { app, BrowserWindow, ipcMain, dialog, shell, session, appListeners, windows, ipcHandlers, calls };
}

// Charge main.js avec un réglage harCapture optionnel (settings.json écrit AVANT
// le require : le chemin du fichier est résolu au chargement du module).
function loadMain({ harCapture, murHar } = {}) {
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
  const electron = createElectronMock(appDataDir);
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
async function attacherWebview(h, { url = 'https://exemple.fr/parametrage', echecAttach, echecEnable, echecDetach } = {}) {
  const guest = new EventEmitter();
  guest.getURL = () => url;
  guest.setWindowOpenHandler = () => {};
  guest.session = {};
  const dbg = new EventEmitter();
  const appels = { attach: [], commandes: [], detach: 0 };
  dbg.attach = (version, libelle) => {
    if (echecAttach) throw new Error('Another debugger is already attached');
    appels.attach.push([version, libelle]);
  };
  dbg.sendCommand = async (commande, params) => {
    appels.commandes.push([commande, params]);
    if (echecEnable && commande === 'Network.enable') throw new Error('Command not found');
    if (commande === 'Network.getResponseBody') return { body: '{"ok": true}' };
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
