'use strict';

// lib/local-storage-json.js — lecture JSON du localStorage qui ne lève JAMAIS
// (issues #52/#186 : un localStorage cassé — LevelDB « Database IO error » —
// faisait mourir TOUTE l'initialisation du renderer : l'app démarrait vide,
// sans erreur affichée ni proposition de restauration).
//
// Statuts :
//   'ok'      : valeur lue et JSON valide (data = valeur analysée) ;
//   'empty'   : clé absente (première utilisation) ;
//   'corrupt' : valeur lue mais JSON illisible (backup à proposer) ;
//   'erreur'  : ACCÈS au stockage impossible (getItem lève). L'app doit
//               continuer sans écraser : la restauration passe par
//               l'instantané de l'ordonnanceur (issue #186).
//
// Pur et injectable (storage = tout objet avec getItem) : testable par
// `node --test` (invariant 11, CLAUDE.md). La persistance (setItem) reste
// dans assets/app.js.

// ---------------------------------------------------------------------------
// Lit `cle` dans `storage` et analyse le JSON. Ne lève jamais : chaque échec
// est renvoyé comme un statut, pas comme une exception.
// ---------------------------------------------------------------------------
function lireStockageJSON(storage, cle) {
  let raw;
  try {
    raw = storage.getItem(cle);
  } catch (e) {
    return { status: 'erreur', data: null, error: e };
  }
  if (raw == null) return { status: 'empty', data: null };
  try {
    return { status: 'ok', data: JSON.parse(raw) };
  } catch (e) {
    return { status: 'corrupt', data: null, error: e };
  }
}

if (typeof window !== 'undefined') {
  window.lireStockageJSON = lireStockageJSON;
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lireStockageJSON: lireStockageJSON };
}
