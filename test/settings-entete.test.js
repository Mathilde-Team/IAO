'use strict';

// Issue #376 : la fenêtre Réglages doit avoir une barre d'entête et une
// croix de fermeture en haut à droite. Vérifications statiques sur
// index.html (structure) et assets/app.css (habillage), dans l'esprit de
// test/theme-panels.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.css'), 'utf-8');

// La fenêtre Réglages est la modale #settingsModal : on n'isole que son
// fragment pour ne pas confondre avec les autres modales.
function blocSettingsModal() {
  const debut = html.indexOf('<div class="modal-overlay" id="settingsModal">');
  assert.ok(debut >= 0, 'modale #settingsModal introuvable dans index.html');
  const fin = html.indexOf('<!-- Modal mot de passe de la sauvegarde', debut);
  assert.ok(fin > debut, 'fin de la modale #settingsModal introuvable');
  return html.slice(debut, fin);
}

test('#376 : entête de la modale Réglages avec titre et sous-titre', () => {
  const bloc = blocSettingsModal();
  assert.match(bloc, /<div class="modal__header">/, '.modal__header manquant');
  assert.match(bloc, /<div class="modal__header-text">/, '.modal__header-text manquant');
  assert.match(bloc, /<div class="modal__title">Réglages<\/div>/, 'titre « Réglages » manquant dans l’entête');
  assert.match(bloc, /<div class="modal__subtitle">/, 'sous-titre manquant dans l’entête');
});

test('#376 : croix de fermeture en haut à droite de l’entête', () => {
  const bloc = blocSettingsModal();
  // La croix est dans l'entête, après le bloc de texte (haut à droite),
  // réutilise l'action existante ui-closeSettingsModal (délégation
  // UI_ACTIONS, invariant 2 du CLAUDE.md : aucun onclick généré).
  const header = bloc.slice(bloc.indexOf('<div class="modal__header">'), bloc.indexOf('</div>\n\n    <div class="settings-body">'));
  assert.ok(header, 'entête vide ou introuvable');
  assert.match(header, /class="btn btn--icon modal__close"/, 'bouton .modal__close manquant dans l’entête');
  assert.match(header, /data-action="ui-closeSettingsModal"/, 'la croix doit déclencher ui-closeSettingsModal');
  assert.match(header, /data-icon="times-circle"/, 'icône times-circle manquante sur la croix');
  // La croix vient après le texte de l'entête : en flex space-between,
  // elle s'affiche donc à droite.
  assert.ok(
    header.indexOf('modal__header-text') < header.indexOf('modal__close'),
    'la croix doit suivre le texte de l’entête (position haute à droite)'
  );
});

test('#376 : habillage CSS de l’entête et de la croix', () => {
  function rule(selector) {
    const m = new RegExp('\\n\\s*' + selector.replace('.', '\\.') + '\\s*\\{([^}]*)\\}').exec(css);
    assert.ok(m, 'règle introuvable : ' + selector);
    return m[1];
  }
  const header = rule('.modal__header');
  assert.match(header, /display:\s*flex/, '.modal__header doit être en flex');
  assert.match(header, /justify-content:\s*space-between/, '.modal__header doit pousser la croix à droite');
  assert.match(header, /border-bottom:\s*1px solid var\(--border\)/, 'barre de séparation sous l’entête manquante');
  assert.match(rule('.modal__close'), /flex:\s*none/, '.modal__close ne doit pas rétrécir');
});
