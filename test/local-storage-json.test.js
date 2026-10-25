'use strict';

// Issues #52/#186 : un localStorage cassé (LevelDB « Database IO error ») ne doit
// JAMAIS faire mourir l'initialisation du renderer. lireStockageJSON renvoie un
// statut « erreur » au lieu de laisser remonter l'exception.

const test = require('node:test');
const assert = require('node:assert/strict');
const { lireStockageJSON } = require('../lib/local-storage-json');

// Storage factice : table mémoire simple.
function fakeStorage(entries) {
  const map = new Map(entries);
  return { getItem: (k) => (map.has(k) ? map.get(k) : null) };
}

test('lireStockageJSON : JSON valide -> statut ok et valeur analysée', () => {
  const r = lireStockageJSON(fakeStorage([['ai_accounts', '[{"id":"a1"}]']]), 'ai_accounts');
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.data, [{ id: 'a1' }]);
});

test('lireStockageJSON : clé absente -> statut empty (première utilisation)', () => {
  const r = lireStockageJSON(fakeStorage([]), 'ai_accounts');
  assert.deepEqual(r, { status: 'empty', data: null });
});

test('lireStockageJSON : JSON illisible -> statut corrupt (backup à proposer)', () => {
  const r = lireStockageJSON(fakeStorage([['ai_accounts', '{pas du tout du JSON']]), 'ai_accounts');
  assert.equal(r.status, 'corrupt');
  assert.equal(r.data, null);
  assert.ok(r.error instanceof Error);
});

test('lireStockageJSON : getItem qui LÈVE -> statut erreur, pas d\'exception (issues #52/#186)', () => {
  const storageCasse = {
    getItem: () => { throw new Error('Database IO error'); }
  };
  const r = lireStockageJSON(storageCasse, 'ai_accounts');
  assert.equal(r.status, 'erreur');
  assert.equal(r.data, null);
  assert.ok(r.error instanceof Error);
  // Le point clé : l'appel ne lève pas, le renderer peut continuer et
  // l'ordonnanceur proposer la restauration depuis son instantané.
  assert.doesNotThrow(() => lireStockageJSON(storageCasse, 'ai_accounts'));
});

test('lireStockageJSON : valeur null (présente mais null) -> empty, pas d\'exception', () => {
  const r = lireStockageJSON({ getItem: () => null }, 'cle');
  assert.deepEqual(r, { status: 'empty', data: null });
});

// Branche navigateur (patron activity-status.test.js) : exposer sur window
// et NE PAS exporter en CommonJS — couvre la ligne `typeof window` à 100 %.
const MODULE_PATH = require.resolve('../lib/local-storage-json.js');

test('en contexte navigateur, lireStockageJSON est exposée sur window, sans export CommonJS', () => {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const previous = globalThis.window;
  const fakeWindow = {};
  globalThis.window = fakeWindow;
  delete require.cache[MODULE_PATH];
  try {
    const exported = require(MODULE_PATH);
    assert.equal(typeof fakeWindow.lireStockageJSON, 'function',
      'lireStockageJSON doit être sur window');
    assert.deepEqual(Object.keys(exported), []);
  } finally {
    if (hadWindow) globalThis.window = previous; else delete globalThis.window;
    delete require.cache[MODULE_PATH];
    require(MODULE_PATH);
  }
});
