'use strict';

// Issue #331 : les préférences de l'interface (IA à portée de main, ordre des
// comptes, onglets étoilés, cartes repliées, largeur des panneaux) sont
// stockées dans <userData>/preferences.json, et non plus dans le localStorage.
// Seuls les onglets ouverts restent dans le localStorage (relecture de #311).
//
// - seules les clés de CLES sont lues et écrites (aucune autre donnée) ;
// - écriture atomique : fichier temporaire puis renommage ;
// - un preferences.json illisible est mis de côté dans
//   preferences.json.illisible avant d'être remplacé.
//
// Fonctions pures à dépendances injectées (fs, path) : testées par
// test/preferences.test.js, branchées dans main.js (IPC preferences:lire /
// preferences:ecrire).

const NOM_FICHIER = 'preferences.json';
const NOM_ILLISIBLE = 'preferences.json.illisible';

const CLES = Object.freeze([
  'ai_active_services',
  'ai_account_order',
  'ai_starred_tabs',
  'collapsed_accounts',
  'ide_w',
  'explorer_w'
]);

function chemins(dossier, path) {
  return {
    fichier: path.join(dossier, NOM_FICHIER),
    illisible: path.join(dossier, NOM_ILLISIBLE),
    temporaire: path.join(dossier, NOM_FICHIER + '.tmp')
  };
}

function messageErreur(e) {
  return (e && e.message) ? e.message : String(e);
}

function estObjet(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Ne garde que les clés connues, aux valeurs sérialisables en JSON.
function filtrer(prefs) {
  const out = {};
  for (const cle of CLES) {
    if (Object.prototype.hasOwnProperty.call(prefs, cle) && prefs[cle] !== undefined) out[cle] = prefs[cle];
  }
  return out;
}

// { status: 'ok', preferences } | { status: 'absent' }
// | { status: 'corrompu', erreur } | { status: 'erreur', erreur }.
function lirePreferences(dossier, deps) {
  const c = chemins(dossier, deps.path);
  let brut;
  try {
    brut = deps.fs.readFileSync(c.fichier, 'utf-8');
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
  if (!estObjet(donnees)) return { status: 'corrompu', erreur: 'un objet de préférences est attendu' };
  return { status: 'ok', preferences: filtrer(donnees) };
}

// Réponse du canal preferences:lire : le résultat de lecture, plus la liste
// des clés gérées (le renderer s'en sert pour la migration depuis le
// localStorage, sans dupliquer la liste).
function lireAvecCles(dossier, deps) {
  return Object.assign({ cles: CLES.slice() }, lirePreferences(dossier, deps));
}

// Écrit l'ensemble des préférences : { ok: true, cles } | { ok: false, erreur }.
function ecrirePreferences(dossier, prefs, deps) {
  if (!estObjet(prefs)) return { ok: false, erreur: 'un objet de préférences est attendu' };
  const fs = deps.fs;
  const c = chemins(dossier, deps.path);
  try {
    fs.mkdirSync(dossier, { recursive: true });
    const precedent = lirePreferences(dossier, deps);
    if (precedent.status === 'corrompu') fs.copyFileSync(c.fichier, c.illisible);
    const propres = filtrer(prefs);
    fs.writeFileSync(c.temporaire, JSON.stringify(propres, null, 2), 'utf-8');
    fs.renameSync(c.temporaire, c.fichier);
    return { ok: true, cles: Object.keys(propres).length };
  } catch (e) {
    return { ok: false, erreur: messageErreur(e) };
  }
}

module.exports = { NOM_FICHIER, NOM_ILLISIBLE, CLES, chemins, filtrer, lirePreferences, lireAvecCles, ecrirePreferences };
