'use strict';

// Flèches de défilement de la barre d'onglets (issue #339) :
// lib/defilement-onglets.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const d = require('../lib/defilement-onglets.js');

test('#339 positionNormee : LTR direct, RTL inversé', () => {
  assert.equal(d.positionNormee(120, false), 120);
  assert.equal(d.positionNormee(-120, true), 120);
  assert.equal(d.positionNormee(0, true), 0);
  // Absences tolérées (zone non encore mesurée).
  assert.equal(d.positionNormee(undefined, false), 0);
  assert.equal(d.positionNormee(null, true), 0);
});

test('#339 etatDefilement : pas de débordement, flèches masquées', () => {
  assert.deepEqual(d.etatDefilement(0, 800, 800, false), { debordant: false, avant: false, apres: false });
  assert.deepEqual(d.etatDefilement(0, 800, 900, false), { debordant: false, avant: false, apres: false });
});

test('#339 etatDefilement : débordement, extrêmes et milieu (LTR)', () => {
  // 2000 px de contenu dans 800 px visibles : max = 1200.
  assert.deepEqual(d.etatDefilement(0, 2000, 800, false), { debordant: true, avant: false, apres: true });
  assert.deepEqual(d.etatDefilement(1200, 2000, 800, false), { debordant: true, avant: true, apres: false });
  assert.deepEqual(d.etatDefilement(600, 2000, 800, false), { debordant: true, avant: true, apres: true });
});

test('#339 etatDefilement : mêmes états en RTL (scrollLeft négatif)', () => {
  // Chromium en RTL : 0 au début (droite), -max à la fin.
  assert.deepEqual(d.etatDefilement(0, 2000, 800, true), { debordant: true, avant: false, apres: true });
  assert.deepEqual(d.etatDefilement(-1200, 2000, 800, true), { debordant: true, avant: true, apres: false });
  assert.deepEqual(d.etatDefilement(-600, 2000, 800, true), { debordant: true, avant: true, apres: true });
});

test('#339 etatDefilement : tolérance aux arrondis sous-pixel', () => {
  // Après un défilement lissé, scrollLeft peut rester à ±1 de l'extrême :
  // la flèche correspondante doit disparaître.
  assert.equal(d.etatDefilement(1199.4, 2000, 800, false).apres, false);
  assert.equal(d.etatDefilement(0.6, 2000, 800, false).avant, false);
  assert.equal(d.etatDefilement(2001, 2000, 800, false).debordant, true, 'débordement d\'un pixel : flèches utiles');
});

test('#339 etatDefilement : mesures absentes tolérées', () => {
  assert.deepEqual(d.etatDefilement(undefined, undefined, undefined, false),
    { debordant: false, avant: false, apres: false });
});

test('#339 pasDefilement : 80 % de la zone visible, minimum 120 px', () => {
  assert.equal(d.pasDefilement(800), 640);
  assert.equal(d.pasDefilement(500), 400);
  assert.equal(d.pasDefilement(100), 120);
  assert.equal(d.pasDefilement(0), 120);
  assert.equal(d.pasDefilement(undefined), 120);
});

test('#339 chargé par <script> : exposé sur window (branche navigateur)', () => {
  const chemin = path.join(__dirname, '..', 'lib', 'defilement-onglets.js');
  const origine = global.window;
  delete require.cache[chemin];
  global.window = {};
  try {
    require(chemin);
    assert.equal(typeof global.window.iaoDefilementOnglets.etatDefilement, 'function');
    assert.equal(global.window.iaoDefilementOnglets.EPSILON, 1);
  } finally {
    global.window = origine;
    delete require.cache[chemin];
  }
});
