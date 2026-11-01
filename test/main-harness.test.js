'use strict';

// Issue #93 (55.24) : harnais de chargement de main.js sous `node --test`.
// `require('electron')` est intercepté (Module._load) et remplacé par un
// module simulé (app, BrowserWindow, ipcMain, dialog, session, shell) qui
// capture les handlers IPC et les écouteurs d'événements. Aucun accès réseau,
// aucune fenêtre réelle, aucune écriture hors d'un dossier temporaire.

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
  const ipcHandlers = new Map();
  const appListeners = new Map();
  const windows = [];
  const calls = { quit: 0, openExternal: [], readyCallbacks: [], clipboard: [] };

  const app = {
    getPath: (name) => (name === 'appData' ? appDataDir : path.join(appDataDir, name)),
    setPath(name, value) { this._paths = Object.assign(this._paths || {}, { [name]: value }); },
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    // Issue #362 : nom applicatif que le système associe à https (détection
    // du navigateur par défaut). « Google Chrome » dans le harnais.
    getApplicationNameForProtocol: () => 'Google Chrome',
    setName(name) { this._name = name; },
    requestSingleInstanceLock: () => true,
    quit() { calls.quit++; },
    on(event, fn) { appListeners.set(event, fn); return this; },
    whenReady: () => ({ then(fn) { calls.readyCallbacks.push(fn); return this; } })
  };

  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.loaded = null;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (fn) => { this.webContents.openHandler = fn; };
      this.webContents.getURL = () => 'file:///index.html';
      windows.push(this);
    }
    loadFile(file) { this.loaded = file; }
    loadURL(url) { this.loadedUrl = url; return Promise.resolve(); } // issue #362
    setMenuBarVisibility(v) { this.menuBarVisible = v; }
    isMinimized() { return false; }
    restore() {}
    focus() {}
    static getAllWindows() { return windows; }
  }

  const ipcMain = {
    handle: (channel, fn) => { ipcHandlers.set(channel, fn); },
    on: (channel, fn) => { ipcHandlers.set(channel, fn); }
  };

  const session = {
    fromPartition: () => ({ clearStorageData: async () => {}, clearCache: async () => {}, getAllExtensions: () => [] }),
    defaultSession: {}
  };

  const dialog = {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true })
  };

  const shell = { openExternal: (u) => { calls.openExternal.push(u); } };

  // Issue #362 : presse-papiers simulé (links:copier).
  const clipboard = { writeText: (t) => { calls.clipboard.push(t); } };

  return { app, BrowserWindow, ipcMain, dialog, shell, session, clipboard, ipcHandlers, appListeners, windows, calls };
}

// Charge une copie neuve de main.js avec `electron` simulé, puis restaure Module._load.
function loadMain() {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-main-harness-'));
  const electron = createElectronMock(appDataDir);
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electron;
    return originalLoad.apply(this, arguments);
  };
  const warn = console.warn; const log = console.log; const error = console.error;
  console.warn = console.log = console.error = () => {};
  try {
    delete require.cache[MAIN_PATH];
    require(MAIN_PATH);
  } finally {
    Module._load = originalLoad;
    console.warn = warn; console.log = log; console.error = error;
  }
  return {
    electron,
    cleanup() {
      delete require.cache[MAIN_PATH];
      fs.rmSync(appDataDir, { recursive: true, force: true });
    }
  };
}

const MAIN_CHANNELS = [
  'accounts:disconnect-profile', 'accounts:export', 'accounts:import', 'app:is-debug', 'app:log-path', 'app:open-webmail', 'app:relaunch', 'app:relaunch-debug', 'app:toggle-devtools',
  'i18n:catalog', 'iao-identifiants:focus', 'identifiants:enregistrer', 'identifiants:lister', 'identifiants:obtenir', 'identifiants:supprimer', 'links:copier', 'links:navigateurs-detectes', 'links:ouvrir-externe', 'links:ouvrir-externe-prive', 'links:ouvrir-fenetre', 'mail-api:creer', 'mail-api:creer-lot', 'preferences:ecrire', 'preferences:lire', 'profils:ecrire', 'profils:lire', 'read-directory', 'read-directory-recursive', 'read-file', 'sauvegarde-complete:creer', 'sauvegarde-complete:restaurer', 'save-file',
  'secrets:available', 'secrets:delete', 'secrets:get', 'secrets:set',
  'select-folder', 'settings:load', 'settings:save', 'stats:export',
  'stats:load', 'stats:noter-quota', 'stats:noter-reponse', 'stats:quotas', 'stats:reponses', 'stats:reset', 'stats:sync',
  'taches:delete', 'taches:dues', 'taches:history', 'taches:list', 'taches:report', 'taches:run-now',
  'taches:save', 'taches:set-active', 'webmail:attendre'
];

test('main.js se charge avec un module electron simulé et liste ses canaux IPC', (t) => {
  const h = loadMain();
  try {
    const channels = [...h.electron.ipcHandlers.keys()].sort();
    t.diagnostic('canaux IPC enregistrés (' + channels.length + ') : ' + channels.join(', '));
    // Canaux propres à main.js : liste exacte (tout ajout/retrait doit être voulu).
    assert.deepEqual(channels.filter((c) => !c.startsWith('scheduler:')), MAIN_CHANNELS);
    // Canaux de l'ordonnanceur (registerSchedulerIPC) : présents et préfixés.
    const scheduler = channels.filter((c) => c.startsWith('scheduler:'));
    assert.ok(scheduler.includes('scheduler:get-state') && scheduler.includes('scheduler:set-config'));
    assert.equal(scheduler.length + MAIN_CHANNELS.length, channels.length);
    assert.ok(channels.every((c) => typeof h.electron.ipcHandlers.get(c) === 'function'));
  } finally { h.cleanup(); }
});

test('main.js sans fetch global (Node ancien) : chargement normal, fetchFn null', (t) => {
  // Issue #357 : la ligne `fetchFn: (typeof fetch === 'function') ? fetch : null`
  // couvre le cas d'un runtime sans fetch — les canaux « mail-api:* » répondent
  // alors « reseau » (l'appel avorté est intercepté dans lib/mail-api.js).
  const avant = globalThis.fetch;
  delete globalThis.fetch;
  let h;
  try {
    h = loadMain();
    assert.ok(h.electron.ipcHandlers.has('mail-api:creer'));
    assert.ok(h.electron.ipcHandlers.has('mail-api:creer-lot'));
  } finally {
    if (h) h.cleanup();
    globalThis.fetch = avant;
  }
});

test('main.js : userData fixé sur ai-manager, nom applicatif IAO, instance unique demandée', () => {
  const h = loadMain();
  try {
    assert.equal(path.basename(h.electron.app._paths.userData), 'ai-manager');
    assert.equal(h.electron.app._name, 'IAO');
    assert.ok(h.electron.appListeners.has('second-instance'));
    assert.ok(h.electron.appListeners.has('window-all-closed'));
    assert.equal(h.electron.calls.readyCallbacks.length, 1);
    assert.equal(h.electron.calls.quit, 0);
  } finally { h.cleanup(); }
});

// --- Cycle de vie de l'application : activate / window-all-closed -----------
// Lignes 388 (recréation de la fenêtre sur « activate ») et 393 (app.quit()
// hors macOS sur « window-all-closed ») — dernières lignes non couvertes de
// main.js après les issues #94, #95, #97 et #98.

function withPlatform(value, fn) {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', real); }
}

test('main.js : « activate » recrée la fenêtre seulement si aucune n\'est ouverte', () => {
  const h = loadMain();
  const warn = console.warn; const log = console.log;
  console.warn = console.log = () => {};
  try {
    h.electron.calls.readyCallbacks[0]();
    assert.equal(h.electron.windows.length, 1, 'fenêtre créée au démarrage');
    const activate = h.electron.appListeners.get('activate');
    assert.equal(typeof activate, 'function');

    activate(); // une fenêtre existe déjà -> rien
    assert.equal(h.electron.windows.length, 1);

    h.electron.windows.length = 0; // toutes les fenêtres fermées (macOS)
    activate();
    assert.equal(h.electron.windows.length, 1, 'fenêtre recréée');
    assert.equal(h.electron.windows[0].loaded, 'index.html');
  } finally {
    console.warn = warn; console.log = log;
    h.cleanup();
  }
});

test('i18n:catalog : français par défaut, IAO_LANG=en traduit, .mo illisible -> repli journalisé (issue #51)', () => {
  const saved = process.env.IAO_LANG;
  const messages = [];
  const warn = console.warn; const log = console.log;
  console.warn = console.log = (msg) => { messages.push(String(msg)); };
  const h = loadMain();
  const handler = h.electron.ipcHandlers.get('i18n:catalog');
  const origRead = fs.readFileSync;
  try {
    delete process.env.IAO_LANG;
    assert.equal(handler().locale, 'fr');
    process.env.IAO_LANG = 'en';
    const en = handler();
    assert.equal(en.locale, 'en');
    assert.equal(en.messages.Annuler, 'Cancel');
    assert.ok(messages.some((m) => m.includes('Langue de l\'interface : en')), messages.join(' | '));
    fs.readFileSync = function (file, ...rest) {
      if (String(file).endsWith('iao.mo')) return Buffer.from('corrompu');
      return origRead.call(fs, file, ...rest);
    };
    const bad = handler();
    assert.equal(bad.locale, 'fr');
    assert.ok(messages.some((m) => m.includes('repli en français')), messages.join(' | '));
  } finally {
    fs.readFileSync = origRead;
    if (saved === undefined) delete process.env.IAO_LANG; else process.env.IAO_LANG = saved;
    console.warn = warn; console.log = log;
    h.cleanup();
  }
});

test('i18n:catalog : réglage « Langue » puis langues du système, IAO_LANG prioritaire (issue #51, lot 3)', () => {
  const saved = process.env.IAO_LANG;
  const warn = console.warn; const log = console.log;
  console.warn = console.log = () => {};
  const h = loadMain();
  const app = h.electron.app;
  const handler = h.electron.ipcHandlers.get('i18n:catalog');
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try {
    delete process.env.IAO_LANG;
    // auto (pas de settings.json) : langues du système, la première livrée gagne
    app.getPreferredSystemLanguages = () => ['xx-YY', 'en-GB'];
    let c = handler();
    assert.equal(c.locale, 'en');
    assert.equal(c.setting, 'auto');
    assert.ok(c.available.includes('en') && c.available.includes('fr'));
    // liste système vide : repli sur app.getLocale()
    app.getPreferredSystemLanguages = () => [];
    app.getLocale = () => 'en-US';
    assert.equal(handler().locale, 'en');
    // ni l'un ni l'autre : français
    delete app.getPreferredSystemLanguages;
    delete app.getLocale;
    assert.equal(handler().locale, 'fr');
    // réglage explicite
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ language: 'en' }));
    c = handler();
    assert.equal(c.locale, 'en');
    assert.equal(c.setting, 'en');
    // IAO_LANG l'emporte sur le réglage
    process.env.IAO_LANG = 'fr';
    assert.equal(handler().locale, 'fr');
    delete process.env.IAO_LANG;
    // settings.json illisible : auto
    fs.writeFileSync(settingsFile, '{corrompu');
    assert.equal(handler().setting, 'auto');
  } finally {
    if (saved === undefined) delete process.env.IAO_LANG; else process.env.IAO_LANG = saved;
    console.warn = warn; console.log = log;
    h.cleanup();
  }
});

test('cleanupServiceWorkerStorage : supprime le dossier Service Worker au demarrage (issue #165)', () => {
  const h = loadMain();
  const warn = console.warn; const log = console.log;
  console.warn = console.log = () => {};
  try {
    const userData = h.electron.app.getPath('userData');
    const swDir = path.join(userData, 'Service Worker');
    fs.mkdirSync(swDir, { recursive: true });
    fs.writeFileSync(path.join(swDir, 'test.db'), 'corrupt');
    assert.equal(fs.existsSync(swDir), true, 'dossier Service Worker cree');
    h.electron.calls.readyCallbacks[0]();
    assert.equal(fs.existsSync(swDir), false, 'dossier Service Worker supprime');
  } finally {
    console.warn = warn; console.log = log;
    h.cleanup();
  }
});

test('cleanupServiceWorkerStorage : erreur de suppression journalisee sans bloquer (issue #165)', () => {
  const h = loadMain();
  const warn = console.warn; const log = console.log;
  const messages = [];
  console.warn = console.log = (msg) => { messages.push(String(msg)); };
  try {
    const userData = h.electron.app.getPath('userData');
    const swDir = path.join(userData, 'Service Worker');
    fs.mkdirSync(swDir, { recursive: true });
    const origRmSync = fs.rmSync;
    fs.rmSync = () => { throw new Error('EACCES permission refusee'); };
    try {
      h.electron.calls.readyCallbacks[0]();
    } finally {
      fs.rmSync = origRmSync;
    }
    assert.ok(messages.some(m => m.includes('Nettoyage Service Worker impossible')),
      'avertissement journalise : ' + messages.join(' | '));
  } finally {
    console.warn = warn; console.log = log;
    h.cleanup();
  }
});

test('stats:export (#206 lot 3) : dialogue CSV/JSON, annulation, fichier écrit', async () => {
  const h = loadMain();
  try {
    const exp = h.electron.ipcHandlers.get('stats:export');
    const vus = [];
    h.electron.dialog.showSaveDialog = async (_w, opts) => { vus.push(opts); return { canceled: true }; };
    assert.deepEqual(await exp({}, 'csv', [], {}), { canceled: true });
    assert.match(vus[0].defaultPath, /^iao-statistiques-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.deepEqual(vus[0].filters[0].extensions, ['csv']);
    h.electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: '' });
    assert.deepEqual(await exp({}, 'json', [], {}), { canceled: true });
    const cible = path.join(h.electron.app.getPath('userData'), 'export.json');
    h.electron.dialog.showSaveDialog = async (_w, opts) => { vus.push(opts); return { canceled: false, filePath: cible }; };
    const r = await exp({}, 'json', [], {});
    assert.deepEqual(r, { ok: true, chemin: cible });
    assert.deepEqual(vus[vus.length - 1].filters[0].extensions, ['json']);
    assert.equal(JSON.parse(fs.readFileSync(cible, 'utf-8')).format, 'iao-stats-1');
  } finally {
    h.cleanup();
  }
});

test('main.js : « window-all-closed » quitte hors macOS, reste ouvert sous macOS', () => {
  const h = loadMain();
  try {
    const onAllClosed = h.electron.appListeners.get('window-all-closed');
    withPlatform('darwin', () => onAllClosed());
    assert.equal(h.electron.calls.quit, 0, 'macOS : l\'app reste active');
    withPlatform('linux', () => onAllClosed());
    assert.equal(h.electron.calls.quit, 1);
    withPlatform('win32', () => onAllClosed());
    assert.equal(h.electron.calls.quit, 2);
  } finally { h.cleanup(); }
});

test('main.js : journal de démarrage mentionne « packagé » et « mode debug » (ligne 383-384)', () => {
  const prev = process.env.IAO_DEBUG;
  process.env.IAO_DEBUG = '1';
  let h;
  try { h = loadMain(); } finally {
    if (prev === undefined) delete process.env.IAO_DEBUG; else process.env.IAO_DEBUG = prev;
  }
  const warn = console.warn; const log = console.log; const info = console.info;
  const lines = [];
  console.warn = console.log = console.info = (...a) => { lines.push(a.join(' ')); };
  try {
    h.electron.app.isPackaged = true;
    h.electron.calls.readyCallbacks[0]();
  } finally {
    console.warn = warn; console.log = log; console.info = info;
  }
  try {
    const logFile = path.join(h.electron.app._paths.userData, 'logs', 'iao.log');
    const text = (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '') + lines.join('\n');
    assert.match(text, /packagé/);
    assert.match(text, /mode debug/);
  } finally { h.cleanup(); }
});

// --- Ordonnanceur : fenêtre principale transmise aux dialogues (#55) ----------
// `registerSchedulerIPC(ipcMain, scheduler, () => mainWindow)` : l'accesseur
// n'était jamais appelé depuis main.js (les tests de l'ordonnanceur passent
// leur propre accesseur). On vérifie qu'il renvoie bien la fenêtre créée par
// whenReady(), celle qui sert de parent au sélecteur de dossier.
test('main.js : scheduler:pick-downloads-dir ouvre le dialogue sur la fenêtre principale', async () => {
  const h = loadMain();
  const originalLoad = Module._load;
  const silence = { warn: console.warn, log: console.log, info: console.info, error: console.error };
  console.warn = console.log = console.info = console.error = () => {};
  const parents = [];
  h.electron.dialog.showOpenDialog = async (win) => { parents.push(win); return { canceled: true, filePaths: [] }; };
  Module._load = function patchedLoad(request) {
    if (request === 'electron') return h.electron;
    return originalLoad.apply(this, arguments);
  };
  try {
    await h.electron.calls.readyCallbacks[0]();
    const res = await h.electron.ipcHandlers.get('scheduler:pick-downloads-dir')({});
    assert.equal(res && res.error, undefined, 'pas d\'erreur renvoyée');
    assert.equal(parents.length, 1);
    assert.equal(parents[0], h.electron.windows[0], 'parent = fenêtre principale');
  } finally {
    Module._load = originalLoad;
    Object.assign(console, silence);
    h.cleanup();
  }
});

// Issue #362 : menu contextuel des liens et navigateur externe.
test('links:copier écrit dans le presse-papiers, refuse le non web', async (t) => {
  const h = loadMain();
  try {
    const copier = h.electron.ipcHandlers.get('links:copier');
    assert.deepEqual(copier({}, 'https://example.org/a'), { ok: true });
    assert.deepEqual(h.electron.calls.clipboard, ['https://example.org/a']);
    // Refus : schéma non web (mailto:, data:) — pas d'écriture.
    const refuse = copier({}, 'mailto:a@b.org');
    assert.equal(refuse.ok, false);
    assert.equal(h.electron.calls.clipboard.length, 1);
  } finally { h.cleanup(); }
});

test('links:ouvrir-externe remonte l’échec de shell.openExternal', async (t) => {
  const h = loadMain();
  try {
    h.electron.shell.openExternal = async () => { throw new Error('plus de navigateur'); };
    const ouvrir = h.electron.ipcHandlers.get('links:ouvrir-externe');
    const res = await ouvrir({}, 'https://example.org/');
    assert.equal(res.ok, false);
    assert.equal(res.erreur, 'plus de navigateur');
  } finally { h.cleanup(); }
});

test('links:ouvrir-externe remonte l’échec brut (non-Error) de shell.openExternal', async (t) => {
  const h = loadMain();
  try {
    h.electron.shell.openExternal = async () => { throw 'échec brut'; };
    const ouvrir = h.electron.ipcHandlers.get('links:ouvrir-externe');
    const res = await ouvrir({}, 'https://example.org/');
    assert.equal(res.ok, false);
    assert.equal(res.erreur, 'échec brut');
  } finally { h.cleanup(); }
});

test('links:ouvrir-externe valide l’adresse avant shell.openExternal', async (t) => {
  const h = loadMain();
  try {
    const ouvrir = h.electron.ipcHandlers.get('links:ouvrir-externe');
    const ok = await ouvrir({}, 'https://example.org/');
    assert.equal(ok.ok, true);
    assert.deepEqual(h.electron.calls.openExternal, ['https://example.org/']);
    const refuse = await ouvrir({}, 'file:///etc/passwd');
    assert.equal(refuse.ok, false);
    assert.equal(h.electron.calls.openExternal.length, 1, 'rien réouvert');
  } finally { h.cleanup(); }
});

test('links:ouvrir-fenetre crée une fenêtre avec l’adresse web, refuse sinon', async (t) => {
  const h = loadMain();
  try {
    const ouvrir = h.electron.ipcHandlers.get('links:ouvrir-fenetre');
    const avant = h.electron.windows.length;
    const refuse = ouvrir({}, { url: 'javascript:alert(1)', partition: 'persist:p' });
    assert.equal(refuse.ok, false);
    assert.equal(h.electron.windows.length, avant, 'aucune fenêtre créée');
    const ok = await ouvrir({}, { url: 'https://example.org/partage', partition: 'persist:p' });
    assert.equal(ok.ok, true);
    assert.equal(h.electron.windows.length, avant + 1);
    assert.equal(h.electron.windows[avant].loadedUrl, 'https://example.org/partage');
    assert.equal(h.electron.windows[avant].options.webPreferences.partition, 'persist:p');
    // Sans partition (menu d'un onglet sans compte) : session par défaut.
    const sansPartition = await ouvrir({}, { url: 'https://example.org/x' });
    assert.equal(sansPartition.ok, true);
    assert.equal(h.electron.windows[avant + 1].options.webPreferences.partition, undefined);
    // Échec de chargement (loadURL rejette) : journalisé, pas d'exception.
    h.electron.BrowserWindow.prototype.loadURL = function (u) {
      this.loadedUrl = u;
      return Promise.reject(new Error('refusé'));
    };
    const rejete = await ouvrir({}, { url: 'https://example.org/y' });
    assert.equal(rejete.ok, true);
  } finally { h.cleanup(); }
});

// Charge main.js avec, en plus d'electron : un child_process simulé (spawn
// enregistré, jamais exécuté) et un fs « chrome détecté » — pour couvrir le
// lancement du navigateur externe sans lancer quoi que ce soit.
function loadMainAvecNavigateur(appDataDir, { erreurLib = false, echecSpawn = false, nomSysteme = 'Google Chrome', aucun = false } = {}) {
  const electron = createElectronMock(appDataDir);
  const lanceurs = [];
  const vraiExiste = fs.existsSync;
  fs.existsSync = aucun ? () => false : (p) => (p === '/usr/bin/google-chrome' ? true : vraiExiste(p));
  // Nom applicatif que le système associe à https (défaut système) : valeur
  // libre, ou Error pour simuler une API indisponible.
  electron.app.getApplicationNameForProtocol = () => {
    if (nomSysteme instanceof Error) throw nomSysteme;
    return nomSysteme;
  };
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === 'electron') return electron;
    if (request === 'child_process') {
      return {
        spawn: (commande, args, opts) => {
          if (echecSpawn === 'brut') throw 'échec spawn brut'; // non-Error
          if (echecSpawn) throw new Error('spawn impossible');
          lanceurs.push({ commande, args, opts });
          return { unref: () => {} };
        }
      };
    }
    if (request === './lib/liens-contexte' && erreurLib) {
      const vrai = originalLoad.apply(this, arguments);
      return Object.assign(Object.create(null), vrai, { drapeauPrive: () => '' });
    }
    return originalLoad.apply(this, arguments);
  };
  const silence = { warn: console.warn, log: console.log, error: console.error };
  console.warn = console.log = console.error = () => {};
  try {
    delete require.cache[MAIN_PATH];
    require(MAIN_PATH);
  } finally {
    Module._load = originalLoad;
    Object.assign(console, silence);
  }
  // NB : fs.existsSync reste patché jusqu'au cleanup — la détection des
  // navigateurs (etatNavigateurs) se fait à l'appel du gestionnaire IPC,
  // pas au chargement de main.js.
  return {
    electron,
    lanceurs,
    cleanup() {
      fs.existsSync = vraiExiste;
      delete require.cache[MAIN_PATH];
      fs.rmSync(appDataDir, { recursive: true, force: true });
    }
  };
}

test('links:ouvrir-externe-prive lance le navigateur choisi avec son drapeau', async (t) => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-liens-prive-'));
  const h = loadMainAvecNavigateur(appDataDir);
  try {
    // Réglage : navigateur externe choisi (lu depuis settings.json).
    fs.mkdirSync(path.join(appDataDir, 'userData'), { recursive: true });
    fs.writeFileSync(path.join(appDataDir, 'userData', 'settings.json'), JSON.stringify({ navigateurExterne: 'chrome' }));
    const ouvrir = h.electron.ipcHandlers.get('links:ouvrir-externe-prive');
    const res = await ouvrir({}, 'https://example.org/prive');
    assert.equal(res.ok, true);
    assert.deepEqual(h.lanceurs.map((l) => [l.commande, l.args]), [
      ['/usr/bin/google-chrome', ['--incognito', 'https://example.org/prive']]
    ]);
  } finally { h.cleanup(); }
});

test('links:ouvrir-externe-prive remonte l’échec du lancement', async (t) => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-liens-prive-'));
  const h = loadMainAvecNavigateur(appDataDir, { echecSpawn: true });
  try {
    const ouvrir = h.electron.ipcHandlers.get('links:ouvrir-externe-prive');
    const res = await ouvrir({}, 'https://example.org/prive');
    assert.equal(res.ok, false);
    assert.equal(res.erreur, 'spawn impossible');
  } finally { h.cleanup(); }
});

test('links:ouvrir-externe-prive remonte un échec brut (non-Error) du lancement', async (t) => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-liens-prive-'));
  const h = loadMainAvecNavigateur(appDataDir, { echecSpawn: 'brut' });
  try {
    const ouvrir = h.electron.ipcHandlers.get('links:ouvrir-externe-prive');
    const res = await ouvrir({}, 'https://example.org/prive');
    assert.equal(res.ok, false);
    assert.equal(res.erreur, 'échec spawn brut');
  } finally { h.cleanup(); }
});

test('links:ouvrir-externe-prive signale l’absence de navigateur détecté', async (t) => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-liens-prive-'));
  const h = loadMainAvecNavigateur(appDataDir, { aucun: true });
  try {
    const ouvrir = h.electron.ipcHandlers.get('links:ouvrir-externe-prive');
    const res = await ouvrir({}, 'https://example.org/prive');
    assert.equal(res.ok, false);
    assert.equal(res.erreur, 'aucun navigateur externe détecté');
    assert.deepEqual(h.lanceurs, []);
  } finally { h.cleanup(); }
});

test('links:ouvrir-externe-prive refuse un navigateur sans navigation privée connue', async (t) => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-liens-prive-'));
  const h = loadMainAvecNavigateur(appDataDir, { erreurLib: true });
  try {
    const ouvrir = h.electron.ipcHandlers.get('links:ouvrir-externe-prive');
    const res = await ouvrir({}, 'https://example.org/prive');
    assert.equal(res.ok, false);
    assert.match(res.erreur, /^navigation privée non prise en charge/);
  } finally { h.cleanup(); }
});

test('links:navigateurs-detectes rapproche le défaut du système d’un navigateur détecté', async (t) => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-liens-navig-'));
  const h = loadMainAvecNavigateur(appDataDir, { nomSysteme: 'Google Chrome' });
  try {
    const etat = await h.electron.ipcHandlers.get('links:navigateurs-detectes')({});
    assert.ok(etat.detectes.some((n) => n.id === 'chrome'));
    assert.equal(etat.defautSysteme, 'chrome');
  } finally { h.cleanup(); }
});

test('links:navigateurs-detectes développe les variables d’environnement des chemins Windows', async (t) => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-liens-navig-'));
  const h = loadMainAvecNavigateur(appDataDir);
  try {
    // Sous win32, les candidats contiennent %ProgramFiles%... : le développeur
    // de chemin remplace la variable par sa valeur d’environnement.
    const vraiPlateforme = process.platform;
    const vraiProgramFiles = process.env.ProgramFiles;
    process.env.ProgramFiles = 'C:\\Program Files';
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const etat = await h.electron.ipcHandlers.get('links:navigateurs-detectes')({});
      // Les chemins détectés, le cas échéant, sont développés (plus de %...%).
      for (const n of etat.detectes) assert.ok(!n.commande.includes('%'));
    } finally {
      Object.defineProperty(process, 'platform', { value: vraiPlateforme, configurable: true });
      if (vraiProgramFiles === undefined) delete process.env.ProgramFiles;
      else process.env.ProgramFiles = vraiProgramFiles;
    }
  } finally { h.cleanup(); }
});

test('links:navigateurs-detectes survive à une API de défaut système indisponible', async (t) => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-liens-navig-'));
  const h = loadMainAvecNavigateur(appDataDir, { nomSysteme: new Error('API absente') });
  try {
    const etat = await h.electron.ipcHandlers.get('links:navigateurs-detectes')({});
    assert.ok(Array.isArray(etat.detectes));
    assert.equal(etat.defautSysteme, null, 'pas de défaut détecté, pas d’erreur');
  } finally { h.cleanup(); }
});

test('links:ouvrir-externe-prive refuse le non web sans lancer de processus', async (t) => {
  const h = loadMain();
  try {
    const ouvrir = h.electron.ipcHandlers.get('links:ouvrir-externe-prive');
    const refuse = await ouvrir({}, 'ftp://example.org/');
    assert.equal(refuse.ok, false);
    assert.equal(refuse.erreur, 'adresse non web');
  } finally { h.cleanup(); }
});

test('links:navigateurs-detectes renvoie la forme attendue', async (t) => {
  const h = loadMain();
  try {
    const etat = await h.electron.ipcHandlers.get('links:navigateurs-detectes')({});
    assert.ok(Array.isArray(etat.detectes));
    for (const n of etat.detectes) {
      assert.equal(typeof n.id, 'string'); assert.equal(typeof n.nom, 'string');
      assert.equal(typeof n.commande, 'string');
    }
    // Harnais : le système « associe https à Google Chrome » (mock app) ;
    // sans navigateur détecté sur la machine de test, pas de défaut.
    assert.ok(etat.defautSysteme === null || typeof etat.defautSysteme === 'string');
  } finally { h.cleanup(); }
});
