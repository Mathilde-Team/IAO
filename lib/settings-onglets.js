'use strict';

// lib/settings-onglets.js — Issue #375 : la modale Réglages est trop longue
// pour tenir sur une page. Les paramètres sont regroupés en onglets, et les
// groupes optionnels s'affichent ou se masquent par des cases à cocher
// (« Réglages affichés »). Fonctions PURES (aucune dépendance à Electron ni
// au DOM), testées par test/settings-onglets.test.js (invariant 11, CLAUDE.md).
// Le dessin des onglets vit dans index.html/assets/app.js ; ce module décide
// seulement quels onglets existent et lesquels sont visibles.

// Onglets de la modale Réglages, dans l'ordre d'affichage. `toujoursVisible` :
// onglet de base, jamais masquable (il porte justement les cases à cocher qui
// contrôlent les autres).
const ONGLETS = [
  { id: 'general', toujoursVisible: true },
  { id: 'services', toujoursVisible: true },
  { id: 'editeur', toujoursVisible: true },
  { id: 'navigation' },
  { id: 'messagerie' },
  { id: 'donnees' }
];

// Identifiants des onglets masquables, avec l'onglet de repli quand l'onglet
// actif disparaît (toujours un onglet de base, jamais masqué).
const ONGLET_DEFAUT = 'general';

// Visibilité par défaut : tout est affiché — une mise à jour ne retire rien
// à l'utilisateur existant (même choix que les réglages de l'app, #375).
const VISIBILITE_DEFAUT = { navigation: true, messagerie: true, donnees: true };

function normaliserVisibilite(v) {
  if (!v || typeof v !== 'object') return Object.assign({}, VISIBILITE_DEFAUT);
  const sortie = {};
  for (const o of ONGLETS) {
    if (o.toujoursVisible) continue;
    sortie[o.id] = v[o.id] === undefined ? true : v[o.id] === true;
  }
  return sortie;
}

// Liste des identifiants d'onglets à afficher, dans l'ordre, selon la
// visibilité donnée (déjà normalisée ou non).
function ongletsVisibles(visibilite) {
  const v = normaliserVisibilite(visibilite);
  return ONGLETS.filter((o) => o.toujoursVisible || v[o.id] === true)
    .map((o) => o.id);
}

// L'onglet actif reste valide : s'il est masqué (ou inconnu), repli sur un
// onglet toujours visible.
function ongletActifValide(actif, visibilite) {
  const visibles = ongletsVisibles(visibilite);
  if (visibles.indexOf(actif) >= 0) return actif;
  return ONGLET_DEFAUT;
}

// Chargé à la fois via <script src="lib/settings-onglets.js"> dans index.html
// et via require() depuis test/ — même pattern que lib/liens-contexte.js :
// dans le renderer Electron, `module` n'existe pas (ReferenceError sinon,
// rattrapée par le garde de démarrage qui affiche un bandeau d'erreur) et
// `window` n'existe pas sous Node.
const EXPORTS_ONGLETS = {
  ONGLETS,
  ONGLET_DEFAUT,
  VISIBILITE_DEFAUT,
  normaliserVisibilite,
  ongletsVisibles,
  ongletActifValide
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EXPORTS_ONGLETS;
}
if (typeof window !== 'undefined' && window !== null) {
  window.IaoSettingsOnglets = EXPORTS_ONGLETS;
}
