'use strict';

// Issue #333 : lib/profil-compte.js — profil tiré du nom du compte, libellé
// « nom - adresse mail ».

const test = require('node:test');
const assert = require('node:assert/strict');

const p = require('../lib/profil-compte.js');

test('#333 profilDepuisNom : accents, casse, caractères refusés par le coffre', () => {
  assert.equal(p.profilDepuisNom('24014', []), '24014');
  assert.equal(p.profilDepuisNom('Compte Pro Été', []), 'compte_pro_ete');
  assert.equal(p.profilDepuisNom('  a/b\\c:d  ', []), 'a_b_c_d');
  assert.equal(p.profilDepuisNom('__x--y__', []), 'x--y');
  assert.equal(p.profilDepuisNom('a'.repeat(80), []).length, p.PROFIL_MAX);
  assert.match(p.profilDepuisNom('Ünïcödé 名前', []), /^[a-z0-9_-]{1,64}$/);
});

test('#333 profilDepuisNom : unique parmi les profils pris (sans casse), suffixe dans la limite', () => {
  assert.equal(p.profilDepuisNom('Perso', ['perso']), 'perso_2');
  assert.equal(p.profilDepuisNom('Perso', new Set(['PERSO', 'perso_2'])), 'perso_3');
  const long = 'b'.repeat(64);
  const r = p.profilDepuisNom(long, [long]);
  assert.equal(r, 'b'.repeat(62) + '_2');
  assert.equal(p.profilDepuisNom('x'), 'x');
});

test('#333 profilDepuisNom : nom vide ou inutilisable -> profil_<n> libre', () => {
  assert.equal(p.profilDepuisNom('', []), 'profil_1');
  assert.equal(p.profilDepuisNom(null, ['a']), 'profil_2');
  assert.equal(p.profilDepuisNom(undefined, ['profil_1']), 'profil_2');
  assert.equal(p.profilDepuisNom('***', ['profil_1', 'profil_3']), 'profil_4');
});

test('#333 libelleCompte : « nom - adresse mail », sinon ce qui existe', () => {
  assert.equal(p.libelleCompte({ name: '24014', email: 'docker24014@dmathilde.fr', profile: '24014' }), '24014 - docker24014@dmathilde.fr');
  assert.equal(p.libelleCompte({ name: ' Perso ', email: '' }), 'Perso');
  assert.equal(p.libelleCompte({ email: 'a@b.fr' }), 'a@b.fr');
  assert.equal(p.libelleCompte({ profile: 'profil_1' }), 'profil_1');
  assert.equal(p.libelleCompte(null), '');
});

test('#333 libelleProfil : libellé du compte, sinon le profil (compte supprimé)', () => {
  const comptes = [null, { name: 'Un', email: 'un@x.fr', profile: 'profil_1' }];
  assert.equal(p.libelleProfil('profil_1', comptes), 'Un - un@x.fr');
  assert.equal(p.libelleProfil('profil_fantome', comptes), 'profil_fantome');
  assert.equal(p.libelleProfil('x', undefined), 'x');
  assert.equal(p.libelleProfil(null, []), '');
});

test('#333 chargé par <script> : exposé sur window (branche navigateur)', () => {
  const chemin = require.resolve('../lib/profil-compte.js');
  const origine = global.window;
  delete require.cache[chemin];
  global.window = {};
  try {
    require(chemin);
    assert.equal(typeof global.window.iaoProfilCompte.profilDepuisNom, 'function');
  } finally {
    global.window = origine;
    delete require.cache[chemin];
  }
});
