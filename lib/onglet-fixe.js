'use strict';

// lib/onglet-fixe.js — premier onglet « immuable » (issue #338).
//
// Réglages : ongletFixeActif (case à cocher) et ongletFixeUrl (adresse https,
// normalisée par lib/settings.js).
// Activé avec une adresse valide, IAO ouvre en premier un onglet qu'on ne peut
// ni fermer ni déplacer. On y navigue sur le site de l'adresse (même hôte ou
// sous-domaine) ; un lien ou une popup vers un autre site est bloqué. Cliquer
// sur l'onglet ramène à l'adresse définie.
//
// Session propre (partition persist:onglet-fixe), indépendante des profils :
// les identifiants partagés des réglages (issue #278) y sont proposés comme
// dans les autres onglets (preload posé sur chaque session par main.js).
//
// Fonctions pures, sans Electron ni DOM : chargé par main.js (require) et par
// index.html (<script>, window.iaoOngletFixe).

var PARTITION = 'persist:onglet-fixe';
var ID_ONGLET = 'tab_fixe';

// Vrai si `url` reste sur le site de `base` : https, même hôte ou sous-domaine.
function memeSite(url, base) {
  var hoteBase;
  try {
    hoteBase = new URL(base).hostname;
  } catch (_) {
    return false;
  }
  try {
    var u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return u.hostname === hoteBase || u.hostname.endsWith('.' + hoteBase);
  } catch (_) {
    return false;
  }
}

// Réglages normalisés (lib/settings.js) -> configuration de l'onglet
// ({ actif, url }) ; actif seulement si la case est cochée ET l'adresse valide.
function configuration(reglages) {
  var r = reglages && typeof reglages === 'object' ? reglages : {};
  var url = typeof r.ongletFixeUrl === 'string' ? r.ongletFixeUrl : '';
  return { actif: r.ongletFixeActif === true && url !== '', url: url };
}

// Nom affiché sur l'onglet : l'hôte de l'adresse, sans « www. ».
function libelle(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

var iaoOngletFixe = {
  PARTITION: PARTITION,
  ID_ONGLET: ID_ONGLET,
  memeSite: memeSite,
  configuration: configuration,
  libelle: libelle
};

if (typeof window !== 'undefined') {
  window.iaoOngletFixe = iaoOngletFixe;
} else {
  module.exports = iaoOngletFixe;
}
