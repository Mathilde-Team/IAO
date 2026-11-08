'use strict';

// Issue #375 : onglets de la modale Réglages. Fonctions pures de
// lib/settings-onglets.js + structure statique d'index.html (barre
// d'onglets, panes, cases « Réglages affichés »).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const O = require('../lib/settings-onglets.js');

test('#375 : normaliserVisibilite — défaut tout affiché', () => {
  assert.deepEqual(O.normaliserVisibilite(), { navigation: true, messagerie: true, donnees: true });
  assert.deepEqual(O.normaliserVisibilite(null), { navigation: true, messagerie: true, donnees: true });
  assert.deepEqual(O.normaliserVisibilite('plein'), { navigation: true, messagerie: true, donnees: true });
});

test('#375 : normaliserVisibilite — valeurs partielles et fausses', () => {
  assert.deepEqual(O.normaliserVisibilite({ messagerie: false }), { navigation: true, messagerie: false, donnees: true });
  assert.deepEqual(O.normaliserVisibilite({ navigation: false, donnees: 0 }), { navigation: false, messagerie: true, donnees: false });
  // Une valeur non booléenne (1, 'oui'…) n'est pas acceptée : seul true vaut.
  assert.equal(O.normaliserVisibilite({ navigation: 1 }).navigation, false);
});

test('#375 : ongletsVisibles — ordre et filtrage', () => {
  assert.deepEqual(O.ongletsVisibles(), ['general', 'services', 'editeur', 'navigation', 'messagerie', 'donnees']);
  assert.deepEqual(O.ongletsVisibles({ navigation: false }), ['general', 'services', 'editeur', 'messagerie', 'donnees']);
  assert.deepEqual(O.ongletsVisibles({ navigation: false, messagerie: false, donnees: false }), ['general', 'services', 'editeur']);
  // Les onglets de base ne peuvent pas être masqués par la visibilité.
  assert.deepEqual(O.ongletsVisibles({ general: false, services: false, editeur: false }), ['general', 'services', 'editeur', 'navigation', 'messagerie', 'donnees']);
  assert.equal(O.ongletActifValide('services', { services: false }), 'services');
});

test('#375 : ongletActifValide — repli sur un onglet toujours visible', () => {
  assert.equal(O.ongletActifValide('messagerie', {}), 'messagerie');
  assert.equal(O.ongletActifValide('messagerie', { messagerie: false }), O.ONGLET_DEFAUT);
  assert.equal(O.ongletActifValide('inconnu', {}), O.ONGLET_DEFAUT);
  assert.equal(O.ongletActifValide(undefined, {}), O.ONGLET_DEFAUT);
  assert.equal(O.ONGLET_DEFAUT, 'general');
});

test('#375 : le module s’expose au navigateur (window.IaoSettingsOnglets)', () => {
  const chemin = require.resolve('../lib/settings-onglets.js');
  // Sans window (Node pur) : pas d’exposition, pas d’erreur.
  delete require.cache[chemin];
  delete globalThis.window;
  require(chemin);
  assert.equal(globalThis.window, undefined);

  // window null : aucun accès (sinon TypeError), aucune exposition.
  globalThis.window = null;
  delete require.cache[chemin];
  require(chemin);
  assert.equal(globalThis.window, null);

  // window présent : exposé, et la même référence que module.exports.
  globalThis.window = {};
  delete require.cache[chemin];
  require(chemin);
  assert.equal(globalThis.window.IaoSettingsOnglets, require(chemin));
  delete globalThis.window;
});

test('#375 : pas de collision de const EXPORTS avec lib/liens-contexte.js (scripts classiques)', () => {
  // index.html charge les deux modules en <script src> : deux scripts
  // classiques partagent l’environnement lexical global — deux `const EXPORTS`
  // au sommet lèveraient SyntaxError et afficheraient le bandeau d’erreur du
  // garde de démarrage (vu en CI sur la PR #378).
  const fs = require('node:fs');
  const vm = require('node:vm');
  const racine = path.join(__dirname, '..');
  globalThis.window = {};
  try {
    vm.runInThisContext(fs.readFileSync(path.join(racine, 'lib', 'liens-contexte.js'), 'utf8'), {
      filename: 'lib/liens-contexte.js',
    });
    vm.runInThisContext(fs.readFileSync(path.join(racine, 'lib', 'settings-onglets.js'), 'utf8'), {
      filename: 'lib/settings-onglets.js',
    });
    assert.equal(typeof globalThis.window.IaoLiens.estUrlWeb, 'function', 'liens-contexte.js cassé');
    assert.equal(
      typeof globalThis.window.IaoSettingsOnglets.ongletsVisibles,
      'function',
      'settings-onglets.js cassé'
    );
  } finally {
    delete globalThis.window;
  }
});

test('#375 : index.html — barre d’onglets, panes et cases « Réglages affichés »', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  const debut = html.indexOf('<div class="modal-overlay" id="settingsModal">');
  const fin = html.indexOf('<!-- Modal mot de passe de la sauvegarde', debut);
  const bloc = html.slice(debut, fin);
  assert.ok(debut >= 0 && fin > debut, 'modale Réglages introuvable');

  assert.match(bloc, /<div class="settings-tabs"/, 'barre d’onglets manquante');
  for (const id of ['general', 'services', 'editeur', 'navigation', 'messagerie', 'donnees']) {
    assert.ok(bloc.includes('data-settings-tab="' + id + '"'), 'bouton d’onglet manquant : ' + id);
    assert.ok(bloc.includes('data-settings-pane="' + id + '"'), 'pane manquant : ' + id);
  }
  // Chaque identifiant de réglage reste présent (aucun champ perdu au passage).
  for (const id of ['settingsTheme', 'settingsLanguage', 'settingsEditorFontSize', 'settingsEditorWordWrap',
    'settingsConfirmTabClose', 'settingsShowAutomationWindows', 'settingsStartWithLastSession', 'settingsHarCapture',
    'settingsMailPrefix', 'settingsMailDomain', 'settingsWebmailUrl', 'settingsMailApiUrl', 'settingsMailApiKey',
    'settingsOngletFixeActif', 'settingsOngletFixeUrl', 'settingsExternalBrowser',
    'sauvegardeCreer', 'sauvegardeRestaurer', 'identifiantsListe', 'identifiantsAjouter',
    'settingsTabNavigation', 'settingsTabMessagerie', 'settingsTabDonnees']) {
    assert.ok(bloc.includes('id="' + id + '"'), 'champ manquant dans la modale : ' + id);
  }
  // Le script du module pur est chargé.
  assert.match(html, /<script src="lib\/settings-onglets\.js"><\/script>/, 'lib/settings-onglets.js non chargé');
});

test('#381 : le choix des IA vit uniquement dans le nouvel onglet des réglages', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  assert.doesNotMatch(html, /id="servicesModal"|data-action="ui-(?:open|close|save)ServicesModal"/);
  assert.equal((html.match(/id="servicesList"/g) || []).length, 1);
  assert.match(html, /data-settings-pane="services"[^>]*>[\s\S]*?Choisir mes IA à portée de main[\s\S]*?id="servicesList"/);
});

test('#375 : app.css — corps défilant et habillage des onglets', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.css'), 'utf-8');
  function rule(selector) {
    const m = new RegExp('\\n\\s*' + selector.replace('.', '\\.') + '\\s*\\{([^}]*)\\}').exec(css);
    assert.ok(m, 'règle introuvable : ' + selector);
    return m[1];
  }
  assert.match(rule('.settings-body'), /overflow-y:\s*auto/, 'ascenseur manquant sur .settings-body');
  assert.match(rule('.settings-body'), /min-height:\s*0/, 'min-height manquant (flex + overflow)');
  assert.match(rule('.settings-tab--active'), /border-color:\s*var\(--accent\)/, 'onglet actif non accentué');
  assert.match(rule('.settings-pane'), /display:\s*none/, 'les panes inactifs doivent être masqués');
  assert.match(rule('.settings-pane--active'), /display:\s*flex/, 'le pane actif doit être affiché');
});
