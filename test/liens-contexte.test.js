'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Issue #362 : fonctions pures de lib/liens-contexte.js (menu contextuel des
// liens, navigateur externe) + clé de réglage associée (lib/settings.js).
const L = require('../lib/liens-contexte.js');
const Settings = require('../lib/settings.js');

test('estUrlWeb : adresse non analysable par URL', () => {
  // new URL(...) lève : le catch renvoie false, pas d’exception au appelant.
  assert.equal(L.estUrlWeb('http://['), false);
  assert.equal(L.estUrlWeb('https://%zz'), false);
});

test('le module expose ses fonctions au navigateur (window.IaoLiens)', () => {
  globalThis.window = {};
  try {
    const chemin = require.resolve('../lib/liens-contexte.js');
    delete require.cache[chemin];
    const navig = require(chemin);
    assert.equal(globalThis.window.IaoLiens, navig);
  } finally {
    delete globalThis.window;
    const chemin = require.resolve('../lib/liens-contexte.js');
    delete require.cache[chemin];
  }
});

test('estUrlWeb n’accepte que http et https', () => {
  assert.equal(L.estUrlWeb('https://example.org'), true);
  assert.equal(L.estUrlWeb('http://example.org/a?b=c'), true);
  for (const nonWeb of ['', 'javascript:alert(1)', 'mailto:a@b.org', 'file:///etc', 'ftp://x', 'data:text/html,x', null, undefined, 42]) {
    assert.equal(L.estUrlWeb(nonWeb), false, JSON.stringify(nonWeb));
  }
});

test('construireItemsMenu ne propose rien hors lien web', () => {
  assert.deepEqual(L.construireItemsMenu('javascript:alert(1)', 'Chrome'), []);
  assert.deepEqual(L.construireItemsMenu('', null), []);
});

test('construireItemsMenu : cinq actions, ordre fixe, libellés i18n', () => {
  const items = L.construireItemsMenu('https://example.org/a', 'Google Chrome');
  assert.deepEqual(items.map((i) => i.id), ['copier', 'onglet', 'fenetre', 'navigateur', 'navigateur-prive']);
  assert.equal(items[0].cle, "Copier l'adresse du lien");
  assert.equal(items[2].cle, 'Ouvrir dans une autre fenêtre');
  assert.deepEqual(items[3].params, { navigateur: 'Google Chrome' });
  assert.equal(items[3].cle, 'Ouvrir avec {navigateur}');
  assert.equal(items[4].cle, 'Ouvrir avec {navigateur} en navigation privée');
});

test('construireItemsMenu : libellés génériques sans nom de navigateur', () => {
  const items = L.construireItemsMenu('https://example.org/a', null);
  assert.equal(items[3].cle, 'Ouvrir avec un navigateur externe');
  assert.equal(items[4].cle, 'Ouvrir avec un navigateur externe en navigation privée');
  assert.equal(items[3].params, undefined);
});

test('drapeauPrive : drapeau connu par navigateur, vide sinon', () => {
  assert.equal(L.drapeauPrive('chrome'), '--incognito');
  assert.equal(L.drapeauPrive('edge'), '--incognito');
  assert.equal(L.drapeauPrive('firefox'), '--private-window');
  assert.equal(L.drapeauPrive('opera'), '--private');
  assert.equal(L.drapeauPrive('safari'), '--private');
  assert.equal(L.drapeauPrive('navigateur-inconnu'), '');
  assert.equal(L.drapeauPrive(null), '');
});

test('construireLigneCommande : l’URL en dernier, drapeau privé d’abord', () => {
  const chrome = { id: 'chrome', nom: 'Chrome', commande: '/usr/bin/google-chrome' };
  assert.deepEqual(L.construireLigneCommande(chrome, 'https://a.org', false), {
    commande: '/usr/bin/google-chrome', args: ['https://a.org']
  });
  assert.deepEqual(L.construireLigneCommande(chrome, 'https://a.org', true), {
    commande: '/usr/bin/google-chrome', args: ['--incognito', 'https://a.org']
  });
  // Un navigateur sans drapeau connu : jamais de drapeau inventé.
  const autre = { id: 'x', nom: 'X', commande: '/usr/bin/x' };
  assert.deepEqual(L.construireLigneCommande(autre, 'https://a.org', true), {
    commande: '/usr/bin/x', args: ['https://a.org']
  });
});

test('choisirNavigateur : préférence, puis défaut système, puis premier', () => {
  const detectes = [
    { id: 'chrome', nom: 'Chrome', commande: 'c' },
    { id: 'firefox', nom: 'Firefox', commande: 'f' }
  ];
  assert.equal(L.choisirNavigateur(detectes, 'firefox', 'chrome').id, 'firefox');
  assert.equal(L.choisirNavigateur(detectes, '', 'chrome').id, 'chrome');
  assert.equal(L.choisirNavigateur(detectes, 'edge', 'chrome').id, 'chrome', 'préférence inconnue → défaut');
  assert.equal(L.choisirNavigateur([], 'chrome', 'chrome'), null);
  assert.equal(L.choisirNavigateur(null, '', ''), null);
  assert.equal(L.choisirNavigateur(detectes, '', null).id, 'chrome', 'premier détecté');
});

test('nomNavigateurChoisi : nom affiché ou null', () => {
  const detectes = [{ id: 'chrome', nom: 'Google Chrome', commande: 'c' }];
  assert.equal(L.nomNavigateurChoisi(detectes, 'chrome', null), 'Google Chrome');
  assert.equal(L.nomNavigateurChoisi(detectes, '', null), 'Google Chrome');
  assert.equal(L.nomNavigateurChoisi([], '', ''), null);
});

test('candidatsNavigateurs : par plateforme, chemins candidats stables', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    const c = L.candidatsNavigateurs(p);
    assert.ok(Array.isArray(c) && c.length >= 5, p);
    for (const candidat of c) {
      assert.equal(typeof candidat.id, 'string');
      assert.equal(typeof candidat.nom, 'string');
      assert.ok(Array.isArray(candidat.chemins) && candidat.chemins.length > 0);
    }
  }
  // Windows : chemins avec variables d’environnement à développer par le main.
  assert.ok(L.candidatsNavigateurs('win32').some((c) => c.chemins.some((x) => x.indexOf('%') !== -1)));
  // Linux : candidats absolus classiques.
  assert.ok(L.candidatsNavigateurs('linux').some((c) => c.chemins.includes('/usr/bin/firefox')));
});

test('detecterNavigateurs : ne garde que ce qui existe, ignore les entrées vides', () => {
  const candidats = [
    { id: 'chrome', nom: 'Chrome', chemins: ['/a', '/b'] },
    { id: 'firefox', nom: 'Firefox', chemins: ['/c'] },
    { id: '', nom: 'vide', chemins: ['/d'] },
    null
  ];
  const detectes = L.detecterNavigateurs(candidats, (p) => p === '/b' || p === '/d');
  assert.deepEqual(detectes, [{ id: 'chrome', nom: 'Chrome', commande: '/b' }]);
  assert.deepEqual(L.detecterNavigateurs(null, () => true), []);
});

test('detecterNavigateurs : candidat sans liste de chemins ignoré sans erreur', () => {
  const detectes = L.detecterNavigateurs(
    [{ id: 'chrome', nom: 'Chrome' }, { id: 'firefox', nom: 'Firefox', chemins: 'pas une liste' }],
    () => true
  );
  assert.deepEqual(detectes, []);
});

test('detecterNavigateurs : candidat sans nom affiche son id', () => {
  const detectes = L.detecterNavigateurs([{ id: 'chrome', chemins: ['/usr/bin/chrome'] }], () => true);
  assert.deepEqual(detectes, [{ id: 'chrome', nom: 'chrome', commande: '/usr/bin/chrome' }]);
});

test('correspondDefautSysteme : rapproche nom système et candidat', () => {
  const chrome = { id: 'chrome', nom: 'Google Chrome' };
  assert.equal(L.correspondDefautSysteme('Google Chrome', chrome), true);
  assert.equal(L.correspondDefautSysteme('google-chrome.desktop', chrome), true);
  assert.equal(L.correspondDefautSysteme('Firefox', chrome), false);
  assert.equal(L.correspondDefautSysteme('', chrome), false);
  assert.equal(L.correspondDefautSysteme('Chrome', null), false);
  // Candidat sans nom : le rapprochement se fait sur l'id.
  assert.equal(L.correspondDefautSysteme('chrome', { id: 'chrome', nom: '' }), true);
  // Candidat sans id : le rapprochement se fait sur le nom.
  assert.equal(L.correspondDefautSysteme('la X navigateur', { id: '', nom: 'X' }), true);
  // Aucun des deux ne correspond.
  assert.equal(L.correspondDefautSysteme('Chrome', { id: 'edge', nom: 'Edge' }), false);
});

test('settings : clé navigateurExterne, normalisée', () => {
  assert.equal(Settings.normalizeSettings({}).navigateurExterne, '');
  assert.equal(Settings.normalizeSettings({ navigateurExterne: 'FIREFOX ' }).navigateurExterne, 'firefox');
  assert.equal(Settings.normalizeSettings({ navigateurExterne: 12 }).navigateurExterne, '');
  assert.equal(Settings.normalizeSettings({ navigateurExterne: 'edge' }).navigateurExterne, 'edge');
});
