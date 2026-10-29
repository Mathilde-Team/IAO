'use strict';

// Issue #311 : comptes dans <userData>/profils.json (lib/profils.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const profils = require('../lib/profils');

const deps = { fs, path };
function dossierTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iao-profils-'));
}
const A = [{ id: 'a1', name: 'Alice', profile: 'alice' }];
const B = [{ id: 'b1', name: 'Bob', profile: 'bob' }, { id: 'b2', name: 'Bea', profile: 'bea' }];

test('chemins : profils.json, .bak, .illisible et .tmp dans le dossier de données', () => {
  const c = profils.chemins('/d', path.posix);
  assert.deepEqual(c, {
    fichier: '/d/profils.json', sauvegarde: '/d/profils.json.bak',
    illisible: '/d/profils.json.illisible', temporaire: '/d/profils.json.tmp'
  });
});

test('lireProfils : dossier sans fichier -> absent', () => {
  const d = dossierTemporaire();
  try { assert.deepEqual(profils.lireProfils(d, deps), { status: 'absent' }); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('ecrireProfils puis lireProfils : aller-retour, écriture atomique (pas de .tmp restant)', () => {
  const d = dossierTemporaire();
  try {
    assert.deepEqual(profils.ecrireProfils(d, A, deps), { ok: true, nombre: 1 });
    assert.deepEqual(profils.lireProfils(d, deps), { status: 'ok', comptes: A });
    assert.equal(fs.existsSync(path.join(d, 'profils.json.tmp')), false);
    assert.equal(fs.existsSync(path.join(d, 'profils.json.bak')), false, 'pas de version précédente au premier enregistrement');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('ecrireProfils : la version précédente passe dans profils.json.bak', () => {
  const d = dossierTemporaire();
  try {
    profils.ecrireProfils(d, A, deps);
    profils.ecrireProfils(d, B, deps);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'profils.json'), 'utf-8')), B);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'profils.json.bak'), 'utf-8')), A);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('ecrireProfils : crée le dossier de données s\'il manque', () => {
  const d = dossierTemporaire();
  const sous = path.join(d, 'ai-manager');
  try {
    assert.equal(profils.ecrireProfils(sous, A, deps).ok, true);
    assert.deepEqual(profils.lireProfils(sous, deps).comptes, A);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('ecrireProfils : un profils.json illisible est mis de côté, la sauvegarde est préservée', () => {
  const d = dossierTemporaire();
  try {
    fs.writeFileSync(path.join(d, 'profils.json.bak'), JSON.stringify(A));
    fs.writeFileSync(path.join(d, 'profils.json'), '[{"id":');
    assert.equal(profils.ecrireProfils(d, B, deps).ok, true);
    assert.equal(fs.readFileSync(path.join(d, 'profils.json.illisible'), 'utf-8'), '[{"id":');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'profils.json.bak'), 'utf-8')), A);
    assert.deepEqual(profils.lireProfils(d, deps).comptes, B);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('ecrireProfils : liste non tableau refusée sans toucher au disque', () => {
  const d = dossierTemporaire();
  try {
    assert.deepEqual(profils.ecrireProfils(d, null, deps), { ok: false, erreur: 'un tableau de comptes est attendu' });
    assert.deepEqual(fs.readdirSync(d), []);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('ecrireProfils : erreur disque -> { ok: false, erreur }', () => {
  const fauxFs = Object.assign({}, fs, { mkdirSync: () => { throw new Error('EACCES: permission refusée'); } });
  assert.deepEqual(profils.ecrireProfils('/x', A, { fs: fauxFs, path }), { ok: false, erreur: 'EACCES: permission refusée' });
  const sansMessage = Object.assign({}, fs, { mkdirSync: () => { throw 'disque plein'; } }); // eslint-disable-line no-throw-literal
  assert.deepEqual(profils.ecrireProfils('/x', A, { fs: sansMessage, path }), { ok: false, erreur: 'disque plein' });
});

test('lireListe : JSON invalide, non tableau, erreur de lecture', () => {
  const d = dossierTemporaire();
  try {
    const f = path.join(d, 'p.json');
    fs.writeFileSync(f, '{');
    assert.equal(profils.lireListe(f, fs).status, 'corrompu');
    fs.writeFileSync(f, '{"a":1}');
    assert.deepEqual(profils.lireListe(f, fs), { status: 'corrompu', erreur: 'un tableau de comptes est attendu' });
    const fauxFs = { readFileSync: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; } };
    assert.deepEqual(profils.lireListe(f, fauxFs), { status: 'erreur', erreur: 'EACCES' });
    const nul = { readFileSync: () => { throw null; } }; // eslint-disable-line no-throw-literal
    assert.deepEqual(profils.lireListe(f, nul), { status: 'erreur', erreur: 'null' });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('lireProfils : fichier illisible -> statut + sauvegarde lisible ou null', () => {
  const d = dossierTemporaire();
  try {
    fs.writeFileSync(path.join(d, 'profils.json'), 'pas du json');
    const sans = profils.lireProfils(d, deps);
    assert.equal(sans.status, 'corrompu');
    assert.equal(sans.sauvegarde, null);
    fs.writeFileSync(path.join(d, 'profils.json.bak'), JSON.stringify(A));
    assert.deepEqual(profils.lireProfils(d, deps).sauvegarde, A);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
