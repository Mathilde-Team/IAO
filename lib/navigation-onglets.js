'use strict';

// lib/navigation-onglets.js — issue #364 : boutons précédent / suivant dans
// l'historique de navigation d'un onglet (à côté de recharger et accueil).
//
// PUR : chargé par le renderer (<script src>, window.iaoNavigationOnglets)
// et par node --test (module.exports). Aucun accès au DOM ni à Electron —
// l'état de la <webview> (canGoBack / canGoForward) est lu par l'appelant
// (assets/app.js), qui applique le résultat aux boutons de la barre d'outils
// de l'onglet.

// État visuel des deux boutons : chacun est désactivé quand l'historique de
// la webview ne permet pas d'y aller (aucune page précédente / suivante).
// Tolère les valeurs absentes (webview pas encore prête) : sans état, les
// deux boutons sont désactivés.
function etatBoutonsNavigation(peutRevenirEnArriere, peutAvancerEnAvant) {
  return {
    precedentDesactive: !peutRevenirEnArriere,
    suivantDesactive: !peutAvancerEnAvant
  };
}

var iaoNavigationOnglets = {
  etatBoutonsNavigation: etatBoutonsNavigation
};

if (typeof window !== 'undefined') {
  window.iaoNavigationOnglets = iaoNavigationOnglets;
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = iaoNavigationOnglets;
}
