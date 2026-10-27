'use strict';

// Issue #329 : lib/sauvegarde.js — sauvegarde complète du dossier de données
// et restauration, mots de passe rechiffrés avec le mot de passe de la
// sauvegarde.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const s = require('../lib/sauvegarde');
const lecture = require('../lib/lecture-zip');
const { EcrivainZip } = require('../lib/ecriture-zip');

const deps = { fs, path, crypto };
const MDP = 'correct horse';

// Trousseau factice : « K:<texte> » ; une autre machine a un autre préfixe.
const trousseau = (prefixe = 'K:') => ({
  chiffrer: (t) => Buffer.from(prefixe + t),
  dechiffrer: (b) => {
    const t = b.toString();
    if (!t.startsWith(prefixe)) throw new Error('clé du trousseau inconnue');
    return t.slice(prefixe.length);
  }
});
const b64 = (t, prefixe = 'K:') => Buffer.from(prefixe + t).toString('base64');

function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iao-sauv-'));
}

function ecrire(racine, relatif, contenu) {
  const f = path.join(racine, ...relatif.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenu);
}

// Dossier de données type : sessions, caches, journaux, mots de passe.
function dossierType(racine, avecSecrets = true) {
  ecrire(racine, 'settings.json', '{"theme":"dark"}');
  ecrire(racine, 'Local Storage/leveldb/000003.log', 'comptes');
  ecrire(racine, 'Local Storage/leveldb/LOCK', '');
  ecrire(racine, 'Partitions/profil_1/Cookies', 'cookie');
  ecrire(racine, 'Partitions/profil_1/Cache/Cache_Data/data_0', 'cache');
  ecrire(racine, 'Partitions/profil_1/Code Cache/js/x', 'cache');
  ecrire(racine, 'Partitions/profil_1/Service Worker/CacheStorage/a', 'cache');
  ecrire(racine, 'GPUCache/data_1', 'cache');
  ecrire(racine, 'logs/iao.log', 'journal');
  ecrire(racine, 'har/claude.har', 'har');
  ecrire(racine, 'stats/sessions.jsonl', '{}');
  ecrire(racine, 'profils.json.tmp', 'tmp');
  ecrire(racine, 'avant-restauration-2026-01-01T00-00-00/vieux', 'v');
  if (avecSecrets) {
    ecrire(racine, 'secrets.json', JSON.stringify({ profil_1: b64('mdp-mail'), casse: b64('x', 'AUTRE:') }));
    ecrire(racine, 'identifiants.json', JSON.stringify({
      'context7.com': [{ login: 'moi', secret: b64('mdp-site'), ajoute: '2026-10-01' }, null, { login: 'k', secret: b64('y', 'AUTRE:') }],
      'vide.com': [{ login: 'z', secret: b64('w', 'AUTRE:') }],
      'pas-une-liste.com': 'x'
    }));
  }
}

function lireArchive(f) {
  const fd = fs.openSync(f, 'r');
  try {
    const l = lecture.lecteurDeFichier(fd, fs);
    const entrees = lecture.lireEntrees(l);
    const contenu = {};
    for (const e of entrees) contenu[e.nom] = lecture.extraire(l, e).toString();
    return contenu;
  } finally { fs.closeSync(fd); }
}

test('#329 estExclu : caches, verrous, journaux, HAR, temporaires, fichiers du trousseau', () => {
  for (const r of ['logs', 'har/a.har', 'avant-restauration-x/a', 'restauration-en-attente/a', 'secrets.json', 'identifiants.json',
    'a.tmp', 'Partitions/p/Cache/x', 'GPUCache/x', 'SingletonLock', 'Local Storage/leveldb/LOCK']) {
    assert.equal(s.estExclu(r), true, r);
  }
  for (const r of ['settings.json', 'Partitions/p/Cookies', 'stats/sessions.jsonl', 'Partitions/p/secrets.json']) {
    assert.equal(s.estExclu(r), false, r);
  }
});

test('#329 listerFichiers : liens symboliques ignorés', () => {
  const d = temp();
  try {
    ecrire(d, 'a/b.txt', 'b');
    fs.symlinkSync(path.join(d, 'a'), path.join(d, 'lien'));
    assert.deepEqual(s.listerFichiers(d, deps).map((f) => f.relatif), ['a/b.txt']);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('#329 chiffrement par mot de passe : aller-retour, mauvais mot de passe, format inconnu', () => {
  const env = s.chiffrerAvecMotDePasse({ secrets: { a: 'b' } }, MDP, crypto);
  assert.equal(env.kdf.nom, 'scrypt');
  assert.doesNotMatch(JSON.stringify(env), /"b"/);
  assert.deepEqual(s.dechiffrerAvecMotDePasse(env, MDP, crypto), { secrets: { a: 'b' } });
  assert.throws(() => s.dechiffrerAvecMotDePasse(env, 'faux mot de passe', crypto), (e) => e.code === 'mot-de-passe-incorrect');
  for (const mauvais of [null, {}, Object.assign({}, env, { version: 2 }), Object.assign({}, env, { kdf: null }),
    Object.assign({}, env, { kdf: { nom: 'pbkdf2' } }), Object.assign({}, env, { chiffrement: 'aes-128-cbc' })]) {
    assert.throws(() => s.dechiffrerAvecMotDePasse(mauvais, MDP, crypto), (e) => e.code === 'archive-invalide');
  }
});

test('#329 dechiffrerTrousseau / rechiffrerTrousseau : valeurs illisibles comptées, jamais copiées', () => {
  const t = s.dechiffrerTrousseau({ secrets: { a: b64('1'), b: b64('2', 'X:') }, identifiants: null }, trousseau().dechiffrer);
  assert.deepEqual(t, { clair: { secrets: { a: '1' }, identifiants: {} }, nombre: 1, illisibles: 1 });
  assert.deepEqual(s.dechiffrerTrousseau({}, trousseau().dechiffrer).nombre, 0);
  const r = s.rechiffrerTrousseau({ secrets: { a: '1' }, identifiants: { h: [{ login: 'l', motDePasse: 'p', ajoute: 'd' }], x: 'pas une liste' } }, trousseau('M:').chiffrer);
  assert.deepEqual(r, { secrets: { a: b64('1', 'M:') }, identifiants: { h: [{ login: 'l', secret: b64('p', 'M:'), ajoute: 'd' }], x: [] } });
  assert.deepEqual(s.rechiffrerTrousseau({}, trousseau().chiffrer), { secrets: {}, identifiants: {} });
});

test('#329 creerSauvegarde : contenu de l\'archive, exclusions, mots de passe rechiffrés', async () => {
  const d = temp();
  const sortie = temp();
  try {
    dossierType(d);
    const dest = path.join(sortie, 'iao.zip');
    const r = await s.creerSauvegarde({ dossier: d, destination: dest, motDePasse: MDP, version: '1.0.0',
      dechiffrer: trousseau().dechiffrer, maintenant: new Date('2026-10-27T20:00:00Z'), deps });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual([r.fichiers, r.ignores, r.motsDePasse, r.illisibles], [4, 0, 2, 3]);
    assert.equal(fs.existsSync(dest + '.tmp'), false);
    const a = lireArchive(dest);
    assert.deepEqual(Object.keys(a).sort(), ['donnees/Local Storage/leveldb/000003.log', 'donnees/Partitions/profil_1/Cookies',
      'donnees/settings.json', 'donnees/stats/sessions.jsonl', 'iao-sauvegarde.json', 'iao-secrets.json']);
    const m = JSON.parse(a['iao-sauvegarde.json']);
    assert.deepEqual(m, { format: 'iao-sauvegarde', version: 1, date: '2026-10-27T20:00:00.000Z', application: '1.0.0', fichiers: 4, motsDePasse: 2 });
    assert.doesNotMatch(a['iao-secrets.json'], /mdp-mail|mdp-site/);
    assert.deepEqual(s.dechiffrerAvecMotDePasse(JSON.parse(a['iao-secrets.json']), MDP, crypto), {
      secrets: { profil_1: 'mdp-mail' }, identifiants: { 'context7.com': [{ login: 'moi', motDePasse: 'mdp-site', ajoute: '2026-10-01' }] }
    });
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(sortie, { recursive: true, force: true });
  }
});

test('#329 creerSauvegarde : sans mot de passe enregistré, aucun mot de passe de sauvegarde demandé', async () => {
  const d = temp();
  try {
    dossierType(d, false);
    ecrire(d, 'secrets.json', '[]'); // pas un objet : ignoré
    const dest = path.join(d, '..', path.basename(d) + '.zip');
    const r = await s.creerSauvegarde({ dossier: d, destination: dest, dechiffrer: trousseau().dechiffrer, deps });
    assert.equal(r.ok, true);
    assert.equal(r.motsDePasse, 0);
    const a = lireArchive(dest);
    assert.equal('iao-secrets.json' in a, false);
    assert.equal(JSON.parse(a['iao-sauvegarde.json']).application, null);
    fs.rmSync(dest);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('#329 creerSauvegarde : mot de passe absent ou trop court refusé quand des mots de passe sont enregistrés', async () => {
  const d = temp();
  try {
    dossierType(d);
    for (const motDePasse of [undefined, 'court']) {
      const r = await s.creerSauvegarde({ dossier: d, destination: path.join(d, 'x.zip'), motDePasse, dechiffrer: trousseau().dechiffrer, deps });
      assert.equal(r.ok, false);
      assert.equal(r.code, 'mot-de-passe-requis');
    }
    assert.equal(fs.existsSync(path.join(d, 'x.zip')), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('#329 creerSauvegarde : fichier disparu pendant la copie compté, échec d\'écriture nettoyé', async () => {
  const d = temp();
  const sortie = temp();
  try {
    dossierType(d, false);
    const disparu = path.join(d, 'stats', 'sessions.jsonl');
    const fsDisparu = Object.assign({}, fs, {
      readFileSync: (f, ...rest) => { if (f === disparu) throw new Error('ENOENT'); return fs.readFileSync(f, ...rest); }
    });
    const r = await s.creerSauvegarde({ dossier: d, destination: path.join(sortie, 'a.zip'), dechiffrer: trousseau().dechiffrer,
      deps: { fs: fsDisparu, path, crypto } });
    assert.deepEqual([r.ok, r.fichiers, r.ignores], [true, 3, 1]);

    const fsPlein = Object.assign({}, fs, { writeSync: () => { throw new Error('disque plein'); } });
    const r2 = await s.creerSauvegarde({ dossier: d, destination: path.join(sortie, 'b.zip'), dechiffrer: trousseau().dechiffrer,
      deps: { fs: fsPlein, path, crypto } });
    assert.deepEqual([r2.ok, r2.code, r2.erreur], [false, 'erreur', 'disque plein']);
    assert.deepEqual(fs.readdirSync(sortie), ['a.zip']);

    const fsFermeture = Object.assign({}, fs, {
      writeSync: () => { throw 'brut'; }, // eslint-disable-line no-throw-literal
      closeSync: (fd) => { fs.closeSync(fd); throw new Error('déjà fermé'); },
      rmSync: () => { throw new Error('rm impossible'); }
    });
    const r3 = await s.creerSauvegarde({ dossier: d, destination: path.join(sortie, 'c.zip'), dechiffrer: trousseau().dechiffrer,
      deps: { fs: fsFermeture, path, crypto } });
    assert.deepEqual([r3.ok, r3.erreur], [false, 'brut']);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(sortie, { recursive: true, force: true });
  }
});

// Archive à la main (manifeste et entrées au choix) pour les cas refusés.
function archive(f, entrees) {
  const fd = fs.openSync(f, 'w');
  const zip = new EcrivainZip(fd, fs);
  for (const [nom, contenu] of entrees) zip.ajouter(nom, Buffer.from(contenu));
  zip.terminer();
  fs.closeSync(fd);
}
const MANIFESTE = JSON.stringify({ format: 'iao-sauvegarde', version: 1, date: '2026-10-27T20:00:00.000Z', fichiers: 1 });

test('#329 examinerSauvegarde : manifeste, mot de passe requis ou non, archives refusées', () => {
  const d = temp();
  try {
    const f = path.join(d, 'a.zip');
    archive(f, [['iao-sauvegarde.json', MANIFESTE], ['donnees/a', 'a']]);
    assert.deepEqual(s.examinerSauvegarde(f, deps), { manifeste: JSON.parse(MANIFESTE), motDePasseRequis: false });
    archive(f, [['iao-sauvegarde.json', MANIFESTE], ['iao-secrets.json', '{}']]);
    assert.equal(s.examinerSauvegarde(f, deps).motDePasseRequis, true);
    const cas = [
      [[['autre.txt', 'x']], /pas une sauvegarde/],
      [[['iao-sauvegarde.json', '{tronqué']], /illisible/],
      [[['iao-sauvegarde.json', 'null']], /pas une sauvegarde/],
      [[['iao-sauvegarde.json', JSON.stringify({ format: 'iao-sauvegarde', version: 9 })]], /version non prise en charge \(9\)/]
    ];
    for (const [entrees, attendu] of cas) {
      archive(f, entrees);
      assert.throws(() => s.examinerSauvegarde(f, deps), attendu);
    }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('#329 cheminSur : rien ne sort du dossier de données', () => {
  assert.deepEqual(s.cheminSur('donnees/a/b'), ['a', 'b']);
  for (const nom of ['autre/a', 'donnees/', 'donnees/a/', 'donnees/a\\b', 'donnees/a\0', 'donnees/C:/x', 'donnees//a', 'donnees/./a', 'donnees/a/../../b']) {
    assert.equal(s.cheminSur(nom), null, nom);
  }
});

test('#329 sauvegarde puis restauration sur une autre machine : données et mots de passe rechiffrés par son trousseau', async () => {
  const source = temp();
  const cible = temp();
  try {
    dossierType(source);
    const zip = path.join(source, '..', path.basename(source) + '.zip');
    assert.equal((await s.creerSauvegarde({ dossier: source, destination: zip, motDePasse: MDP, dechiffrer: trousseau().dechiffrer, deps })).ok, true);

    ecrire(cible, 'settings.json', '{"theme":"light"}');
    ecrire(cible, 'logs/iao.log', 'journal de la cible');
    ecrire(cible, 'SingletonLock', 'verrou');
    ecrire(cible, 'restauration-en-attente/ancienne', 'a'); // remplacée
    const autre = trousseau('M:');
    const r = s.preparerRestauration({ cheminZip: zip, dossier: cible, motDePasse: MDP, chiffrer: autre.chiffrer, deps });
    assert.deepEqual(r, { ok: true, fichiers: 4, motsDePasse: 2, date: r.date });
    const attente = path.join(cible, s.DOSSIER_ATTENTE);
    assert.equal(fs.existsSync(path.join(attente, 'ancienne')), false);
    assert.equal(fs.existsSync(path.join(cible, s.DOSSIER_ATTENTE + '.tmp')), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(attente, 'secrets.json'), 'utf-8')), { profil_1: b64('mdp-mail', 'M:') });
    assert.equal(JSON.parse(fs.readFileSync(path.join(attente, 'identifiants.json'), 'utf-8'))['context7.com'][0].secret, b64('mdp-site', 'M:'));
    // Rien n'a encore changé dans les données en place.
    assert.equal(fs.readFileSync(path.join(cible, 'settings.json'), 'utf-8'), '{"theme":"light"}');

    const a = s.appliquerRestauration(cible, new Date('2026-10-28T08:00:00Z'), deps);
    assert.equal(a.status, 'appliquee');
    assert.equal(a.avant, path.join(cible, 'avant-restauration-2026-10-28T08-00-00'));
    assert.deepEqual([a.deplaces, a.restaures], [1, 6]);
    assert.equal(fs.readFileSync(path.join(cible, 'settings.json'), 'utf-8'), '{"theme":"dark"}');
    assert.equal(fs.readFileSync(path.join(cible, 'Partitions', 'profil_1', 'Cookies'), 'utf-8'), 'cookie');
    assert.equal(fs.readFileSync(path.join(a.avant, 'settings.json'), 'utf-8'), '{"theme":"light"}');
    assert.equal(fs.readFileSync(path.join(cible, 'logs', 'iao.log'), 'utf-8'), 'journal de la cible');
    assert.equal(fs.existsSync(path.join(cible, 'SingletonLock')), true);
    assert.equal(fs.existsSync(attente), false);
    assert.deepEqual(s.appliquerRestauration(cible, new Date(), deps), { status: 'aucune' });

    // Restauration suivante : seule la précédente mise de côté est gardée.
    assert.equal(s.preparerRestauration({ cheminZip: zip, dossier: cible, motDePasse: MDP, chiffrer: autre.chiffrer, deps }).ok, true);
    const b = s.appliquerRestauration(cible, new Date('2026-10-29T08:00:00Z'), deps);
    assert.equal(b.status, 'appliquee');
    assert.deepEqual(fs.readdirSync(cible).filter((n) => n.startsWith('avant-')), ['avant-restauration-2026-10-29T08-00-00']);
    fs.rmSync(zip);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(cible, { recursive: true, force: true });
  }
});

test('#329 preparerRestauration : mot de passe faux ou absent -> rien n\'est extrait', async () => {
  const source = temp();
  const cible = temp();
  try {
    dossierType(source);
    const zip = path.join(source, '..', path.basename(source) + '-b.zip');
    await s.creerSauvegarde({ dossier: source, destination: zip, motDePasse: MDP, dechiffrer: trousseau().dechiffrer, deps });
    for (const [motDePasse, code] of [['mauvais mot', 'mot-de-passe-incorrect'], ['', 'mot-de-passe-requis'], [undefined, 'mot-de-passe-requis']]) {
      const r = s.preparerRestauration({ cheminZip: zip, dossier: cible, motDePasse, chiffrer: trousseau().chiffrer, deps });
      assert.deepEqual([r.ok, r.code], [false, code]);
    }
    assert.deepEqual(fs.readdirSync(cible), []);
    fs.rmSync(zip);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(cible, { recursive: true, force: true });
  }
});

test('#329 preparerRestauration : sans mots de passe, archives refusées, fichier introuvable', () => {
  const d = temp();
  const cible = temp();
  try {
    const f = path.join(d, 'a.zip');
    archive(f, [['iao-sauvegarde.json', MANIFESTE], ['donnees/', ''], ['donnees/a/b.txt', 'b']]);
    const ok = s.preparerRestauration({ cheminZip: f, dossier: cible, chiffrer: trousseau().chiffrer, deps });
    assert.deepEqual([ok.ok, ok.fichiers, ok.motsDePasse], [true, 1, 0]);
    assert.equal(fs.existsSync(path.join(cible, s.DOSSIER_ATTENTE, 'secrets.json')), false);
    const cas = [
      [[['autre', 'x']], /pas une sauvegarde/],
      [[['iao-sauvegarde.json', 'null']], /pas une sauvegarde/],
      [[['iao-sauvegarde.json', '{tronqué']], /JSON/],
      [[['iao-sauvegarde.json', JSON.stringify({ format: 'autre', version: 1 })]], /pas une sauvegarde/],
      [[['iao-sauvegarde.json', JSON.stringify({ format: 'iao-sauvegarde', version: 2 })]], /pas une sauvegarde/],
      [[['iao-sauvegarde.json', MANIFESTE], ['donnees/C:/evade', 'x']], /chemin refusé/]
    ];
    for (const [entrees, attendu] of cas) {
      archive(f, entrees);
      const r = s.preparerRestauration({ cheminZip: f, dossier: cible, chiffrer: trousseau().chiffrer, deps });
      assert.equal(r.ok, false);
      assert.match(r.erreur, attendu);
    }
    const absent = s.preparerRestauration({ cheminZip: path.join(d, 'absent.zip'), dossier: cible, chiffrer: trousseau().chiffrer, deps });
    assert.deepEqual([absent.ok, absent.code], [false, 'ENOENT']);
    const fsRm = Object.assign({}, fs, { rmSync: () => { throw new Error('rm'); } });
    const r = s.preparerRestauration({ cheminZip: path.join(d, 'absent.zip'), dossier: cible, chiffrer: trousseau().chiffrer, deps: { fs: fsRm, path, crypto } });
    assert.equal(r.ok, false);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(cible, { recursive: true, force: true });
  }
});

test('#329 appliquerRestauration : échec en cours de route -> déplacements défaits', () => {
  const d = temp();
  try {
    ecrire(d, 'settings.json', 'actuel');
    ecrire(d, 'restauration-en-attente/settings.json', 'restaure');
    ecrire(d, 'restauration-en-attente/Partitions/p', 'x');
    let n = 0;
    const fsCasse = Object.assign({}, fs, {
      renameSync: (a, b) => { if (++n === 3) throw new Error('fichier verrouillé'); return fs.renameSync(a, b); }
    });
    const r = s.appliquerRestauration(d, new Date('2026-10-28T08:00:00Z'), { fs: fsCasse, path });
    assert.equal(r.status, 'erreur');
    assert.equal(r.erreur, 'fichier verrouillé');
    assert.deepEqual([r.defaits, r.aDefaire], [2, 2]);
    assert.equal(fs.readFileSync(path.join(d, 'settings.json'), 'utf-8'), 'actuel');
    assert.equal(fs.readFileSync(path.join(d, 'restauration-en-attente', 'settings.json'), 'utf-8'), 'restaure');

    // Ni la restauration ni le retour en arrière ne passent : signalé par le compte.
    const fsDefaitImpossible = Object.assign({}, fs, {
      renameSync: (a, b) => { if (b.includes('avant-restauration')) return fs.renameSync(a, b); throw new Error('verrou'); }
    });
    const r2 = s.appliquerRestauration(d, new Date('2026-10-28T09:00:00Z'), { fs: fsDefaitImpossible, path });
    assert.equal(r2.status, 'erreur');
    assert.equal(r2.defaits, 0);
    assert.equal(r2.aDefaire, 1);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('#329 horodatage : utilisable dans un nom de dossier Windows', () => {
  assert.equal(s.horodatage(new Date('2026-10-27T20:01:02.345Z')), '2026-10-27T20-01-02');
});

// --- registerSauvegardeIPC --------------------------------------------------

function ipcFactice(o) {
  const handlers = new Map();
  const journal = [];
  const dialogue = { save: { canceled: true }, open: { canceled: true, filePaths: [] } };
  s.registerSauvegardeIPC(Object.assign({
    ipc: { handle: (c, f) => handlers.set(c, f) },
    dialog: { showSaveDialog: async () => dialogue.save, showOpenDialog: async () => dialogue.open },
    fenetre: () => null,
    chiffreur: { encryptString: (t) => Buffer.from('K:' + t), decryptString: trousseau().dechiffrer },
    version: '1.0.0',
    journal: (niveau, m) => journal.push([niveau, m]),
    deps
  }, o));
  return { appel: (c, ...a) => handlers.get(c)({}, ...a), handlers, journal, dialogue };
}

test('#329 IPC : sauvegarde annulée, réussie, refusée ; journal sans mot de passe', async () => {
  const d = temp();
  const sortie = temp();
  try {
    dossierType(d);
    const h = ipcFactice({ dossier: d });
    assert.deepEqual([...h.handlers.keys()], ['sauvegarde:creer', 'sauvegarde:choisir', 'sauvegarde:restaurer']);
    assert.deepEqual(await h.appel('sauvegarde:creer', MDP), { canceled: true });
    h.dialogue.save = { canceled: false };
    assert.deepEqual(await h.appel('sauvegarde:creer', MDP), { canceled: true });
    h.dialogue.save = { canceled: false, filePath: path.join(sortie, 'a.zip') };
    const r = await h.appel('sauvegarde:creer', MDP);
    assert.equal(r.ok, true);
    assert.equal(r.filePath, path.join(sortie, 'a.zip'));
    assert.match(h.journal[0][1], /4 fichier\(s\).*2 mot\(s\) de passe rechiffré\(s\), 3 illisible\(s\)/);
    const refus = await h.appel('sauvegarde:creer', 'court');
    assert.equal(refus.code, 'mot-de-passe-requis');
    assert.equal(h.journal[1][0], 'error');
    // Fichier disparu pendant la copie : signalé dans le journal.
    const disparu = path.join(d, 'settings.json');
    const fsDisparu = Object.assign({}, fs, { readFileSync: (f, ...rest) => { if (f === disparu) throw new Error('x'); return fs.readFileSync(f, ...rest); } });
    const h2 = ipcFactice({ dossier: d, deps: { fs: fsDisparu, path, crypto } });
    h2.dialogue.save = { canceled: false, filePath: path.join(sortie, 'b.zip') };
    await h2.appel('sauvegarde:creer', MDP);
    assert.match(h2.journal[0][1], /1 fichier\(s\) disparu\(s\)/);
    assert.doesNotMatch(JSON.stringify(h.journal.concat(h2.journal)), new RegExp(MDP + '|mdp-mail|mdp-site'));
    // Sans mot de passe illisible : pas de mention.
    const propre = temp();
    dossierType(propre, false);
    const h3 = ipcFactice({ dossier: propre });
    h3.dialogue.save = { canceled: false, filePath: path.join(sortie, 'c.zip') };
    await h3.appel('sauvegarde:creer', '');
    assert.doesNotMatch(h3.journal[0][1], /illisible|disparu/);
    fs.rmSync(propre, { recursive: true, force: true });
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(sortie, { recursive: true, force: true });
  }
});

test('#329 IPC : choix de l\'archive puis restauration ; chemin jamais pris du renderer', async () => {
  const d = temp();
  const cible = temp();
  try {
    dossierType(d);
    const zip = path.join(d, '..', path.basename(d) + '-ipc.zip');
    await s.creerSauvegarde({ dossier: d, destination: zip, motDePasse: MDP, dechiffrer: trousseau().dechiffrer, deps });
    const h = ipcFactice({ dossier: cible });
    assert.deepEqual(await h.appel('sauvegarde:restaurer', MDP), { ok: false, code: 'aucune-archive', erreur: 'aucune sauvegarde choisie' });
    assert.deepEqual(await h.appel('sauvegarde:choisir'), { canceled: true });
    h.dialogue.open = { canceled: false, filePaths: [] };
    assert.deepEqual(await h.appel('sauvegarde:choisir'), { canceled: true });
    h.dialogue.open = { canceled: false, filePaths: [path.join(d, 'settings.json')] };
    const refus = await h.appel('sauvegarde:choisir');
    assert.deepEqual([refus.ok, refus.code], [false, 'archive-invalide']);
    assert.equal(h.journal.pop()[0], 'warning');
    const invalide = path.join(d, 'pas-une-sauvegarde.zip');
    archive(invalide, [['autre', 'x']]);
    h.dialogue.open = { canceled: false, filePaths: [invalide] };
    assert.equal((await h.appel('sauvegarde:choisir')).code, 'archive-invalide');
    h.dialogue.open = { canceled: false, filePaths: [zip] };
    const choix = await h.appel('sauvegarde:choisir');
    assert.deepEqual([choix.ok, choix.fichiers, choix.motDePasseRequis], [true, 4, true]);
    assert.equal(h.journal.pop()[0], 'debug');
    const faux = await h.appel('sauvegarde:restaurer', 'mauvais mot');
    assert.equal(faux.code, 'mot-de-passe-incorrect');
    assert.equal(h.journal.pop()[0], 'warning');
    const ok = await h.appel('sauvegarde:restaurer', MDP, '/chemin/du/renderer.zip');
    assert.equal(ok.ok, true);
    assert.match(h.journal.pop()[1], /appliquée au redémarrage/);
    assert.equal(fs.existsSync(path.join(cible, s.DOSSIER_ATTENTE, 'settings.json')), true);
    // L'archive n'est plus retenue après une restauration préparée.
    assert.equal((await h.appel('sauvegarde:restaurer', MDP)).code, 'aucune-archive');
    // Autre erreur : journalisée en erreur.
    h.dialogue.open = { canceled: false, filePaths: [zip] };
    await h.appel('sauvegarde:choisir');
    fs.rmSync(zip);
    assert.equal((await h.appel('sauvegarde:restaurer', MDP)).code, 'ENOENT');
    assert.equal(h.journal.pop()[0], 'error');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(cible, { recursive: true, force: true });
  }
});
