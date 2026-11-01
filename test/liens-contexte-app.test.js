'use strict';

// Issue #362 : câblage du menu contextuel des liens dans assets/app.js et
// index.html, vérifié par analyse textuelle (même approche que les autres
// tests du front : le fichier n'est pas exécutable hors Electron).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('app.js branche le menu contextuel après dom-ready, avec repli sans webContents', () => {
  // L'écoute de « context-menu » n'a lieu qu'après dom-ready (getWebContents
  // fiable) et une seule fois par webview (le drapeau).
  assert.match(APP, /brancherMenuContextuel\(webview, \{ accId: acc\.id, svcId: svc\.id \}\)/);
  assert.match(APP, /brancherMenuContextuel\(webview, \{ accId: null, svcId: null \}\)/, 'onglet immuable aussi');
  assert.match(APP, /webview\.addEventListener\('dom-ready', \(\) => \{\s*\n\s*if \(webview\._menuLiens\) return;/);
  // Repli : sans webContents, un avertissement — jamais d'erreur bloquante.
  assert.match(APP, /try \{ contenu = webview\.getWebContents\(\); \} catch \(e\) \{ contenu = null; \}/);
  assert.match(APP, /console\.warn\('\[liens\] menu contextuel indisponible/);
});

test('app.js n’affiche le menu que sur un lien web, via les fonctions pures', () => {
  assert.match(APP, /const items = L\.construireItemsMenu\(params\.linkURL, nomNavigateurPourMenu\(\)\)/);
  assert.match(APP, /if \(!items\.length\) return; \/\/ lien non web : pas de menu/);
});

test('app.js ferme le menu sur clic extérieur, Échap et perte de focus', () => {
  assert.match(APP, /if \(e\.key === 'Escape'\) fermerMenuLiens\(\)/);
  assert.match(APP, /window\.addEventListener\('blur', fermerMenuLiens\)/);
  assert.match(APP, /if \(menuLiensOuvert && !menuLiensOuvert\.contains\(e\.target\)\) fermerMenuLiens\(\)/);
});

test('app.js route les cinq actions vers les IPC du main', () => {
  for (const canal of ['links:copier', 'links:ouvrir-fenetre', 'links:ouvrir-externe', 'links:ouvrir-externe-prive', 'links:navigateurs-detectes']) {
    assert.ok(APP.indexOf("ipcRenderer.invoke('" + canal) !== -1, canal);
  }
  // « Ouvrir dans un autre onglet » réutilise l'onglet du service, comme
  // l'ordonnanceur : openService puis loadURL sur la webview de l'onglet.
  assert.match(APP, /openService\(acc\.id, svc\.id\);\s*\n\s*const onglet = tabs\.find\(t => t\.accId === acc\.id && t\.svcId === svc\.id\)/);
  assert.match(APP, /wv\.loadURL\(url\)\.catch/);
});

test('app.js : le réglage navigateur externe est chargé, sauvé et affiché', () => {
  assert.match(APP, /settingsNavigateurExterne = settings\.navigateurExterne \|\| '';/);
  assert.match(APP, /await rafraichirNavigateursDetectes\(\);/);
  assert.match(APP, /remplirSelectNavigateurExterne\(settingsNavigateurExterne\);/);
  assert.match(APP, /navigateurExterne: \(document\.getElementById\('settingsExternalBrowser'\) \|\| \{ value: '' \}\)\.value/);
  // Libellés du menu passés par _() (i18n), jamais en dur côté app.js.
  assert.match(APP, /bouton\.textContent = _\(item\.cle, item\.params\);/);
});

test('index.html : script du module et réglage « navigateur des liens externes »', () => {
  assert.ok(HTML.indexOf('<script src="lib/liens-contexte.js"></script>') !== -1);
  assert.ok(HTML.indexOf('id="settingsExternalBrowser"') !== -1);
  // Le module expose ses fonctions pures au front (window.IaoLiens).
  assert.match(APP, /window\.IaoLiens/);
  assert.match(APP, /const L = window\.IaoLiens;/);
});

test('app.css : style du menu contextuel présent', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.css'), 'utf8');
  assert.ok(css.indexOf('.menu-liens {') !== -1);
  assert.ok(css.indexOf('.menu-liens__item') !== -1);
});

test('i18n : les libellés du menu et du réglage sont extraits', () => {
  const po = fs.readFileSync(path.join(__dirname, '..', 'lang', 'fr.po'), 'utf8');
  for (const cle of [
    "msgid \"Copier l'adresse du lien\"",
    'msgid "Ouvrir dans un autre onglet"',
    'msgid "Ouvrir dans une autre fenêtre"',
    'msgid "Ouvrir avec {navigateur}"',
    'msgid "Ouvrir avec {navigateur} en navigation privée"',
    'msgid "Adresse copiée"',
    'msgid "Lien ouvert dans un nouvel onglet"',
    'msgid "Lien ouvert dans une nouvelle fenêtre"',
    'msgid "Ouverture impossible : {erreur}"',
    'msgid "Ouverture externe impossible : {erreur}"',
    'msgid "Navigateur du système"'
  ]) {
    assert.ok(po.indexOf(cle) !== -1, cle);
  }
});
