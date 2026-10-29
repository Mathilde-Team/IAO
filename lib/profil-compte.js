'use strict';

// lib/profil-compte.js — issue #333 : le nom de profil n'est plus saisi ni
// affiché. Il reprend le nom du compte à la création (fenêtre du compte,
// création en série, import d'un compte sans profil) et reste la jointure
// (partition persist:<profil>, coffre des mots de passe, statistiques,
// ordonnanceur). À l'écran, un compte se présente par « nom - adresse mail ».
//
// PUR : chargé par le renderer (<script src>, window.iaoProfilCompte) et par
// node --test (module.exports).

// Clés acceptées par le coffre des mots de passe (lib/coffre-secrets.js).
var PROFIL_MAX = 64;

// Profil tiré du nom : accents retirés, minuscules (Electron met les noms de
// partition en minuscules, deux profils ne doivent pas s'y confondre), tout
// autre caractère que lettre, chiffre, « _ » ou « - » remplacé par « _ ».
// Unique parmi `utilises` (Set ou tableau, comparaison sans casse) : suffixe
// _2, _3… si besoin. Nom vide ou sans caractère utilisable : profil_<n>.
function profilDepuisNom(nom, utilises) {
  var pris = new Set();
  (utilises ? Array.from(utilises) : []).forEach(function(p) { pris.add(String(p).toLowerCase()); });
  var base = String(nom == null ? '' : nom)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, PROFIL_MAX);
  if (!base) {
    var n = pris.size + 1;
    while (pris.has('profil_' + n)) n++;
    return 'profil_' + n;
  }
  if (!pris.has(base)) return base;
  for (var i = 2; ; i++) {
    var suffixe = '_' + i;
    var candidat = base.slice(0, PROFIL_MAX - suffixe.length) + suffixe;
    if (!pris.has(candidat)) return candidat;
  }
}

// « nom - adresse mail » (ou le nom seul, ou l'adresse seule).
function libelleCompte(compte) {
  var c = compte || {};
  var nom = String(c.name || '').trim();
  var email = String(c.email || '').trim();
  if (nom && email) return nom + ' - ' + email;
  return nom || email || String(c.profile || '');
}

// Libellé d'un profil : celui de son compte, sinon le profil lui-même
// (compte supprimé depuis).
function libelleProfil(profil, comptes) {
  var liste = Array.isArray(comptes) ? comptes : [];
  for (var i = 0; i < liste.length; i++) {
    if (liste[i] && liste[i].profile === profil) return libelleCompte(liste[i]);
  }
  return String(profil == null ? '' : profil);
}

var iaoProfilCompte = { PROFIL_MAX: PROFIL_MAX, profilDepuisNom: profilDepuisNom, libelleCompte: libelleCompte, libelleProfil: libelleProfil };

if (typeof window !== 'undefined') {
  window.iaoProfilCompte = iaoProfilCompte;
} else {
  module.exports = iaoProfilCompte;
}
