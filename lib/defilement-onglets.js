'use strict';

// lib/defilement-onglets.js — issue #339 : quand la barre d'onglets est
// pleine, des flèches gauche et droite permettent de faire défiler les
// onglets. L'onglet fixe (#338) est épinglé hors de la zone défilante et
// ne bouge jamais ; ces helpers ne jugent que la zone défilante.
//
// PUR : chargé par le renderer (<script src>, window.iaoDefilementOnglets)
// et par node --test (module.exports). Aucun accès au DOM — les mesures
// (scrollLeft, scrollWidth, clientWidth) sont faites par l'appelant.

// Marge de tolérance : les navigateurs arrondissent scrollLeft au sous-pixel
// et la valeur peut rester à ±1 de l'extrême après un défilement lissé.
var EPSILON = 1;

// Position normalisée dans la zone défilante : 0 = début du contenu.
// En LTR scrollLeft va de 0 (début) à max (fin) ; en RTL (Chromium) il va de
// -max (fin) à 0 (début). Normaliser évite de dupliquer chaque comparaison.
function positionNormee(scrollLeft, rtl) {
  // « + 0 » évite de rendre -0 (faux zéro), qui ne serait pas strictement
  // égal à 0 pour les appelsants.
  return rtl ? -Number(scrollLeft || 0) + 0 : Number(scrollLeft || 0);
}

// État des flèches pour une zone mesurée. `debordant` : le contenu dépasse
// la zone (flèches utiles) ; `avant` : du contenu précède l'affichage
// (flèche gauche active) ; `apres` : du contenu suit (flèche droite active).
function etatDefilement(scrollLeft, scrollWidth, clientWidth, rtl) {
  var pos = positionNormee(scrollLeft, rtl);
  var max = Math.max(0, Number(scrollWidth || 0) - Number(clientWidth || 0));
  return {
    debordant: Number(scrollWidth || 0) > Number(clientWidth || 0) + EPSILON,
    avant: pos > EPSILON,
    apres: pos < max - EPSILON
  };
}

// Pas d'un clic sur une flèche : ~80 % de la largeur visible, minimum
// 120 px pour rester perceptible sur une barre étroite. Arrondi pour des
// valeurs stables dans les tests.
function pasDefilement(clientWidth) {
  return Math.max(120, Math.round(Number(clientWidth || 0) * 0.8));
}

var iaoDefilementOnglets = {
  EPSILON: EPSILON,
  positionNormee: positionNormee,
  etatDefilement: etatDefilement,
  pasDefilement: pasDefilement
};

if (typeof window !== 'undefined') {
  window.iaoDefilementOnglets = iaoDefilementOnglets;
} else {
  module.exports = iaoDefilementOnglets;
}
