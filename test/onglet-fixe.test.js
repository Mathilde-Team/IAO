'use strict';

// Premier onglet immuable (issue #338) : lib/onglet-fixe.js et réglages.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const of = require('../lib/onglet-fixe.js');
const settings = require('../lib/settings.js');

test('#338 constantes : partition propre et identifiant d\'onglet', () => {
  assert.equal(of.PARTITION, 'persist:onglet-fixe');
  assert.equal(of.ID_ONGLET, 'tab_fixe');
});

test('#338 memeSite : même hôte ou sous-domaine, https seulement', () => {
  const base = 'https://github.com/Mathilde-Team';
  assert.equal(of.memeSite('https://github.com/Mathilde-Team/IAO/issues', base), true);
  assert.equal(of.memeSite('https://github.com/login', base), true);
  assert.equal(of.memeSite('https://gist.github.com/x', base), true);
  assert.equal(of.memeSite('https://evilgithub.com/', base), false);
  assert.equal(of.memeSite('https://github.com.evil.fr/', base), false);
  assert.equal(of.memeSite('https://example.com/', base), false);
  assert.equal(of.memeSite('http://github.com/', base), false);
  assert.equal(of.memeSite('javascript:alert(1)', base), false);
  assert.equal(of.memeSite('pas une adresse', base), false);
  assert.equal(of.memeSite('https://github.com/', ''), false, 'onglet non configuré : tout est bloqué');
  assert.equal(of.memeSite('https://github.com/', undefined), false);
});

test('#338 configuration : actif seulement coché ET adresse présente', () => {
  assert.deepEqual(of.configuration({ ongletFixeActif: true, ongletFixeUrl: 'https://github.com/' }),
    { actif: true, url: 'https://github.com/' });
  assert.deepEqual(of.configuration({ ongletFixeActif: true, ongletFixeUrl: '' }), { actif: false, url: '' });
  assert.deepEqual(of.configuration({ ongletFixeActif: false, ongletFixeUrl: 'https://github.com/' }),
    { actif: false, url: 'https://github.com/' });
  assert.deepEqual(of.configuration({ ongletFixeActif: 'true', ongletFixeUrl: 12 }), { actif: false, url: '' });
  assert.deepEqual(of.configuration(null), { actif: false, url: '' });
});

test('#338 libelle : hôte sans www.', () => {
  assert.equal(of.libelle('https://www.github.com/Mathilde-Team'), 'github.com');
  assert.equal(of.libelle('https://gist.github.com/'), 'gist.github.com');
  assert.equal(of.libelle(''), '');
});

test('#338 réglages : valeurs par défaut et normalisation', () => {
  assert.equal(settings.DEFAULT_SETTINGS.ongletFixeActif, false);
  assert.equal(settings.DEFAULT_SETTINGS.ongletFixeUrl, '');
  const n = settings.normalizeSettings({ ongletFixeActif: 'true', ongletFixeUrl: '  https://github.com/Mathilde-Team  ' });
  assert.equal(n.ongletFixeActif, true);
  assert.equal(n.ongletFixeUrl, 'https://github.com/Mathilde-Team');
  assert.equal(settings.normalizeSettings({}).ongletFixeActif, false);
  assert.equal(settings.normalizeOngletFixeUrl('http://github.com/'), '', 'http refusé');
  assert.equal(settings.normalizeOngletFixeUrl('file:///etc/passwd'), '');
  assert.equal(settings.normalizeOngletFixeUrl('pas une adresse'), '');
  assert.equal(settings.normalizeOngletFixeUrl(''), '');
  assert.equal(settings.normalizeOngletFixeUrl(null), '');
  assert.equal(settings.normalizeOngletFixeUrl('https://a.fr/' + 'x'.repeat(2048)), '', 'trop longue');
});

test('#338 chargé par <script> : exposé sur window (branche navigateur)', () => {
  const chemin = path.join(__dirname, '..', 'lib', 'onglet-fixe.js');
  const origine = global.window;
  delete require.cache[chemin];
  global.window = {};
  try {
    require(chemin);
    assert.equal(typeof global.window.iaoOngletFixe.memeSite, 'function');
  } finally {
    global.window = origine;
    delete require.cache[chemin];
  }
});
