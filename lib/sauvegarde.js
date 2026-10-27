'use strict';

// lib/sauvegarde.js — sauvegarde complète et restauration du dossier de
// données (issue #329), en plus de l'export / import des comptes.
//
// Sauvegarde : un ZIP du dossier ai-manager (%APPDATA%\ai-manager sous
// Windows, ~/.config/ai-manager sous Linux), sans ce qui se recrée tout seul
// ou n'a rien à faire dans une sauvegarde (caches de Chromium, verrous,
// journaux, captures HAR, fichiers temporaires, anciennes restaurations).
//
// Mots de passe : secrets.json (#201) et identifiants.json sont chiffrés par
// le trousseau du système, illisibles sur une autre machine. Ils ne sont donc
// pas copiés tels quels : chaque mot de passe est déchiffré par le trousseau,
// puis l'ensemble est rechiffré avec le mot de passe de la sauvegarde
// (scrypt + AES-256-GCM) dans l'entrée iao-secrets.json. Aucun mot de passe en
// clair n'est écrit sur le disque ni dans le journal.
//
// Restauration, en deux temps :
// 1. preparerRestauration : l'archive est vérifiée (manifeste, mot de passe,
//    chemins) puis extraite dans <userData>/restauration-en-attente, avec les
//    mots de passe rechiffrés par le trousseau de cette machine ;
// 2. appliquerRestauration, au démarrage suivant, avant que Chromium n'ouvre
//    les sessions : les données en place sont rangées dans
//    <userData>/avant-restauration-<date> (seule la dernière est gardée), puis
//    remplacées par celles de l'archive.
//
// Dépendances injectées (fs, path, crypto) : testé par test/sauvegarde.test.js.

const { EcrivainZip } = require('./ecriture-zip');
const lectureZip = require('./lecture-zip');

const FORMAT = 'iao-sauvegarde';
const VERSION = 1;
const ENTREE_MANIFESTE = 'iao-sauvegarde.json';
const ENTREE_SECRETS = 'iao-secrets.json';
const DOSSIER_ATTENTE = 'restauration-en-attente';
const PREFIXE_AVANT = 'avant-restauration-';
const MOT_DE_PASSE_MIN = 8;
const TAILLE_ENTREE_MAX = 1024 * 1024 * 1024; // 1 Go par fichier extrait

// Fichiers chiffrés par le trousseau : jamais copiés tels quels.
const FICHIERS_TROUSSEAU = Object.freeze(['secrets.json', 'identifiants.json']);

// Exclus à la racine du dossier de données.
const EXCLUS_RACINE = new Set(['logs', 'har', DOSSIER_ATTENTE, DOSSIER_ATTENTE + '.tmp']);
// Exclus à toute profondeur (caches et verrous de Chromium).
const EXCLUS_PARTOUT = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'GraphiteDawnCache', 'GrShaderCache', 'ShaderCache', 'CacheStorage', 'ScriptCache', 'Crashpad',
  'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'LOCK', 'lockfile'
]);
// Jamais déplacés au moment d'appliquer une restauration (instance en cours, journal).
const GARDES_RACINE = new Set(['logs', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', DOSSIER_ATTENTE]);

// scrypt : N = 2^15 (~32 Mo, une fraction de seconde), r = 8, p = 1.
const KDF = Object.freeze({ nom: 'scrypt', N: 32768, r: 8, p: 1 });

class ErreurSauvegarde extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ErreurSauvegarde';
    this.code = code;
  }
}

function messageErreur(e) {
  return (e && e.message) ? e.message : String(e);
}

// Chemin relatif (séparateur « / ») exclu de la sauvegarde ?
function estExclu(relatif) {
  const parties = relatif.split('/');
  if (EXCLUS_RACINE.has(parties[0]) || parties[0].startsWith(PREFIXE_AVANT)) return true;
  if (parties.length === 1 && FICHIERS_TROUSSEAU.includes(parties[0])) return true;
  const nom = parties[parties.length - 1];
  if (nom.endsWith('.tmp')) return true;
  return parties.some((p) => EXCLUS_PARTOUT.has(p));
}

// Fichiers ordinaires à sauvegarder, triés ; liens symboliques et fichiers
// spéciaux ignorés (lstat).
function listerFichiers(racine, deps) {
  const { fs, path } = deps;
  const out = [];
  const parcourir = (dossier, relatif) => {
    for (const nom of fs.readdirSync(dossier).sort()) {
      const rel = relatif ? relatif + '/' + nom : nom;
      if (estExclu(rel)) continue;
      const abs = path.join(dossier, nom);
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) parcourir(abs, rel);
      else if (st.isFile()) out.push({ relatif: rel, absolu: abs, date: st.mtime });
    }
  };
  parcourir(racine, '');
  return out;
}

function lireJson(fichier, fs) {
  try {
    const d = JSON.parse(fs.readFileSync(fichier, 'utf-8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  } catch (_) {
    return null;
  }
}

// Déchiffre par le trousseau. Une valeur indéchiffrable (trousseau changé) est
// comptée et laissée de côté, jamais copiée chiffrée.
function dechiffrerTrousseau(contenus, dechiffrer) {
  const clair = { secrets: {}, identifiants: {} };
  let nombre = 0;
  let illisibles = 0;
  const essayer = (b64) => {
    try {
      const v = dechiffrer(Buffer.from(String(b64), 'base64'));
      nombre++;
      return v;
    } catch (_) {
      illisibles++;
      return null;
    }
  };
  for (const [cle, b64] of Object.entries(contenus.secrets || {})) {
    const v = essayer(b64);
    if (v !== null) clair.secrets[cle] = v;
  }
  for (const [hote, entrees] of Object.entries(contenus.identifiants || {})) {
    if (!Array.isArray(entrees)) continue;
    const garde = [];
    for (const e of entrees) {
      if (!e || typeof e !== 'object') continue;
      const v = essayer(e.secret);
      if (v !== null) garde.push({ login: e.login, motDePasse: v, ajoute: e.ajoute });
    }
    if (garde.length) clair.identifiants[hote] = garde;
  }
  return { clair, nombre, illisibles };
}

// Inverse : rechiffre par le trousseau de cette machine, au format des fichiers.
function rechiffrerTrousseau(clair, chiffrer) {
  const b64 = (v) => chiffrer(String(v)).toString('base64');
  const secrets = {};
  for (const [cle, v] of Object.entries(clair.secrets || {})) secrets[cle] = b64(v);
  const identifiants = {};
  for (const [hote, entrees] of Object.entries(clair.identifiants || {})) {
    identifiants[hote] = (Array.isArray(entrees) ? entrees : []).map((e) => ({ login: e.login, secret: b64(e.motDePasse), ajoute: e.ajoute }));
  }
  return { secrets, identifiants };
}

function chiffrerAvecMotDePasse(objet, motDePasse, crypto) {
  const sel = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cle = crypto.scryptSync(motDePasse, sel, 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 64 * 1024 * 1024 });
  const chiffreur = crypto.createCipheriv('aes-256-gcm', cle, iv);
  chiffreur.setAAD(Buffer.from(FORMAT));
  const donnees = Buffer.concat([chiffreur.update(JSON.stringify(objet), 'utf8'), chiffreur.final()]);
  return {
    format: FORMAT + '-secrets', version: VERSION,
    kdf: Object.assign({}, KDF, { sel: sel.toString('base64') }),
    chiffrement: 'aes-256-gcm',
    iv: iv.toString('base64'),
    etiquette: chiffreur.getAuthTag().toString('base64'),
    donnees: donnees.toString('base64')
  };
}

function dechiffrerAvecMotDePasse(env, motDePasse, crypto) {
  if (!env || env.format !== FORMAT + '-secrets' || env.version !== VERSION || !env.kdf || env.kdf.nom !== 'scrypt' || env.chiffrement !== 'aes-256-gcm') {
    throw new ErreurSauvegarde('archive-invalide', 'mots de passe de la sauvegarde dans un format inconnu');
  }
  let texte;
  try {
    const cle = crypto.scryptSync(motDePasse, Buffer.from(env.kdf.sel, 'base64'), 32,
      { N: env.kdf.N, r: env.kdf.r, p: env.kdf.p, maxmem: 64 * 1024 * 1024 });
    const d = crypto.createDecipheriv('aes-256-gcm', cle, Buffer.from(env.iv, 'base64'));
    d.setAAD(Buffer.from(FORMAT));
    d.setAuthTag(Buffer.from(env.etiquette, 'base64'));
    texte = Buffer.concat([d.update(Buffer.from(env.donnees, 'base64')), d.final()]).toString('utf8');
  } catch (_) {
    throw new ErreurSauvegarde('mot-de-passe-incorrect', 'mot de passe de la sauvegarde incorrect');
  }
  return JSON.parse(texte);
}

function cedeLaMain() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Crée l'archive. options : { dossier, destination, motDePasse, dechiffrer,
// version, maintenant, deps: { fs, path, crypto } }.
// Retour : { ok: true, fichiers, octets, motsDePasse, illisibles } ou
// { ok: false, code, erreur }.
async function creerSauvegarde(o) {
  const { fs, path, crypto } = o.deps;
  const temporaire = o.destination + '.tmp';
  let fd = null;
  try {
    const contenus = {
      secrets: lireJson(path.join(o.dossier, 'secrets.json'), fs),
      identifiants: lireJson(path.join(o.dossier, 'identifiants.json'), fs)
    };
    const t = dechiffrerTrousseau(contenus, o.dechiffrer);
    if (t.nombre > 0 && (typeof o.motDePasse !== 'string' || o.motDePasse.length < MOT_DE_PASSE_MIN)) {
      throw new ErreurSauvegarde('mot-de-passe-requis', 'un mot de passe d\'au moins ' + MOT_DE_PASSE_MIN + ' caractères protège les mots de passe enregistrés');
    }
    const fichiers = listerFichiers(o.dossier, o.deps);
    const maintenant = o.maintenant || new Date();
    const manifeste = {
      format: FORMAT, version: VERSION, date: maintenant.toISOString(),
      application: o.version || null, fichiers: fichiers.length, motsDePasse: t.nombre
    };
    fd = fs.openSync(temporaire, 'w', 0o600);
    const zip = new EcrivainZip(fd, fs);
    zip.ajouter(ENTREE_MANIFESTE, Buffer.from(JSON.stringify(manifeste, null, 2)), maintenant);
    if (t.nombre > 0) {
      zip.ajouter(ENTREE_SECRETS, Buffer.from(JSON.stringify(chiffrerAvecMotDePasse(t.clair, o.motDePasse, crypto))), maintenant);
    }
    let ignores = 0;
    for (const f of fichiers) {
      let donnees;
      try { donnees = fs.readFileSync(f.absolu); }
      catch (_) { ignores++; continue; } // disparu entre la liste et la lecture (fichier de Chromium)
      zip.ajouter('donnees/' + f.relatif, donnees, f.date);
      await cedeLaMain();
    }
    const octets = zip.terminer();
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporaire, o.destination);
    return { ok: true, fichiers: fichiers.length - ignores, ignores, octets, motsDePasse: t.nombre, illisibles: t.illisibles };
  } catch (e) {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* déjà fermé */ } }
    try { fs.rmSync(temporaire, { force: true }); } catch (_) { /* rien à nettoyer */ }
    return { ok: false, code: e.code || 'erreur', erreur: messageErreur(e) };
  }
}

// Entrées de l'archive et manifeste, sans rien extraire.
function examinerSauvegarde(cheminZip, deps) {
  const fs = deps.fs;
  const fd = fs.openSync(cheminZip, 'r');
  try {
    const lecteur = lectureZip.lecteurDeFichier(fd, fs);
    const entrees = lectureZip.lireEntrees(lecteur);
    const m = entrees.find((e) => e.nom === ENTREE_MANIFESTE);
    if (!m) throw new ErreurSauvegarde('archive-invalide', 'ce fichier n\'est pas une sauvegarde complète d\'IAO');
    let manifeste;
    try { manifeste = JSON.parse(lectureZip.extraire(lecteur, m).toString('utf8')); }
    catch (_) { throw new ErreurSauvegarde('archive-invalide', 'manifeste de la sauvegarde illisible'); }
    if (!manifeste || manifeste.format !== FORMAT) throw new ErreurSauvegarde('archive-invalide', 'ce fichier n\'est pas une sauvegarde complète d\'IAO');
    if (manifeste.version !== VERSION) throw new ErreurSauvegarde('archive-invalide', 'sauvegarde d\'une version non prise en charge (' + manifeste.version + ')');
    return { manifeste, motDePasseRequis: entrees.some((e) => e.nom === ENTREE_SECRETS) };
  } finally {
    fs.closeSync(fd);
  }
}

// Chemin relatif sûr (aucune sortie du dossier) pour une entrée « donnees/… ».
function cheminSur(nom) {
  if (!nom.startsWith('donnees/')) return null;
  const rel = nom.slice('donnees/'.length);
  if (rel === '' || nom.endsWith('/') || rel.includes('\\') || rel.includes('\0') || /^[a-zA-Z]:/.test(rel)) return null;
  const parties = rel.split('/');
  if (parties.some((p) => p === '' || p === '.' || p === '..')) return null;
  return parties;
}

// Vérifie l'archive et l'extrait dans <dossier>/restauration-en-attente.
// options : { cheminZip, dossier, motDePasse, chiffrer, deps }.
// Retour : { ok: true, fichiers, motsDePasse } ou { ok: false, code, erreur }.
function preparerRestauration(o) {
  const { fs, path, crypto } = o.deps;
  const temporaire = path.join(o.dossier, DOSSIER_ATTENTE + '.tmp');
  const attente = path.join(o.dossier, DOSSIER_ATTENTE);
  let fd = null;
  let resultat;
  try {
    fd = fs.openSync(o.cheminZip, 'r');
    const lecteur = lectureZip.lecteurDeFichier(fd, fs);
    const entrees = lectureZip.lireEntrees(lecteur);
    const m = entrees.find((e) => e.nom === ENTREE_MANIFESTE);
    if (!m) throw new ErreurSauvegarde('archive-invalide', 'ce fichier n\'est pas une sauvegarde complète d\'IAO');
    const manifeste = JSON.parse(lectureZip.extraire(lecteur, m).toString('utf8'));
    if (!manifeste || manifeste.format !== FORMAT || manifeste.version !== VERSION) {
      throw new ErreurSauvegarde('archive-invalide', 'ce fichier n\'est pas une sauvegarde complète d\'IAO');
    }
    // Mots de passe d'abord : un mot de passe faux n'extrait rien.
    let trousseau = null;
    let motsDePasse = 0;
    const s = entrees.find((e) => e.nom === ENTREE_SECRETS);
    if (s) {
      if (typeof o.motDePasse !== 'string' || o.motDePasse === '') {
        throw new ErreurSauvegarde('mot-de-passe-requis', 'mot de passe de la sauvegarde requis');
      }
      const clair = dechiffrerAvecMotDePasse(JSON.parse(lectureZip.extraire(lecteur, s).toString('utf8')), o.motDePasse, crypto);
      trousseau = rechiffrerTrousseau(clair, o.chiffrer);
      motsDePasse = Object.keys(trousseau.secrets).length +
        Object.values(trousseau.identifiants).reduce((n, l) => n + l.length, 0);
    }
    const donnees = [];
    for (const e of entrees) {
      if (e.nom === ENTREE_MANIFESTE || e.nom === ENTREE_SECRETS || e.dossier) continue;
      const parties = cheminSur(e.nom);
      if (!parties) throw new ErreurSauvegarde('archive-invalide', 'chemin refusé dans l\'archive : ' + e.nom);
      donnees.push({ entree: e, parties });
    }
    fs.rmSync(temporaire, { recursive: true, force: true });
    fs.mkdirSync(temporaire, { recursive: true });
    for (const d of donnees) {
      const cible = path.join(temporaire, ...d.parties);
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      fs.writeFileSync(cible, lectureZip.extraire(lecteur, d.entree, { tailleMax: TAILLE_ENTREE_MAX }));
    }
    if (trousseau) {
      fs.writeFileSync(path.join(temporaire, 'secrets.json'), JSON.stringify(trousseau.secrets, null, 2), { encoding: 'utf-8', mode: 0o600 });
      fs.writeFileSync(path.join(temporaire, 'identifiants.json'), JSON.stringify(trousseau.identifiants, null, 2), { encoding: 'utf-8', mode: 0o600 });
    }
    fs.rmSync(attente, { recursive: true, force: true });
    fs.renameSync(temporaire, attente);
    resultat = { ok: true, fichiers: donnees.length, motsDePasse, date: manifeste.date };
  } catch (e) {
    try { fs.rmSync(temporaire, { recursive: true, force: true }); } catch (_) { /* rien à nettoyer */ }
    resultat = { ok: false, code: e.code || 'erreur', erreur: messageErreur(e) };
  }
  if (fd !== null) fs.closeSync(fd);
  return resultat;
}

function horodatage(date) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// Au démarrage, avant toute session : remplace les données par celles de la
// restauration en attente. Retour : { status: 'aucune' } |
// { status: 'appliquee', avant, deplaces, restaures } | { status: 'erreur', erreur }.
function appliquerRestauration(dossier, maintenant, deps) {
  const { fs, path } = deps;
  const attente = path.join(dossier, DOSSIER_ATTENTE);
  if (!fs.existsSync(attente)) return { status: 'aucune' };
  const nomAvant = PREFIXE_AVANT + horodatage(maintenant);
  const avant = path.join(dossier, nomAvant);
  const faits = []; // [source, cible] déjà renommés, défaits en cas d'échec
  const renommer = (source, cible) => { fs.renameSync(source, cible); faits.push([source, cible]); };
  try {
    // Anciennes données mises de côté : seule la restauration précédente est gardée.
    for (const nom of fs.readdirSync(dossier)) {
      if (nom.startsWith(PREFIXE_AVANT) && nom !== nomAvant) fs.rmSync(path.join(dossier, nom), { recursive: true, force: true });
    }
    fs.mkdirSync(avant, { recursive: true });
    let deplaces = 0;
    for (const nom of fs.readdirSync(dossier)) {
      if (GARDES_RACINE.has(nom) || nom === nomAvant) continue;
      renommer(path.join(dossier, nom), path.join(avant, nom));
      deplaces++;
    }
    let restaures = 0;
    for (const nom of fs.readdirSync(attente)) {
      renommer(path.join(attente, nom), path.join(dossier, nom));
      restaures++;
    }
    fs.rmSync(attente, { recursive: true, force: true });
    return { status: 'appliquee', avant, deplaces, restaures };
  } catch (e) {
    // Retour à l'état d'avant (restauration encore en attente) ; ce qui ne
    // peut pas être remis en place reste dans avant-restauration-<date>.
    let defaits = 0;
    for (const [source, cible] of faits.reverse()) {
      try { fs.renameSync(cible, source); defaits++; } catch (_) { /* laissé où il est, signalé par le compte */ }
    }
    return { status: 'erreur', erreur: messageErreur(e), avant, defaits, aDefaire: faits.length };
  }
}

// Canaux IPC. o : { ipc, dialog, fenetre(), dossier, chiffreur, version,
// journal(niveau, message), deps }.
function registerSauvegardeIPC(o) {
  let choisie = null; // archive choisie par sauvegarde:choisir (jamais un chemin du renderer)
  const date = () => new Date();

  o.ipc.handle('sauvegarde:creer', async (_e, motDePasse) => {
    const r = await o.dialog.showSaveDialog(o.fenetre(), {
      title: 'Sauvegarde complète',
      defaultPath: 'iao-sauvegarde-' + horodatage(date()).slice(0, 10) + '.zip',
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    const res = await creerSauvegarde({
      dossier: o.dossier, destination: r.filePath, motDePasse, version: o.version,
      dechiffrer: (buf) => o.chiffreur.decryptString(buf), deps: o.deps
    });
    if (res.ok) {
      o.journal('info', 'Sauvegarde complète écrite : ' + res.fichiers + ' fichier(s), ' + res.octets + ' octets, ' +
        res.motsDePasse + ' mot(s) de passe rechiffré(s)' + (res.illisibles ? ', ' + res.illisibles + ' illisible(s) par le trousseau' : '') +
        (res.ignores ? ', ' + res.ignores + ' fichier(s) disparu(s) pendant la copie' : '') + '.');
    } else {
      o.journal('error', 'Échec de la sauvegarde complète (' + res.code + ') : ' + res.erreur);
    }
    return Object.assign({ canceled: false, filePath: r.filePath }, res);
  });

  o.ipc.handle('sauvegarde:choisir', async () => {
    choisie = null;
    const r = await o.dialog.showOpenDialog(o.fenetre(), {
      title: 'Restaurer une sauvegarde complète',
      properties: ['openFile'],
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });
    if (r.canceled || r.filePaths.length === 0) return { canceled: true };
    try {
      const ex = examinerSauvegarde(r.filePaths[0], o.deps);
      choisie = r.filePaths[0];
      o.journal('debug', 'Sauvegarde choisie pour la restauration : ' + ex.manifeste.fichiers + ' fichier(s), du ' + ex.manifeste.date + '.');
      return { canceled: false, ok: true, date: ex.manifeste.date, fichiers: ex.manifeste.fichiers, motDePasseRequis: ex.motDePasseRequis };
    } catch (e) {
      o.journal('warning', 'Sauvegarde refusée : ' + messageErreur(e));
      return { canceled: false, ok: false, code: e.code || 'archive-invalide', erreur: messageErreur(e) };
    }
  });

  o.ipc.handle('sauvegarde:restaurer', async (_e, motDePasse) => {
    if (!choisie) return { ok: false, code: 'aucune-archive', erreur: 'aucune sauvegarde choisie' };
    const res = preparerRestauration({
      cheminZip: choisie, dossier: o.dossier, motDePasse,
      chiffrer: (texte) => o.chiffreur.encryptString(texte), deps: o.deps
    });
    if (res.ok) {
      choisie = null;
      o.journal('info', 'Restauration préparée : ' + res.fichiers + ' fichier(s), ' + res.motsDePasse + ' mot(s) de passe ; appliquée au redémarrage.');
    } else {
      o.journal(res.code === 'mot-de-passe-incorrect' ? 'warning' : 'error', 'Restauration refusée (' + res.code + ') : ' + res.erreur);
    }
    return res;
  });
}

module.exports = {
  FORMAT, VERSION, ENTREE_MANIFESTE, ENTREE_SECRETS, DOSSIER_ATTENTE, PREFIXE_AVANT, MOT_DE_PASSE_MIN, KDF,
  ErreurSauvegarde, estExclu, listerFichiers, dechiffrerTrousseau, rechiffrerTrousseau,
  chiffrerAvecMotDePasse, dechiffrerAvecMotDePasse, creerSauvegarde, examinerSauvegarde, cheminSur,
  preparerRestauration, appliquerRestauration, registerSauvegardeIPC, horodatage
};
