'use strict';

// Issue #329 : lib/ecriture-zip.js — toute archive écrite se relit avec
// lib/lecture-zip.js (mêmes limites, pas de ZIP64).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { EcrivainZip, ErreurEcritureZip, dateDos, ENTREES_MAX } = require('../lib/ecriture-zip');
const lecture = require('../lib/lecture-zip');

// fs en mémoire : writeSync accumule (au plus `morceau` octets par appel).
function fsMemoire(morceau) {
  const parts = [];
  return {
    parts,
    writeSync(fd, buf, debut, longueur) {
      const n = Math.min(longueur, morceau || longueur);
      parts.push(Buffer.from(buf.subarray(debut, debut + n)));
      return n;
    },
    contenu: () => Buffer.concat(parts)
  };
}

test('#329 écriture puis lecture : stocké, deflate, UTF-8, dossiers, écritures partielles', () => {
  const mem = fsMemoire(7);
  const zip = new EcrivainZip(1, mem);
  const repetitif = Buffer.from('a'.repeat(5000));
  const court = Buffer.from('x');
  const date = new Date(2026, 9, 27, 21, 30, 15);
  zip.ajouter('iao-sauvegarde.json', court, date);
  zip.ajouter('donnees/Partitions/profil_1/Préférences', repetitif, date);
  zip.ajouter('donnees/vide', Buffer.alloc(0));
  const taille = zip.terminer();
  const buf = mem.contenu();
  assert.equal(taille, buf.length);
  const lecteur = lecture.lecteurDeBuffer(buf);
  const entrees = lecture.lireEntrees(lecteur);
  assert.deepEqual(entrees.map((e) => e.nom), ['iao-sauvegarde.json', 'donnees/Partitions/profil_1/Préférences', 'donnees/vide']);
  assert.equal(entrees[0].methode, 0); // stocké : la compression rallongerait
  assert.equal(entrees[1].methode, 8); // deflate
  assert.ok(entrees[1].tailleCompressee < 5000);
  assert.deepEqual(lecture.extraire(lecteur, entrees[0]), court);
  assert.deepEqual(lecture.extraire(lecteur, entrees[1]), repetitif);
  assert.equal(lecture.extraire(lecteur, entrees[2]).length, 0);
});

test('#329 écriture dans un vrai fichier, relue par lecteurDeFichier', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-zip-'));
  try {
    const f = path.join(d, 'a.zip');
    const fd = fs.openSync(f, 'w');
    const zip = new EcrivainZip(fd, fs);
    zip.ajouter('a.txt', Buffer.from('bonjour'));
    zip.terminer();
    fs.closeSync(fd);
    const fd2 = fs.openSync(f, 'r');
    try {
      const l = lecture.lecteurDeFichier(fd2, fs);
      assert.equal(lecture.extraire(l, lecture.lireEntrees(l)[0]).toString(), 'bonjour');
    } finally { fs.closeSync(fd2); }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('#329 noms refusés : vide, absolu, antislash, « .. », doublon, non-chaîne', () => {
  const zip = new EcrivainZip(1, fsMemoire());
  for (const nom of ['', '/abs', 'a\\b', 'a/../b', '..', 42]) {
    assert.throws(() => zip.ajouter(nom, Buffer.from('x')), ErreurEcritureZip, String(nom));
  }
  zip.ajouter('a', Buffer.from('x'));
  assert.throws(() => zip.ajouter('a', Buffer.from('y')), /en double/);
});

test('#329 limites du format sans ZIP64 : nombre d\'entrées, fichier, archive', () => {
  const zip = new EcrivainZip(1, fsMemoire());
  zip.central.length = ENTREES_MAX;
  assert.throws(() => zip.ajouter('a', Buffer.from('x')), /trop de fichiers/);
  const zip2 = new EcrivainZip(1, fsMemoire());
  assert.throws(() => zip2.ajouter('gros', { length: 0xffffffff }), /fichier trop grand/);
  const zip3 = new EcrivainZip(1, fsMemoire());
  zip3.position = 0xffffffff - 10;
  assert.throws(() => zip3.ajouter('a', Buffer.from('x')), /archive trop grande/);
  assert.throws(() => zip3.terminer(), /archive trop grande/);
});

test('#329 dateDos : bornée à 1980-2107, précision de 2 s', () => {
  assert.deepEqual(dateDos(new Date(1970, 0, 1, 0, 0, 0)), { heure: 0, jour: (0 << 9) | (1 << 5) | 1 });
  const d = dateDos(new Date(2200, 11, 31, 23, 59, 59));
  assert.equal(d.jour >> 9, 127);
  assert.equal(d.heure, (23 << 11) | (59 << 5) | 29);
});
