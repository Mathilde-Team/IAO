'use strict';

// Issue #331 : lib/preferences.js (fichier) et lib/magasin-preferences.js
// (magasin côté renderer, migration depuis le localStorage).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const prefs = require('../lib/preferences');
const { creerMagasinPreferences, versValeur, versTexte } = require('../lib/magasin-preferences');

function dossierTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iao-prefs-'));
}
const deps = { fs, path };

test('#331 lirePreferences : absent, ok (clés inconnues ignorées), corrompu, pas un objet', () => {
  const d = dossierTemp();
  try {
    assert.deepEqual(prefs.lirePreferences(d, deps), { status: 'absent' });
    fs.writeFileSync(path.join(d, prefs.NOM_FICHIER), JSON.stringify({ ide_w: '300px', inconnue: 1 }));
    assert.deepEqual(prefs.lirePreferences(d, deps), { status: 'ok', preferences: { ide_w: '300px' } });
    fs.writeFileSync(path.join(d, prefs.NOM_FICHIER), '{tronqué');
    assert.equal(prefs.lirePreferences(d, deps).status, 'corrompu');
    fs.writeFileSync(path.join(d, prefs.NOM_FICHIER), '[1]');
    assert.deepEqual(prefs.lirePreferences(d, deps), { status: 'corrompu', erreur: 'un objet de préférences est attendu' });
    fs.writeFileSync(path.join(d, prefs.NOM_FICHIER), 'null');
    assert.equal(prefs.lirePreferences(d, deps).status, 'corrompu');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('#331 lirePreferences : erreur de lecture autre que ENOENT', () => {
  const fauxFs = { readFileSync: () => { throw Object.assign(new Error('EACCES refusé'), { code: 'EACCES' }); } };
  assert.deepEqual(prefs.lirePreferences('/x', { fs: fauxFs, path }), { status: 'erreur', erreur: 'EACCES refusé' });
  const sansMessage = { readFileSync: () => { throw 'brut'; } }; // eslint-disable-line no-throw-literal
  assert.deepEqual(prefs.lirePreferences('/x', { fs: sansMessage, path }), { status: 'erreur', erreur: 'brut' });
  const nul = { readFileSync: () => { throw null; } }; // eslint-disable-line no-throw-literal
  assert.deepEqual(prefs.lirePreferences('/x', { fs: nul, path }), { status: 'erreur', erreur: 'null' });
});

test('#331 lireAvecCles : joint la liste des clés gérées', () => {
  const d = dossierTemp();
  try {
    const r = prefs.lireAvecCles(d, deps);
    assert.deepEqual(r, { cles: prefs.CLES.slice(), status: 'absent' });
    r.cles.push('x');
    assert.equal(prefs.CLES.includes('x'), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('#331 ecrirePreferences : filtre, écrit atomiquement, met de côté un fichier illisible', () => {
  const d = path.join(dossierTemp(), 'sous');
  try {
    assert.deepEqual(prefs.ecrirePreferences(d, { ide_w: '1px', autre: 2, explorer_w: undefined }, deps), { ok: true, cles: 1 });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, prefs.NOM_FICHIER), 'utf-8')), { ide_w: '1px' });
    assert.equal(fs.existsSync(path.join(d, prefs.NOM_FICHIER + '.tmp')), false);
    assert.equal(fs.existsSync(path.join(d, prefs.NOM_ILLISIBLE)), false);
    fs.writeFileSync(path.join(d, prefs.NOM_FICHIER), '{tronqué');
    assert.deepEqual(prefs.ecrirePreferences(d, { ai_account_order: ['a'] }, deps), { ok: true, cles: 1 });
    assert.equal(fs.readFileSync(path.join(d, prefs.NOM_ILLISIBLE), 'utf-8'), '{tronqué');
  } finally { fs.rmSync(path.dirname(d), { recursive: true, force: true }); }
});

test('#331 ecrirePreferences : refus d\'autre chose qu\'un objet, échec disque rapporté', () => {
  assert.deepEqual(prefs.ecrirePreferences('/x', null, deps), { ok: false, erreur: 'un objet de préférences est attendu' });
  assert.equal(prefs.ecrirePreferences('/x', [], deps).ok, false);
  const fauxFs = { mkdirSync: () => { throw new Error('disque plein'); } };
  assert.deepEqual(prefs.ecrirePreferences('/x', {}, { fs: fauxFs, path }), { ok: false, erreur: 'disque plein' });
});

function faux(lecture, ecritureOk) {
  const ecrits = [];
  const journal = { debug: [], error: [] };
  const local = new Map();
  return {
    ecrits, journal, local,
    api: { lire: () => lecture, ecrire: (p) => { ecrits.push(JSON.parse(JSON.stringify(p))); return ecritureOk === null ? null : { ok: ecritureOk, erreur: 'refus' }; } },
    stockage: {
      getItem: (k) => (local.has(k) ? local.get(k) : null),
      removeItem: (k) => local.delete(k)
    },
    console: { debug: (m) => journal.debug.push(m), error: (m) => journal.error.push(m) }
  };
}

test('#331 versValeur / versTexte : JSON rangé tel quel, autre chaîne gardée', () => {
  assert.deepEqual(versValeur('["a"]'), ['a']);
  assert.equal(versValeur('420px'), '420px');
  assert.equal(versTexte('420px'), '420px');
  assert.equal(versTexte(['a']), '["a"]');
});

test('#331 magasin : fichier lu, getItem/setItem/removeItem écrivent le fichier', () => {
  const f = faux({ status: 'ok', cles: ['ide_w', 'ai_account_order'], preferences: { ide_w: '300px' } }, true);
  const m = creerMagasinPreferences(f.api, f.stockage, f.console);
  assert.equal(f.ecrits.length, 0);
  assert.equal(m.getItem('ide_w'), '300px');
  assert.equal(m.getItem('ai_account_order'), null);
  m.setItem('ai_account_order', JSON.stringify(['b', 'a']));
  assert.deepEqual(f.ecrits.pop(), { ide_w: '300px', ai_account_order: ['b', 'a'] });
  assert.equal(m.getItem('ai_account_order'), '["b","a"]');
  m.removeItem('ide_w');
  assert.deepEqual(f.ecrits.pop(), { ai_account_order: ['b', 'a'] });
  assert.match(f.journal.debug[0], /1 clé/);
});

test('#331 magasin : migration unique depuis le localStorage, clés retirées après écriture', () => {
  const f = faux({ status: 'absent', cles: ['ai_starred_tabs', 'ide_w', 'explorer_w'] }, true);
  f.local.set('ai_starred_tabs', '["a|b"]');
  f.local.set('ide_w', '420px');
  f.local.set('ai_open_tabs', '[]');
  const m = creerMagasinPreferences(f.api, f.stockage, f.console);
  assert.deepEqual(f.ecrits, [{ ai_starred_tabs: ['a|b'], ide_w: '420px' }]);
  assert.deepEqual([...f.local.keys()], ['ai_open_tabs']);
  assert.equal(m.getItem('ide_w'), '420px');
  assert.match(f.journal.debug.join('\n'), /migration depuis le localStorage : 2 clé/);
});

test('#331 magasin : écriture de migration refusée -> localStorage gardé, erreur journalisée', () => {
  const f = faux({ status: 'absent', cles: ['ide_w'] }, false);
  f.local.set('ide_w', '420px');
  const m = creerMagasinPreferences(f.api, f.stockage, f.console);
  assert.equal(f.local.get('ide_w'), '420px');
  assert.equal(m.getItem('ide_w'), '420px');
  assert.match(f.journal.error[0], /écriture impossible : refus/);
  const g = faux({ status: 'absent', cles: ['ide_w'] }, null);
  creerMagasinPreferences(g.api, g.stockage, g.console);
  assert.match(g.journal.error[0], /écriture impossible : null/);
});

test('#331 magasin : fichier illisible ou réponse vide -> valeurs par défaut, erreur journalisée', () => {
  const f = faux({ status: 'corrompu', erreur: 'JSON', cles: 'pas une liste' }, true);
  const m = creerMagasinPreferences(f.api, f.stockage, f.console);
  assert.equal(m.getItem('ide_w'), null);
  assert.match(f.journal.error[0], /illisible, valeurs par défaut : JSON/);
  const g = faux(undefined, true);
  creerMagasinPreferences(g.api, g.stockage, g.console);
  assert.match(g.journal.error[0], /undefined/);
});

test('#331 magasin chargé par <script> : exposé sur window (branche navigateur)', () => {
  const chemin = require.resolve('../lib/magasin-preferences');
  const origine = global.window;
  delete require.cache[chemin];
  global.window = {};
  try {
    require(chemin);
    assert.equal(typeof global.window.creerMagasinPreferences, 'function');
  } finally {
    global.window = origine;
    delete require.cache[chemin];
  }
});
