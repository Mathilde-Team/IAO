'use strict';

// Issue #364 : boutons précédent / suivant dans la barre d'onglet, à côté
// des boutons accueil et recharger. Câblage vérifié par analyse textuelle
// (même approche que les autres tests du front : assets/app.js n'est pas
// exécutable hors Electron).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.css'), 'utf8');
const PO_FR = fs.readFileSync(path.join(__dirname, '..', 'lang', 'fr.po'), 'utf8');

test('app.js place les boutons précédent / suivi avant le bouton recharger', () => {
  // Deux boutons dédiés, avec les chevrons, désactivés à l'ouverture (état
  // par défaut : pas encore d'historique).
  assert.match(APP, /data-action="tab-back"[^>]*title="\$\{escapeHtml\(_\('Page précédente'\)\)\}"[^>]*disabled><span class="ic" data-icon="chevron-left"><\/span>/);
  assert.match(APP, /data-action="tab-forward"[^>]*title="\$\{escapeHtml\(_\('Page suivante'\)\)\}"[^>]*disabled><span class="ic" data-icon="chevron-right"><\/span>/);
  // Ordre dans la barre : précédent, suivant, puis recharger.
  const posBack = APP.indexOf('data-action="tab-back"');
  const posForward = APP.indexOf('data-action="tab-forward"');
  const posReload = APP.indexOf('data-action="tab-reload"');
  assert.ok(posBack !== -1 && posForward !== -1 && posReload !== -1);
  assert.ok(posBack < posForward && posForward < posReload, 'ordre précédent, suivant, recharger');
});

test('app.js actualise l\'état des boutons à chaque navigation', () => {
  // La source de vérité est le webview : canGoBack / canGoForward.
  assert.match(APP, /function majBoutonsHistorique\(tabId\) \{/);
  assert.match(APP, /webview\.canGoBack\(\)/);
  assert.match(APP, /webview\.canGoForward\(\)/);
  assert.match(APP, /btnPrecedent\.disabled = !peutReculer;/);
  assert.match(APP, /btnSuivant\.disabled = !peutAvancer;/);
  // Écoutes : première charge, navigation principale et navigation en page
  // (ancres, applications monopage).
  assert.match(APP, /function brancherHistoriqueNavigation\(webview, tabId\) \{/);
  assert.match(APP, /webview\.addEventListener\('dom-ready', \(\) => majBoutonsHistorique\(tabId\)\);/);
  assert.match(APP, /webview\.addEventListener\('did-navigate', \(\) => majBoutonsHistorique\(tabId\)\);/);
  assert.match(APP, /webview\.addEventListener\('did-navigate-in-page', \(\) => majBoutonsHistorique\(tabId\)\);/);
  // Branché à l'ouverture de chaque onglet.
  assert.match(APP, /brancherHistoriqueNavigation\(webview, tabId\); \/\/ issue #364/);
});

test('app.js route les clics vers goBack / goForward via la délégation', () => {
  assert.match(APP, /else if \(action === 'tab-back'\) tabGoBack\(tabId\);/);
  assert.match(APP, /else if \(action === 'tab-forward'\) tabGoForward\(tabId\);/);
  assert.match(APP, /function tabGoBack\(tabId\) \{/);
  assert.match(APP, /if \(webview && webview\.canGoBack && webview\.canGoBack\(\)\) webview\.goBack\(\);/);
  assert.match(APP, /function tabGoForward\(tabId\) \{/);
  assert.match(APP, /if \(webview && webview\.canGoForward && webview\.canGoForward\(\)\) webview\.goForward\(\);/);
});

test('app.css marque visuellement les boutons désactivés', () => {
  assert.match(CSS, /\.tab-toolbar__btn:disabled \{ opacity: \.45; cursor: default;/);
});

test('les deux nouveaux libellés sont dans le catalogue français', () => {
  assert.ok(PO_FR.indexOf('msgid "Page précédente"') !== -1);
  assert.ok(PO_FR.indexOf('msgid "Page suivante"') !== -1);
});
