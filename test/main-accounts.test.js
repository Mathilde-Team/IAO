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

function loadMain(preparer) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-main-accounts-'));
  if (preparer) preparer(path.join(tmp, 'userData'));
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

  return {
    tmp, state, invoke,
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

// --- Issue #329 : sauvegarde complète et restauration au démarrage -------------

test('#329 démarrage : une restauration en attente remplace les données avant toute session', () => {
  const h = loadMain((userData) => {
    fs.mkdirSync(path.join(userData, 'restauration-en-attente'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'settings.json'), 'actuel');
    fs.writeFileSync(path.join(userData, 'restauration-en-attente', 'settings.json'), 'restauré');
  });
  try {
    const userData = path.join(h.tmp, 'userData');
    assert.equal(fs.readFileSync(path.join(userData, 'settings.json'), 'utf-8'), 'restauré');
    const avant = fs.readdirSync(userData).filter((n) => n.startsWith('avant-restauration-'));
    assert.equal(avant.length, 1);
    assert.equal(fs.readFileSync(path.join(userData, avant[0], 'settings.json'), 'utf-8'), 'actuel');
    assert.equal(fs.existsSync(path.join(userData, 'restauration-en-attente')), false);
  } finally { h.cleanup(); }
});

test('#329 démarrage : restauration impossible -> données laissées en place', () => {
  const h = loadMain((userData) => {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(path.join(userData, 'settings.json'), 'actuel');
    fs.writeFileSync(path.join(userData, 'restauration-en-attente'), 'pas un dossier');
  });
  try {
    assert.equal(fs.readFileSync(path.join(h.tmp, 'userData', 'settings.json'), 'utf-8'), 'actuel');
  } finally { h.cleanup(); }
});

test('#329 sauvegarde:creer puis sauvegarde:choisir et sauvegarde:restaurer via main.js', async () => {
  const h = loadMain();
  try {
    const userData = path.join(h.tmp, 'userData');
    fs.writeFileSync(path.join(userData, 'settings.json'), '{"theme":"dark"}');
    const zip = path.join(h.tmp, 'sauvegarde.zip');
    h.state.saveResult = { canceled: false, filePath: zip };
    const r = await h.invoke('sauvegarde:creer', '');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(h.state.saveDialogArgs.defaultPath, /^iao-sauvegarde-\d{4}-\d{2}-\d{2}\.zip$/);
    h.state.openResult = { canceled: false, filePaths: [zip] };
    const choix = await h.invoke('sauvegarde:choisir');
    assert.deepEqual([choix.ok, choix.motDePasseRequis], [true, false]);
    assert.equal((await h.invoke('sauvegarde:restaurer', '')).ok, true);
    assert.equal(fs.existsSync(path.join(userData, 'restauration-en-attente', 'settings.json')), true);
  } finally { h.cleanup(); }
});
