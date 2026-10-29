'use strict';

// Issue #329 : sélection des chemins de la sauvegarde complète et secrets
// transportables (trousseau <-> mot de passe de la sauvegarde).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const s = require('../lib/sauvegarde-complete');

const dechiffre = (base64) => Buffer.from(base64, 'base64').toString('utf8'); // trousseau factice
const chiffre = (clair) => Buffer.from(clair, 'utf8').toString('base64');

test('cheminsASauvegarder : garde les données, exclut journal, HAR, temporaires', () => {
  const gardes = s.cheminsASauvegarder([
    'profils.json',
    'profils.json.bak',
    'secrets.json',
    'scheduler/comptes-sauvegarde.json',
    'stats/sessions.jsonl',
    'logs/iao.log',
    'har/example.com-20261029.har',
    'profils.json.tmp',
    'profils.json.illisible'
  ]);
  assert.deepEqual(gardes, [
    'profils.json',
    'profils.json.bak',
    'scheduler/comptes-sauvegarde.json',
    'stats/sessions.jsonl'
  ]);
});

test('secretsPortables puis secretsEnClair : aller-retour complet', () => {
  const coffre = { 'profil_1': chiffre('motdepasse1'), 'profil_2': chiffre('motdepasse2') };
  const portables = s.secretsPortables(coffre, 'secret-de-sauvegarde', dechiffre, crypto);
  assert.equal(portables.version, 1);
  assert.equal(Object.keys(portables.entrees).length, 2);
  assert.ok(!JSON.stringify(portables).includes('motdepasse')); // rien en clair
  const clair = s.secretsEnClair(portables, 'secret-de-sauvegarde', crypto);
  assert.deepEqual(clair, { 'profil_1': 'motdepasse1', 'profil_2': 'motdepasse2' });
});

test('secretsEnClair : mot de passe faux -> null (échec GCM net)', () => {
  const portables = s.secretsPortables({ 'p': chiffre('x') }, 'bon', dechiffre, crypto);
  assert.equal(s.secretsEnClair(portables, 'mauvais', crypto), null);
});

test('secretsEnClair : conteneur mal formé -> null, vide -> {}', () => {
  assert.equal(s.secretsEnClair(null, 'x', crypto), null);
  assert.equal(s.secretsEnClair({ version: 2, sel: 'ab', entrees: {} }, 'x', crypto), null);
  assert.equal(s.secretsEnClair({ version: 1, sel: 'ab', entrees: 'non' }, 'x', crypto), null);
  const vide = s.secretsPortables({}, 'x', dechiffre, crypto);
  assert.deepEqual(s.secretsEnClair(vide, 'x', crypto), {});
});

test('secretsPortables : un secret illisible sur cette machine est omis', () => {
  const portables = s.secretsPortables(
    { 'ok': chiffre('lisible'), 'etranger': chiffre('chiffré-ailleurs') },
    'x',
    (b64) => (b64 === chiffre('lisible') ? 'lisible' : null),
    crypto
  );
  assert.deepEqual(Object.keys(portables.entrees), ['ok']);
});

test('secretsPortables : chaque sauvegarde a son sel, les entrées ne se rejouent pas', () => {
  const coffre = { 'p': chiffre('secret') };
  const a = s.secretsPortables(coffre, 'mdp', dechiffre, crypto);
  const b = s.secretsPortables(coffre, 'mdp', dechiffre, crypto);
  assert.notEqual(a.sel, b.sel);
  assert.notEqual(a.entrees.p.iv, b.entrees.p.iv);
  // la clé d'un sel ne déchiffre pas l'autre sauvegarde
  const cleB = crypto.scryptSync('mdp', Buffer.from(b.sel, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  assert.throws(() => {
    const d = crypto.createDecipheriv('aes-256-gcm', cleB, Buffer.from(a.entrees.p.iv, 'hex'));
    d.setAuthTag(Buffer.from(a.entrees.p.tag, 'hex'));
    d.update(Buffer.from(a.entrees.p.donnees, 'hex'));
    d.final();
  });
});

test('secretsPortables : coffre mal formé -> sauvegarde vide, sans planter', () => {
  const portables = s.secretsPortables(null, 'x', dechiffre, crypto);
  assert.deepEqual(portables.entrees, {});
  assert.equal(s.secretsPortables('pas un objet', 'x', dechiffre, crypto).entrees && Object.keys(s.secretsPortables('pas un objet', 'x', dechiffre, crypto).entrees).length, 0);
});

test('cheminsASauvegarder : entrée non liste -> liste vide, sans planter', () => {
  assert.deepEqual(s.cheminsASauvegarder(null), []);
  assert.deepEqual(s.cheminsASauvegarder('profils.json'), []);
});

test('secretsPortables : clé vide ou valeur non texte -> entrée omise', () => {
  const coffre = { '': chiffre('a'), 'nombre': 42, 'bon': chiffre('b') };
  const portables = s.secretsPortables(coffre, 'mdp', dechiffre, crypto);
  assert.deepEqual(Object.keys(portables.entrees), ['bon']);
});

test('secretsEnClair : entrées mal formées -> null net (aucune écriture partielle)', () => {
  const base = s.secretsPortables({ 'p': chiffre('x') }, 'mdp', dechiffre, crypto);
  const casse = (modif) => s.secretsEnClair(Object.assign(JSON.parse(JSON.stringify(base)), modif), 'mdp', crypto);
  // entrée nulle, entrée non objet, puis chaque champ manquant
  assert.equal(casse({ entrees: { p: null } }), null);
  assert.equal(casse({ entrees: { p: 'chiffre' } }), null);
  assert.equal(casse({ entrees: { p: { tag: base.entrees.p.tag, donnees: base.entrees.p.donnees } } }), null);
  assert.equal(casse({ entrees: { p: { iv: base.entrees.p.iv, donnees: base.entrees.p.donnees } } }), null);
  assert.equal(casse({ entrees: { p: { iv: base.entrees.p.iv, tag: base.entrees.p.tag } } }), null);
});
