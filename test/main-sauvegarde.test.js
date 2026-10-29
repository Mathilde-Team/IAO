'use strict';

// Issue #329 : couverture des handlers IPC de sauvegarde complète de main.js
// (sauvegarde-complete:creer / sauvegarde-complete:restaurer). Chargement de
// main.js avec un module `electron` simulé (même principe que
// test/main-harness.test.js, #93) : dialog dirigé par le test, trousseau
// factice, aucune fenêtre réelle, écritures uniquement dans un dossier temporaire.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const EventEmitter = require('node:events');

const z = require('../lib/ecriture-zip');
const lecture = require('../lib/lecture-zip');
const { secretsEnClair } = require('../lib/sauvegarde-complete');

const ROOT = path.join(__dirname, '..');
const MAIN_PATH = path.join(ROOT, 'main.js');

// Trousseau factice : « ts:clair » (base64 côté main.js) — tout le reste est
// déclaré illisible (autre machine), comme safeStorage qui lèverait.
const PREFIXE_TROUSSEAU = 'ts:';

function createElectronMock(appDataDir) {
  const ipcHandlers = new Map();
  const app = {
    getPath: (name) => (name === 'appData' ? appDataDir : path.join(appDataDir, name)),
    setPath() {},
    setName() {},
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    quit() {},
    on() { return this; },
    whenReady: () => ({ then() { return this; } })
  };
  class BrowserWindow extends EventEmitter {
    static getAllWindows() { return []; }
  }
  const ipcMain = {
    handle: (channel, fn) => { ipcHandlers.set(channel, fn); },
    on: (channel, fn) => { ipcHandlers.set(channel, fn); }
  };
  const session = { fromPartition: () => ({}), defaultSession: {} };
  const dialog = {
    // Dirigé par le test : chaque scénario pose dialog.save / dialog.open.
    save: { canceled: true },
    open: { canceled: true, filePaths: [] },
    appels: 0,
    showSaveDialog: async () => { dialog.appels++; return dialog.save; },
    showOpenDialog: async () => { dialog.appels++; return dialog.open; }
  };
  const shell = { openExternal() {} };
  const safeStorage = {
    encryptString: (clair) => Buffer.from(PREFIXE_TROUSSEAU + clair, 'utf8'),
    decryptString: (buf) => {
      const s = buf.toString('utf8');
      if (!s.startsWith(PREFIXE_TROUSSEAU)) throw new Error('chiffré par un autre trousseau');
      return s.slice(PREFIXE_TROUSSEAU.length);
    }
  };
  return { app, BrowserWindow, ipcMain, dialog, shell, session, safeStorage, ipcHandlers };
}

// Charge une copie neuve de main.js ; renvoie les handlers et le dossier de
// données simulé (<appData>/userData, comme test/main-settings.test.js).
function loadMain() {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-main-sauvegarde-'));
  const electron = createElectronMock(appDataDir);
  const userData = path.join(appDataDir, 'userData');
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
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
    userData,
    creer: electron.ipcHandlers.get('sauvegarde-complete:creer'),
    restaurer: electron.ipcHandlers.get('sauvegarde-complete:restaurer'),
    cleanup() {
      delete require.cache[MAIN_PATH];
      fs.rmSync(appDataDir, { recursive: true, force: true });
    }
  };
}

// Dossier de données type : comptes, statistiques, journal (exclu) et secrets.
function preparerDonnees(h, { avecSecrets = true, secretIllisible = false } = {}) {
  fs.mkdirSync(path.join(h.userData, 'stats'), { recursive: true });
  fs.mkdirSync(path.join(h.userData, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(h.userData, 'har'), { recursive: true });
  fs.writeFileSync(path.join(h.userData, 'profils.json'), '{"comptes":[]}', 'utf8');
  fs.writeFileSync(path.join(h.userData, 'stats/sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(h.userData, 'logs/iao.log'), 'journal', 'utf8');
  fs.writeFileSync(path.join(h.userData, 'har/capture.har'), 'har', 'utf8');
  if (avecSecrets) {
    const coffre = secretIllisible
      ? { 'profil_1': Buffer.from('chiffre-ailleurs').toString('base64') }
      : { 'profil_1': Buffer.from(PREFIXE_TROUSSEAU + 'motdepasse').toString('base64') };
    fs.writeFileSync(path.join(h.userData, 'secrets.json'), JSON.stringify(coffre), 'utf8');
  }
}

function lireZipFichier(fichier) {
  const lecteur = lecture.lecteurDeBuffer(fs.readFileSync(fichier));
  return { lecteur, entrees: lecture.lireEntrees(lecteur) };
}

// Zip fabriqué à la main (stocké) avec un nom d'entrée non sûr : ecrireZip le
// refuserait, la garde de restauration doit le refuser aussi.
function zipAvecNomDangereux(nom) {
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  const nomBuf = Buffer.from(nom, 'utf8');
  const contenu = Buffer.from('piège');
  const crc = z.crc32(contenu);
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
    u32(crc), u32(contenu.length), u32(contenu.length), u16(nomBuf.length), u16(0), nomBuf, contenu
  ]);
  const central = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
    u32(crc), u32(contenu.length), u32(contenu.length), u16(nomBuf.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(0), nomBuf
  ]);
  const fin = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(local.length), u16(0)
  ]);
  return Buffer.concat([local, central, fin]);
}

// --- Création --------------------------------------------------------------

test('creer : mot de passe vide refusé sans ouvrir de dialogue', async () => {
  const h = loadMain();
  try {
    assert.deepEqual(await h.creer(null, ''), { canceled: false, error: 'mot_de_passe_vide' });
    assert.deepEqual(await h.creer(null, undefined), { canceled: false, error: 'mot_de_passe_vide' });
    assert.equal(h.electron.dialog.appels, 0, 'aucun dialogue ouvert');
  } finally { h.cleanup(); }
});

test('creer : dialogue annulé -> canceled, rien n’est écrit', async () => {
  const h = loadMain();
  try {
    assert.deepEqual(await h.creer(null, 'mdp'), { canceled: true });
  } finally { h.cleanup(); }
});

test('creer : zip du dossier utile, secrets transportables, journal exclu', async (t) => {
  const h = loadMain();
  try {
    preparerDonnees(h);
    const cible = path.join(h.userData, '..', 'sauvegarde.zip');
    h.electron.dialog.save = { canceled: false, filePath: cible };
    const res = await h.creer(null, 'mot-de-sauvegarde');
    assert.equal(res.canceled, false);
    assert.equal(res.entrees, 3); // profils.json, stats/sessions.jsonl, secrets-sauvegarde.json
    assert.ok(res.taille > 0);
    const { lecteur, entrees } = lireZipFichier(cible);
    assert.deepEqual(entrees.map((e) => e.nom).sort(),
      ['profils.json', 'secrets-sauvegarde.json', 'stats/sessions.jsonl']);
    // secrets.json est remplacé par sa forme transportable : déchiffrable avec
    // le mot de passe de la sauvegarde, mot de passe en clair nulle part.
    const portable = JSON.parse(lecture.extraire(lecteur,
      entrees.find((e) => e.nom === 'secrets-sauvegarde.json'), { tailleMax: 1024 * 1024 }).toString('utf8'));
    assert.deepEqual(secretsEnClair(portable, 'mot-de-sauvegarde', require('node:crypto')),
      { profil_1: 'motdepasse' });
    assert.ok(!fs.readFileSync(cible).includes('motdepasse'));
  } finally { h.cleanup(); }
});

test('creer : sans secrets.json, sauvegarde sans mots de passe', async () => {
  const h = loadMain();
  try {
    preparerDonnees(h, { avecSecrets: false });
    const cible = path.join(h.userData, '..', 'sauvegarde.zip');
    h.electron.dialog.save = { canceled: false, filePath: cible };
    const res = await h.creer(null, 'mdp');
    assert.equal(res.canceled, false);
    const { entrees } = lireZipFichier(cible);
    assert.ok(!entrees.some((e) => e.nom === 'secrets-sauvegarde.json'));
  } finally { h.cleanup(); }
});

test('creer : un secret illisible ici (autre trousseau) est omis, pas bloquant', async () => {
  const h = loadMain();
  try {
    preparerDonnees(h, { secretIllisible: true });
    const cible = path.join(h.userData, '..', 'sauvegarde.zip');
    h.electron.dialog.save = { canceled: false, filePath: cible };
    const res = await h.creer(null, 'mdp');
    assert.equal(res.canceled, false);
    const { entrees } = lireZipFichier(cible);
    assert.ok(!entrees.some((e) => e.nom === 'secrets-sauvegarde.json'));
  } finally { h.cleanup(); }
});

test('creer : échec d’écriture -> erreur nette, pas d’exception', async () => {
  const h = loadMain();
  try {
    preparerDonnees(h);
    h.electron.dialog.save = { canceled: false, filePath: path.join(h.userData, 'dossier-absent', 'x.zip') };
    const res = await h.creer(null, 'mdp');
    assert.deepEqual(res, { canceled: false, error: 'ecriture' });
  } finally { h.cleanup(); }
});

test('creer : un sous-dossier illisible est sauté, pas fatal', async (t) => {
  const h = loadMain();
  const originalReaddir = fs.readdirSync;
  try {
    preparerDonnees(h);
    fs.mkdirSync(path.join(h.userData, 'interdit'));
    fs.writeFileSync(path.join(h.userData, 'interdit/x.txt'), 'x');
    fs.readdirSync = function (dir, ...rest) {
      if (String(dir).includes('interdit')) throw new Error('EACCES simulé');
      return originalReaddir.call(fs, dir, ...rest);
    };
    const cible = path.join(h.userData, '..', 'sauvegarde.zip');
    h.electron.dialog.save = { canceled: false, filePath: cible };
    const res = await h.creer(null, 'mdp');
    assert.equal(res.canceled, false);
    const { entrees } = lireZipFichier(cible);
    assert.ok(!entrees.some((e) => e.nom === 'interdit/x.txt'));
  } finally {
    fs.readdirSync = originalReaddir;
    h.cleanup();
  }
});

// --- Restauration ----------------------------------------------------------

test('restaurer : mot de passe vide refusé, dialogue annulé -> canceled', async () => {
  const h = loadMain();
  try {
    assert.deepEqual(await h.restaurer(null, ''), { canceled: false, error: 'mot_de_passe_vide' });
    assert.deepEqual(await h.restaurer(null, 'mdp'), { canceled: true });
  } finally { h.cleanup(); }
});

test('restaurer : mot de passe faux refusé AVANT toute écriture', async (t) => {
  const h = loadMain();
  try {
    preparerDonnees(h);
    const cible = path.join(h.userData, '..', 'sauvegarde.zip');
    h.electron.dialog.save = { canceled: false, filePath: cible };
    await h.creer(null, 'bon-mot-de-passe');
    // dossier de données vierge : la restauration ne doit rien écrire dedans.
    fs.rmSync(h.userData, { recursive: true, force: true });
    fs.mkdirSync(h.userData, { recursive: true });
    fs.writeFileSync(path.join(h.userData, 'avant.txt'), 'état avant');
    h.electron.dialog.open = { canceled: false, filePaths: [cible] };
    const res = await h.restaurer(null, 'mauvais-mot-de-passe');
    assert.deepEqual(res, { canceled: false, error: 'mot_de_passe_faux' });
    assert.deepEqual(fs.readdirSync(h.userData), ['avant.txt']); // rien écrit
  } finally { h.cleanup(); }
});

test('restaurer : fichiers restaurés, secrets rechiffrés au trousseau local, redémarrage proposé', async (t) => {
  const h = loadMain();
  try {
    preparerDonnees(h);
    const cible = path.join(h.userData, '..', 'sauvegarde.zip');
    h.electron.dialog.save = { canceled: false, filePath: cible };
    await h.creer(null, 'mot-de-sauvegarde');
    fs.rmSync(h.userData, { recursive: true, force: true });
    fs.mkdirSync(h.userData, { recursive: true });
    h.electron.dialog.open = { canceled: false, filePaths: [cible] };
    const res = await h.restaurer(null, 'mot-de-sauvegarde');
    assert.equal(res.canceled, false);
    assert.equal(res.redemarrer, true);
    assert.equal(fs.readFileSync(path.join(h.userData, 'profils.json'), 'utf8'), '{"comptes":[]}');
    // secrets.json rechiffré par le trousseau factice, pas le mot de passe du zip.
    const coffre = JSON.parse(fs.readFileSync(path.join(h.userData, 'secrets.json'), 'utf8'));
    assert.equal(Buffer.from(coffre.profil_1, 'base64').toString('utf8'), PREFIXE_TROUSSEAU + 'motdepasse');
    assert.ok(!fs.existsSync(path.join(h.userData, 'logs/iao.log')), 'le journal n’est pas dans la sauvegarde');
  } finally { h.cleanup(); }
});

test('restaurer : zip sans secrets -> données restaurées, secrets.json inchangés', async () => {
  const h = loadMain();
  try {
    preparerDonnees(h, { avecSecrets: false });
    const cible = path.join(h.userData, '..', 'sauvegarde.zip');
    h.electron.dialog.save = { canceled: false, filePath: cible };
    await h.creer(null, 'mdp');
    fs.writeFileSync(path.join(h.userData, 'secrets.json'), '{"local":"existant"}');
    h.electron.dialog.open = { canceled: false, filePaths: [cible] };
    const res = await h.restaurer(null, 'mdp');
    assert.equal(res.canceled, false);
    assert.equal(fs.readFileSync(path.join(h.userData, 'secrets.json'), 'utf8'), '{"local":"existant"}');
  } finally { h.cleanup(); }
});

test('restaurer : entrée de zip au nom dangereux -> refus net, rien écrit', async () => {
  const h = loadMain();
  try {
    const cible = path.join(h.userData, '..', 'piege.zip');
    fs.writeFileSync(cible, zipAvecNomDangereux('../evil.txt'));
    fs.mkdirSync(h.userData, { recursive: true });
    h.electron.dialog.open = { canceled: false, filePaths: [cible] };
    const res = await h.restaurer(null, 'mdp');
    assert.equal(res.canceled, false);
    assert.equal(res.error, 'entree_non_sure');
    // l'entrée dangereuse n'a été extraite nulle part (les dossiers de
    // démarrage logs/ et scheduler/ existent déjà, eux).
    const existants = [];
    const visiter = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) visiter(p); else existants.push(path.relative(h.userData, p));
      }
    };
    visiter(h.userData);
    assert.ok(!existants.some((f) => f.endsWith('evil.txt')), 'rien extrait : ' + existants.join(', '));
    assert.ok(!fs.existsSync(path.join(path.dirname(h.userData), 'evil.txt')), 'rien remonté au-dessus');
  } finally { h.cleanup(); }
});

test('creer : erreur d’écriture sans message (repli sur l’erreur brute)', async () => {
  const h = loadMain();
  const originalWrite = fs.promises.writeFile;
  fs.promises.writeFile = async () => { throw 'panne disque'; };
  try {
    preparerDonnees(h);
    h.electron.dialog.save = { canceled: false, filePath: path.join(h.userData, 'x.zip') };
    const res = await h.creer(null, 'mdp');
    assert.deepEqual(res, { canceled: false, error: 'ecriture' });
  } finally {
    fs.promises.writeFile = originalWrite;
    h.cleanup();
  }
});

test('restaurer : fichier non zip -> erreur de lecture nette', async () => {
  const h = loadMain();
  try {
    const cible = path.join(h.userData, '..', 'pas-un-zip.bin');
    fs.writeFileSync(cible, 'ceci n’est pas un zip');
    h.electron.dialog.open = { canceled: false, filePaths: [cible] };
    const res = await h.restaurer(null, 'mdp');
    assert.equal(res.canceled, false);
    assert.equal(res.error, 'lecture');
  } finally { h.cleanup(); }
});

test('restaurer : erreur de lecture sans message (repli sur l’erreur brute)', async () => {
  const h = loadMain();
  const originalRead = fs.promises.readFile;
  fs.promises.readFile = async () => { throw 'lecteur HS'; };
  try {
    h.electron.dialog.open = { canceled: false, filePaths: [path.join(h.userData, 'x.zip')] };
    const res = await h.restaurer(null, 'mdp');
    assert.equal(res.canceled, false);
    assert.equal(res.error, 'lecture');
  } finally { h.cleanup(); }
});
