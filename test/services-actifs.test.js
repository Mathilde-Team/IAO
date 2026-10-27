'use strict';

// Services d'un compte alignés sur la sélection active (issue #319) :
// lib/services-actifs.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../lib/services-actifs.js');

const NEUF = ['claude', 'chatgpt', 'gemini', 'zeta', 'perplexity', 'grok', 'leonardo', 'suno', 'deepseek'];

test('#319 : un changement de sélection remplace les services, sans cumul', () => {
  const compte = {
    services: ['claude', 'chatgpt', 'gemini', 'zeta', 'perplexity', 'grok', 'leonardo', 'suno', 'meshy'],
    cooldowns: { claude: 0, meshy: 123 }
  };
  assert.equal(s.alignerServices(compte, NEUF), true);
  assert.deepEqual(compte.services, NEUF);
  assert.equal(compte.cooldowns.deepseek, 0, 'service ajouté : cooldown à 0');
  assert.equal(compte.cooldowns.meshy, 123, 'cooldown d\'un service retiré conservé');
  assert.equal(s.alignerServices(compte, NEUF), false, 'déjà aligné : rien à écrire');
});

test('#319 : un compte qui avait tout le catalogue revient aux 9', () => {
  const compte = { services: NEUF.concat(['mistral', 'qwen']), cooldowns: {} };
  NEUF.forEach((sid) => { compte.cooldowns[sid] = 0; });
  assert.equal(s.alignerServices(compte, NEUF), true);
  assert.deepEqual(compte.services, NEUF);
});

test('ordre de la sélection respecté, liste copiée', () => {
  const ids = ['grok', 'claude'];
  const compte = { services: ['claude', 'grok'], cooldowns: { claude: 0, grok: 0 } };
  assert.equal(s.alignerServices(compte, ids), true);
  assert.deepEqual(compte.services, ['grok', 'claude']);
  assert.notEqual(compte.services, ids);
});

test('compte sans services ni cooldowns, sélection invalide', () => {
  const vide = {};
  assert.equal(s.alignerServices(vide, ['claude']), true);
  assert.deepEqual(vide, { services: ['claude'], cooldowns: { claude: 0 } });
  const cd = { services: [], cooldowns: null };
  assert.equal(s.alignerServices(cd, null), true);
  assert.deepEqual(cd, { services: [], cooldowns: {} });
});

test('alignerTous compte les comptes modifiés et tolère une liste absente', () => {
  const a = { services: ['claude'], cooldowns: { claude: 0 } };
  const b = { services: ['grok'], cooldowns: { grok: 0 } };
  assert.equal(s.alignerTous([a, b], ['claude']), 1);
  assert.deepEqual(b.services, ['claude']);
  assert.equal(s.alignerTous(null, ['claude']), 0);
});

test('services-actifs s\'attache à window dans le renderer', () => {
  const chemin = require.resolve('../lib/services-actifs.js');
  const avant = global.window;
  global.window = {};
  try {
    delete require.cache[chemin];
    require(chemin);
    assert.equal(typeof global.window.iaoServicesActifs.alignerServices, 'function');
  } finally {
    if (avant === undefined) delete global.window; else global.window = avant;
    delete require.cache[chemin];
  }
});
