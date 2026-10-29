'use strict';

// Issue #311 (relecture du 27/10/2026) : les comptes (nom, adresse, profil,
// couleur, services, cooldowns, automatisation) sont stockés dans
// <userData>/profils.json, et non plus dans le localStorage de l'interface.
// Le localStorage ne garde que l'état de l'interface (onglets, affichage).
//
// - écriture atomique : fichier temporaire puis renommage, jamais de fichier
//   à moitié écrit ;
// - version précédente (lisible) gardée dans profils.json.bak, proposée à la
//   restauration si profils.json devient illisible ;
// - un profils.json illisible n'est jamais écrasé sans copie : il est mis de
//   côté dans profils.json.illisible avant la première écriture suivante.
//
// Fonctions pures à dépendances injectées (fs, path) : testées par
// test/profils.test.js, branchées dans main.js (IPC profils:lire / profils:ecrire).

const NOM_FICHIER = 'profils.json';
const NOM_SAUVEGARDE = 'profils.json.bak';
const NOM_ILLISIBLE = 'profils.json.illisible';

function chemins(dossier, path) {
  return {
    fichier: path.join(dossier, NOM_FICHIER),
    sauvegarde: path.join(dossier, NOM_SAUVEGARDE),
    illisible: path.join(dossier, NOM_ILLISIBLE),
    temporaire: path.join(dossier, NOM_FICHIER + '.tmp')
  };
}

function messageErreur(e) {
  return (e && e.message) ? e.message : String(e);
}

// Lit une liste de comptes : { status: 'ok', comptes } | { status: 'absent' }
// | { status: 'corrompu', erreur } | { status: 'erreur', erreur }.
function lireListe(fichier, fs) {
  let brut;
  try {
    brut = fs.readFileSync(fichier, 'utf-8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { status: 'absent' };
    return { status: 'erreur', erreur: messageErreur(e) };
  }
  let donnees;
  try {
    donnees = JSON.parse(brut);
  } catch (e) {
    return { status: 'corrompu', erreur: messageErreur(e) };
  }
  if (!Array.isArray(donnees)) return { status: 'corrompu', erreur: 'un tableau de comptes est attendu' };
  return { status: 'ok', comptes: donnees };
}

// Lecture au démarrage. Si profils.json est illisible, la sauvegarde
// (profils.json.bak) est jointe quand elle est lisible : { ..., sauvegarde }.
function lireProfils(dossier, deps) {
  const c = chemins(dossier, deps.path);
  const r = lireListe(c.fichier, deps.fs);
  if (r.status === 'ok' || r.status === 'absent') return r;
  const s = lireListe(c.sauvegarde, deps.fs);
  return Object.assign({}, r, { sauvegarde: s.status === 'ok' ? s.comptes : null });
}

// Écrit la liste complète des comptes : { ok: true, nombre } | { ok: false, erreur }.
function ecrireProfils(dossier, comptes, deps) {
  if (!Array.isArray(comptes)) return { ok: false, erreur: 'un tableau de comptes est attendu' };
  const fs = deps.fs;
  const c = chemins(dossier, deps.path);
  try {
    fs.mkdirSync(dossier, { recursive: true });
    const precedent = lireListe(c.fichier, fs);
    if (precedent.status === 'ok') fs.copyFileSync(c.fichier, c.sauvegarde);
    else if (precedent.status !== 'absent') fs.copyFileSync(c.fichier, c.illisible);
    fs.writeFileSync(c.temporaire, JSON.stringify(comptes, null, 2), 'utf-8');
    fs.renameSync(c.temporaire, c.fichier);
    return { ok: true, nombre: comptes.length };
  } catch (e) {
    return { ok: false, erreur: messageErreur(e) };
  }
}

const api = { NOM_FICHIER, NOM_SAUVEGARDE, NOM_ILLISIBLE, chemins, lireListe, lireProfils, ecrireProfils };

module.exports = api;
