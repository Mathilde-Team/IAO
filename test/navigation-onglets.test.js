'use strict';

// Boutons précédent / suivant de l'historique d'un onglet (issue #364) :
// lib/navigation-onglets.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const n = require('../lib/navigation-onglets.js');

test('#364 etatBoutonsNavigation : historique ouvert dans les deux sens', () => {
  assert.deepEqual(n.etatBoutonsNavigation(true, true), { precedentDesactive: false, suivantDesactive: false });
});

test('#364 etatBoutonsNavigation : extrémités de l\'historique', () => {
  assert.deepEqual(n.etatBoutonsNavigation(false, true), { precedentDesactive: true, suivantDesactive: false });
  assert.deepEqual(n.etatBoutonsNavigation(true, false), { precedentDesactive: false, suivantDesactive: true });
});

test('#364 etatBoutonsNavigation : première page d\'un onglet neuf', () => {
  assert.deepEqual(n.etatBoutonsNavigation(false, false), { precedentDesactive: true, suivantDesactive: true });
});

test('#364 etatBoutonsNavigation : webview pas encore prête (absences tolérées)', () => {
  assert.deepEqual(n.etatBoutonsNavigation(), { precedentDesactive: true, suivantDesactive: true });
  assert.deepEqual(n.etatBoutonsNavigation(undefined, undefined), { precedentDesactive: true, suivantDesactive: true });
});

test('#364 chargé par <script> : exposé sur window (branche navigateur)', () => {
  const chemin = path.join(__dirname, '..', 'lib', 'navigation-onglets.js');
  const origine = global.window;
  delete require.cache[chemin];
  global.window = {};
  try {
    require(chemin);
    assert.equal(typeof global.window.iaoNavigationOnglets.etatBoutonsNavigation, 'function');
  } finally {
    global.window = origine;
    delete require.cache[chemin];
  }
});
