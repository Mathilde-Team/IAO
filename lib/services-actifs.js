'use strict';

// lib/services-actifs.js — services d'un compte alignés sur la sélection
// « mes IA à portée de main » (issues #42 et #319, de 1 à n). PUR : chargé par le
// renderer (<script src>, window.iaoServicesActifs) et par node --test
// (module.exports).
//
// Aucun écran ne choisit les services compte par compte : la liste d'un compte
// est donc exactement la sélection active, dans son ordre. Avant #319, le
// démarrage AJOUTAIT les services actifs à ceux du compte (anciens + nouveaux
// après un changement de sélection) et un compte créé recevait tout le catalogue.
// Les cooldowns sont conservés (y compris ceux d'un service retiré, qui
// resservent s'il est sélectionné de nouveau) ; un service ajouté démarre à 0.

// Aligne `compte` sur `ids` ; renvoie true si le compte a été modifié.
function alignerServices(compte, ids) {
  var cibles = Array.isArray(ids) ? ids.slice() : [];
  var modifie = false;
  var actuels = Array.isArray(compte.services) ? compte.services : null;
  if (!actuels || actuels.length !== cibles.length ||
      actuels.some(function(sid, i) { return sid !== cibles[i]; })) {
    compte.services = cibles.slice();
    modifie = true;
  }
  if (!compte.cooldowns || typeof compte.cooldowns !== 'object') {
    compte.cooldowns = {};
    modifie = true;
  }
  cibles.forEach(function(sid) {
    if (compte.cooldowns[sid] === undefined) { compte.cooldowns[sid] = 0; modifie = true; }
  });
  return modifie;
}

// Aligne tous les comptes ; renvoie le nombre de comptes modifiés.
function alignerTous(comptes, ids) {
  var n = 0;
  (Array.isArray(comptes) ? comptes : []).forEach(function(c) {
    if (alignerServices(c, ids)) n++;
  });
  return n;
}

var iaoServicesActifs = { alignerServices: alignerServices, alignerTous: alignerTous };
if (typeof window !== 'undefined') window.iaoServicesActifs = iaoServicesActifs;
else module.exports = iaoServicesActifs;
