'use strict';

// lib/magasin-preferences.js — Issue #331 : magasin des préférences de
// l'interface, côté renderer. Même interface que localStorage (getItem,
// setItem, removeItem, valeurs en chaînes) pour que app.js change le moins
// possible, mais les données vivent dans <userData>/preferences.json via les
// canaux synchrones du preload (preferencesLire / preferencesEcrire).
//
// Dans le fichier, une valeur JSON (tableau, nombre…) est rangée telle quelle,
// une autre chaîne (largeur « 420px ») reste une chaîne : le fichier se lit
// à la main.
//
// Migration : au premier démarrage sans preferences.json, les clés encore
// présentes dans le localStorage y sont recopiées, puis retirées du
// localStorage une fois le fichier écrit.
//
// Chargé via <script src="lib/magasin-preferences.js"> dans index.html
// (window.creerMagasinPreferences) et via require() dans les tests.

function versValeur(texte) {
  try { return JSON.parse(texte); } catch (e) { return texte; }
}

function versTexte(valeur) {
  return typeof valeur === 'string' ? valeur : JSON.stringify(valeur);
}

// api : { lire() -> résultat de lirePreferences avec la liste des clés gérées
// (cles), ecrire(prefs) -> { ok, erreur } }
// stockage : localStorage (ou équivalent), journal : console.
function creerMagasinPreferences(api, stockage, journal) {
  let prefs = {};
  let migrer = false;
  const r = api.lire();
  const cles = (r && Array.isArray(r.cles)) ? r.cles : [];
  if (r && r.status === 'ok') {
    prefs = Object.assign({}, r.preferences);
    journal.debug('[preferences] fichier lu : ' + Object.keys(prefs).length + ' clé(s)');
  } else if (r && r.status === 'absent') {
    for (const cle of cles) {
      const v = stockage.getItem(cle);
      if (v !== null) prefs[cle] = versValeur(v);
    }
    migrer = true;
  } else {
    journal.error('[preferences] fichier illisible, valeurs par défaut : ' + (r && r.erreur));
  }

  function enregistrer() {
    const w = api.ecrire(prefs);
    if (!w || !w.ok) journal.error('[preferences] écriture impossible : ' + (w && w.erreur));
    return !!(w && w.ok);
  }

  if (migrer) {
    const n = Object.keys(prefs).length;
    if (enregistrer()) {
      for (const cle of cles) stockage.removeItem(cle);
      journal.debug('[preferences] migration depuis le localStorage : ' + n + ' clé(s)');
    }
  }

  return {
    getItem(cle) {
      return Object.prototype.hasOwnProperty.call(prefs, cle) ? versTexte(prefs[cle]) : null;
    },
    setItem(cle, texte) {
      prefs[cle] = versValeur(String(texte));
      enregistrer();
    },
    removeItem(cle) {
      delete prefs[cle];
      enregistrer();
    }
  };
}

if (typeof window !== 'undefined') {
  window.creerMagasinPreferences = creerMagasinPreferences;
} else {
  module.exports = { creerMagasinPreferences, versValeur, versTexte };
}
