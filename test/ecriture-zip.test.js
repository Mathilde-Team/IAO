'use strict';

// Issue #329 : écriture d'un ZIP lisible par lib/lecture-zip.js (aller-retour
// complet), noms refusés, choix stocké/deflate.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const z = require('../lib/ecriture-zip');
const lecture = require('../lib/lecture-zip');

function lireZip(buf) {
  const lecteur = lecture.lecteurDeBuffer(buf);
  return lecture.lireEntrees(lecteur).map(e => ({
    nom: e.nom,
    contenu: lecture.extraire(lecteur, e, { tailleMax: 10 * 1024 * 1024 })
  }));
}

test('ecrireZip : aller-retour avec lecture-zip (deflate et stocké)', () => {
  const petit = Buffer.from('a'.repeat(100));
  const zip = z.ecrireZip([
    { nom: 'profils.json', contenu: '{"a":1}' },
    { nom: 'dossier/secrets.txt', contenu: petit },
    { nom: 'vide.txt', contenu: '' }
  ]);
  const entrees = lireZip(zip);
  assert.deepEqual(entrees.map(e => e.nom), ['profils.json', 'dossier/secrets.txt', 'vide.txt']);
  assert.equal(entrees[0].contenu.toString('utf8'), '{"a":1}');
  assert.ok(entrees[0].contenu.equals(Buffer.from('{"a":1}')));
  assert.ok(entrees[1].contenu.equals(petit));
  assert.equal(entrees[2].contenu.length, 0);
});

test('ecrireZip : le contenu incompressible reste lisible (stocké)', () => {
  // Un buffer aléatoire ne se compresse pas : l'entrée doit quand même se relire.
  const aleatoire = require('node:crypto').randomBytes(4096);
  const zip = z.ecrireZip([{ nom: 'binaire.bin', contenu: aleatoire }]);
  const entrees = lireZip(zip);
  assert.ok(entrees[0].contenu.equals(aleatoire));
});

test('ecrireZip : archive vide, lisible, zéro entrée', () => {
  const zip = z.ecrireZip([]);
  assert.deepEqual(lireZip(zip), []);
});

test('ecrireZip : une chaîne est encodée en UTF-8 (accents)', () => {
  const zip = z.ecrireZip([{ nom: 'comptes.txt', contenu: 'adresse éà' }]);
  const entrees = lireZip(zip);
  assert.equal(entrees[0].contenu.toString('utf8'), 'adresse éà');
});

test('nomSure : refuse les chemins dangereux, accepte les relatifs', () => {
  assert.equal(z.nomSure('a/b.json'), true);
  assert.equal(z.nomSure('profils.json'), true);
  assert.equal(z.nomSure('dossier/'), false); // partie vide après « / »
  assert.equal(z.nomSure('../evil'), false);
  assert.equal(z.nomSure('a/../../evil'), false);
  assert.equal(z.nomSure('/absolu'), false);
  assert.equal(z.nomSure('C:\\windows'), false);
  assert.equal(z.nomSure(''), false);
  assert.equal(z.nomSure(42), false);
});

test('ecrireZip : lève sur un nom non sûr plutôt que d’écrire', () => {
  assert.throws(() => z.ecrireZip([{ nom: '../evil', contenu: 'x' }]), /non sûr/);
});

test('ecrireZip : CRC-32 identique à celui du lecteur', () => {
  const contenu = Buffer.from('contenu de test');
  const zip = z.ecrireZip([{ nom: 'f', contenu }]);
  const lecteur = lecture.lecteurDeBuffer(zip);
  const entree = lecture.lireEntrees(lecteur)[0];
  assert.equal(entree.crc, z.crc32(contenu));
});

test('ecrireZip : fichier sur disque relu de bout en bout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-zip-'));
  const fichier = path.join(dir, 'sauvegarde.zip');
  const zip = z.ecrireZip([{ nom: 'x/y.json', contenu: '{"ok":true}' }]);
  fs.writeFileSync(fichier, zip);
  const lecteur = lecture.lecteurDeFichier(fs.openSync(fichier, 'r'), fs);
  const entrees = lecture.lireEntrees(lecteur);
  const contenu = lecture.extraire(lecteur, entrees[0]);
  assert.equal(contenu.toString('utf8'), '{"ok":true}');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ecrireZip : date fournie (Date) et date par défaut, deux en-têtes valides', () => {
  // côté « Date » du ternaire de dateHeureDOS, puis repli sur l'heure courante.
  const avecDate = z.ecrireZip([{ nom: 'a.txt', contenu: 'x', date: new Date('2026-10-29T12:00:00Z') }]);
  const sansDate = z.ecrireZip([{ nom: 'a.txt', contenu: 'x' }]);
  assert.deepEqual(lireZip(avecDate).map(e => e.nom), ['a.txt']);
  assert.deepEqual(lireZip(sansDate).map(e => e.nom), ['a.txt']);
});

test('nomSure : deux points hors racine, refus seulement en position de lecteur', () => {
  assert.equal(z.nomSure('1:x'), false); // « 1: » lu comme racine de lecteur
  assert.equal(z.nomSure('ab:c/du.txt'), true); // deux points plus loin : accepté
});

test('ecrireZip : entrée sans nom (repli sur « ») refusée, entrées non liste -> archive vide', () => {
  assert.throws(() => z.ecrireZip([{ nom: 42, contenu: 'x' }]), /non sûr/);
  assert.deepEqual(lireZip(z.ecrireZip(null)).map(e => e.nom), []);
  assert.deepEqual(lireZip(z.ecrireZip(undefined)).map(e => e.nom), []);
});

test('ecrireZip : plafond ZIP64 injectable, refus net avant écriture (garde de #329)', () => {
  // entrée seule trop grande
  assert.throws(() => z.ecrireZip([{ nom: 'gros.txt', contenu: 'x'.repeat(50) }], { plafond: 10 }),
    /entrée trop grande/);
  // cumul des contenus au-delà du plafond
  assert.throws(() => z.ecrireZip([
    { nom: 'a.txt', contenu: 'xxxxxx' }, { nom: 'b.txt', contenu: 'xxxxxx' }
  ], { plafond: 10 }), /archive trop grande/);
  // offset cumulé (en-têtes + contenus) au-delà du plafond
  assert.throws(() => z.ecrireZip([{ nom: 'a.txt', contenu: 'x' }], { plafond: 10 }),
    /archive trop grande/);
});
