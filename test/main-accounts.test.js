'use strict';

// Issue #95 (55.26) : couverture des handlers IPC « comptes » de main.js
// (accounts:export, accounts:import, accounts:disconnect-profile).
// Réutilise le principe du harnais de l'issue #93 (test/main-harness.test.js) :
// `require('electron')` est intercepté par Module._load et remplacé par un
// module simulé. Ici dialog et session sont pilotables par test. Aucun accès
// réseau ; toutes les écritures/lectures se font dans un dossier temporaire.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');

function loadMain() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-main-accounts-'));
  const ipcHandlers = new Map();
  const state = {
    saveDialogArgs: null,
    openDialogArgs: null,
    saveResult: { canceled: true },
    openResult: { canceled: true, filePaths: [] },
    partitions: [],
    clearImpl: async () => {}
  };

  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.getURL = () => 'file:///index.html';
    }
    loadFile() {}
    setMenuBarVisibility() {}
    isMinimized() { return false; }
    restore() {}
    focus() {}
    static getAllWindows() { return []; }
  }

  const electron = {
    app: {
      getPath: (name) => (name === 'appData' ? tmp : path.join(tmp, name)),
      setPath() {},
      getVersion: () => '0.0.0-test',
      isPackaged: false,
      setName() {},
      requestSingleInstanceLock: () => true,
      quit() {},
      on() { return this; },
      whenReady: () => ({ then() { return this; } })
    },
    BrowserWindow,
    ipcMain: {
      handle: (channel, fn) => { ipcHandlers.set(channel, fn); },
      on: (channel, fn) => { ipcHandlers.set(channel, fn); }
    },
    dialog: {
      showSaveDialog: async (win, opts) => { state.saveDialogArgs = opts; return state.saveResult; },
      showOpenDialog: async (win, opts) => { state.openDialogArgs = opts; return state.openResult; }
    },
    session: {
      fromPartition: (name) => {
        state.partitions.push(name);
        return { clearStorageData: () => state.clearImpl() };
      },
      defaultSession: {}
    },
    shell: { openExternal() {} }
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === 'electron') return electron;
    return originalLoad.apply(this, arguments);
  };
  const { warn, log, error } = console;
  console.warn = console.log = console.error = () => {};
  try {
    delete require.cache[MAIN_PATH];
    require(MAIN_PATH);
  } finally {
    Module._load = originalLoad;
    console.warn = warn; console.log = log; console.error = error;
  }

  // console.error est neutralisé pendant l'appel des handlers (chemins d'erreur).
  const invoke = async (channel, ...args) => {
    const quiet = console.error;
    console.error = () => {};
    try { return await ipcHandlers.get(channel)({}, ...args); }
    finally { console.error = quiet; }
  };

  // Canaux synchrones (ipcMain.on + event.returnValue), issue #331.
  // Canaux synchrones (ipcMain.on + event.returnValue), issue #311.
  const envoyerSync = (channel, ...args) => {
    const quiet = console.error;
    console.error = () => {};
    const event = {};
    try { ipcHandlers.get(channel)(event, ...args); return event.returnValue; }
    finally { console.error = quiet; }
  };

  return {
    tmp, state, invoke, envoyerSync,
    cleanup() {
      delete require.cache[MAIN_PATH];
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
}

// --- accounts:export ---------------------------------------------------------

test('accounts:export : dialogue annulé -> { canceled: true } sans rien écrire', async () => {
  const h = loadMain();
  try {
    h.state.saveResult = { canceled: true };
    assert.deepEqual(await h.invoke('accounts:export', '{"a":1}'), { canceled: true });
    assert.equal(h.state.saveDialogArgs.title, 'Exporter les comptes');
    assert.match(h.state.saveDialogArgs.defaultPath, /^iao-comptes-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);
    assert.deepEqual(h.state.saveDialogArgs.filters, [{ name: 'JSON', extensions: ['json'] }]);
    // main.js crée lui-même <tmp>/userData : on vérifie seulement qu'aucun export n'a été écrit.
    assert.equal(fs.readdirSync(h.tmp).some((name) => name.endsWith('.json')), false);
  } finally { h.cleanup(); }
});

test('accounts:export : réponse sans filePath traitée comme une annulation', async () => {
  const h = loadMain();
  try {
    h.state.saveResult = { canceled: false };
    assert.deepEqual(await h.invoke('accounts:export', '{}'), { canceled: true });
  } finally { h.cleanup(); }
});

test('accounts:export : succès -> fichier écrit en UTF-8 et chemin renvoyé', async () => {
  const h = loadMain();
  try {
    const filePath = path.join(h.tmp, 'export.json');
    const content = '{"comptes":[{"nom":"Élodie"}]}';
    h.state.saveResult = { canceled: false, filePath };
    assert.deepEqual(await h.invoke('accounts:export', content), { canceled: false, filePath });
    assert.equal(fs.readFileSync(filePath, 'utf-8'), content);
  } finally { h.cleanup(); }
});

test('accounts:export : erreur disque -> { canceled: false, error: "write_failed" }', async () => {
  const h = loadMain();
  try {
    const filePath = path.join(h.tmp, 'dossier-absent', 'export.json');
    h.state.saveResult = { canceled: false, filePath };
    assert.deepEqual(await h.invoke('accounts:export', '{}'), { canceled: false, error: 'write_failed' });
    assert.equal(fs.existsSync(filePath), false);
  } finally { h.cleanup(); }
});

// --- accounts:import ---------------------------------------------------------

test('accounts:import : dialogue annulé -> { canceled: true }', async () => {
  const h = loadMain();
  try {
    h.state.openResult = { canceled: true, filePaths: [] };
    assert.deepEqual(await h.invoke('accounts:import'), { canceled: true });
    assert.equal(h.state.openDialogArgs.title, 'Importer des comptes');
    assert.deepEqual(h.state.openDialogArgs.properties, ['openFile']);
    assert.deepEqual(h.state.openDialogArgs.filters, [{ name: 'JSON', extensions: ['json'] }]);
  } finally { h.cleanup(); }
});

test('accounts:import : aucune sélection (filePaths vide) -> { canceled: true }', async () => {
  const h = loadMain();
  try {
    h.state.openResult = { canceled: false, filePaths: [] };
    assert.deepEqual(await h.invoke('accounts:import'), { canceled: true });
  } finally { h.cleanup(); }
});

test('accounts:import : succès -> contenu du fichier et chemin renvoyés', async () => {
  const h = loadMain();
  try {
    const filePath = path.join(h.tmp, 'import.json');
    const content = '{"comptes":[{"nom":"Zoé"}]}';
    fs.writeFileSync(filePath, content, 'utf-8');
    h.state.openResult = { canceled: false, filePaths: [filePath] };
    assert.deepEqual(await h.invoke('accounts:import'), { canceled: false, filePath, content });
  } finally { h.cleanup(); }
});

test('accounts:import : erreur de lecture -> { canceled: false, error: "read_failed" }', async () => {
  const h = loadMain();
  try {
    h.state.openResult = { canceled: false, filePaths: [path.join(h.tmp, 'absent.json')] };
    assert.deepEqual(await h.invoke('accounts:import'), { canceled: false, error: 'read_failed' });
  } finally { h.cleanup(); }
});

// --- accounts:disconnect-profile --------------------------------------------

test('accounts:disconnect-profile : profil invalide -> invalid_profile, session non touchée', async () => {
  const h = loadMain();
  try {
    for (const bad of [undefined, null, '', 0, 42, {}, ['profil_1']]) {
      assert.deepEqual(await h.invoke('accounts:disconnect-profile', bad), { ok: false, error: 'invalid_profile' });
    }
    assert.deepEqual(h.state.partitions, []);
  } finally { h.cleanup(); }
});

test('accounts:disconnect-profile : succès -> purge de la partition persist:<profil>', async () => {
  const h = loadMain();
  try {
    let cleared = 0;
    h.state.clearImpl = async () => { cleared++; };
    assert.deepEqual(await h.invoke('accounts:disconnect-profile', 'profil_3'), { ok: true });
    assert.deepEqual(h.state.partitions, ['persist:profil_3']);
    assert.equal(cleared, 1);
  } finally { h.cleanup(); }
});

test('accounts:disconnect-profile : échec de clearStorageData -> clear_failed', async () => {
  const h = loadMain();
  try {
    h.state.clearImpl = async () => { throw new Error('boom'); };
    assert.deepEqual(await h.invoke('accounts:disconnect-profile', 'profil_4'), { ok: false, error: 'clear_failed' });
    assert.deepEqual(h.state.partitions, ['persist:profil_4']);
  } finally { h.cleanup(); }
});

// --- preferences:lire / preferences:ecrire (issue #331) -----------------------

const CLES_PREFS = ['ai_active_services', 'ai_account_order', 'ai_starred_tabs', 'collapsed_accounts', 'ide_w', 'explorer_w'];

test('#331 preferences:lire : premier démarrage -> absent, avec la liste des clés', () => {
  const h = loadMain();
  try {
    assert.deepEqual(h.envoyerSync('preferences:lire'), { cles: CLES_PREFS, status: 'absent' });
  } finally { h.cleanup(); }
});

test('#331 preferences:ecrire puis preferences:lire : <userData>/preferences.json', () => {
  const h = loadMain();
  try {
    const prefs = { ai_active_services: ['claude'], ide_w: '420px' };
    assert.deepEqual(h.envoyerSync('preferences:ecrire', prefs), { ok: true, cles: 2 });
    const fichier = path.join(h.tmp, 'userData', 'preferences.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(fichier, 'utf-8')), prefs);
    assert.deepEqual(h.envoyerSync('preferences:lire'), { cles: CLES_PREFS, status: 'ok', preferences: prefs });
  } finally { h.cleanup(); }
});

test('#331 preferences:ecrire invalide et preferences:lire illisible : journalisés, rien d\'écrit', () => {
  const h = loadMain();
  try {
    assert.equal(h.envoyerSync('preferences:ecrire', ['pas un objet']).ok, false);
    const dossier = path.join(h.tmp, 'userData');
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, 'preferences.json'), '{tronqué');
    assert.equal(h.envoyerSync('preferences:lire').status, 'corrompu');
  } finally { h.cleanup(); }
});

// --- profils:lire / profils:ecrire (issue #311) -------------------------------

test('#311 profils:lire : premier démarrage -> absent', () => {
  const h = loadMain();
  try {
    assert.deepEqual(h.envoyerSync('profils:lire'), { status: 'absent' });
  } finally { h.cleanup(); }
});

test('#311 profils:ecrire puis profils:lire : comptes dans <userData>/profils.json', () => {
  const h = loadMain();
  try {
    const comptes = [{ id: 'a1', name: 'Alice', email: 'a@x.fr', profile: 'alice' }];
    assert.deepEqual(h.envoyerSync('profils:ecrire', comptes), { ok: true, nombre: 1 });
    const fichier = path.join(h.tmp, 'userData', 'profils.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(fichier, 'utf-8')), comptes);
    assert.deepEqual(h.envoyerSync('profils:lire'), { status: 'ok', comptes });
  } finally { h.cleanup(); }
});

test('#311 profils:ecrire : liste invalide -> { ok: false }, rien d\'écrit', () => {
  const h = loadMain();
  try {
    const r = h.envoyerSync('profils:ecrire', { pas: 'un tableau' });
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(path.join(h.tmp, 'userData', 'profils.json')), false);
  } finally { h.cleanup(); }
});

test('#311 profils:lire : fichier illisible -> corrompu, avec ou sans sauvegarde', () => {
  const h = loadMain();
  try {
    const dossier = path.join(h.tmp, 'userData');
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, 'profils.json'), '{tronqué');
    const sans = h.envoyerSync('profils:lire');
    assert.equal(sans.status, 'corrompu');
    assert.equal(sans.sauvegarde, null);
    fs.writeFileSync(path.join(dossier, 'profils.json.bak'), JSON.stringify([{ id: 'b' }]));
    const avec = h.envoyerSync('profils:lire');
    assert.equal(avec.status, 'corrompu');
    assert.deepEqual(avec.sauvegarde, [{ id: 'b' }]);
  } finally { h.cleanup(); }
});
