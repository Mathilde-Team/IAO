'use strict';

// Issue #324 : logos des services d'IA (lib/service-icons.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LOGOS, iconeService } = require('../lib/service-icons.js');

const IDS_APP = [...fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8')
  .matchAll(/\{ id: '([a-z0-9-]+)', name: '[^']+', url:/g)].map(m => m[1]);

test('#324 : chaque service de l\'application a un logo valide ou l\'initiale de repli', () => {
  assert.ok(IDS_APP.length >= 20, 'liste des services introuvable : ' + IDS_APP.join(','));
  const sansLogo = IDS_APP.filter(id => !LOGOS[id]).sort();
  assert.deepEqual(sansLogo, ['elicit', 'leonardo'], 'seuls Leonardo AI et Elicit restent sans logo libre');
  for (const id of IDS_APP) {
    const html = iconeService(id, id);
    if (LOGOS[id]) assert.match(html, /^<span class="svc-ic[^"]*" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor" focusable="false"><path /, id);
    else assert.match(html, /svc-ic--lettre/, id);
  }
  assert.deepEqual(Object.keys(LOGOS).filter(id => !IDS_APP.includes(id)), [], 'logo sans service');
});

test('#324 : logo en couleurs officielles, monochrome, ou teinté par le service', () => {
  const claude = iconeService('claude', 'Claude');
  assert.match(claude, /^<span class="svc-ic" aria-hidden="true">/);
  assert.match(claude, /fill="#D97757" fill-rule="nonzero" clip-rule="nonzero"/);
  assert.match(iconeService('chatgpt', 'ChatGPT'), /^<span class="svc-ic svc-ic--mono" /);
  assert.match(iconeService('gemini', 'Gemini'), /^<span class="svc-ic svc-ic--mono svc-ic--teinte svc-fg-gemini" /);
  // Wolfram : tracé sans fill ni règle.
  assert.match(iconeService('wolfram', 'Wolfram Alpha'), /<path d="M20\.105[^"]*"\/>/);
});

test('#324 : repli sur l\'initiale échappée, sur la pastille du service', () => {
  assert.equal(iconeService('leonardo', 'Leonardo AI'),
    '<span class="svc-ic svc-ic--lettre svc-bg-leonardo" aria-hidden="true">L</span>');
  assert.equal(iconeService('elicit', '  elicit'),
    '<span class="svc-ic svc-ic--lettre svc-bg-elicit" aria-hidden="true">E</span>');
  assert.match(iconeService('x', '<b>'), />&lt;<\/span>$/);
  assert.match(iconeService('x', '"'), />&quot;<\/span>$/);
  assert.match(iconeService('x', '&'), />&amp;<\/span>$/);
  assert.match(iconeService('x', "'"), />&#39;<\/span>$/);
  assert.match(iconeService('x', '>'), />&gt;<\/span>$/);
  // Nom absent : initiale de l'identifiant ; nom vide après trim : « ? ».
  assert.match(iconeService('kimi'), />K<\/span>$/);
  assert.match(iconeService('kimi', '   '), />\?<\/span>$/);
});

test('#324 : identifiant invalide ou propriété héritée → repli neutre', () => {
  assert.equal(iconeService('a"b', 'Zut'),
    '<span class="svc-ic svc-ic--lettre svc-bg-inconnu" aria-hidden="true">Z</span>');
  assert.match(iconeService('', ''), /svc-bg-inconnu" aria-hidden="true">I<\/span>$/);
  assert.match(iconeService('constructor', 'C'), /svc-ic--lettre svc-bg-constructor/);
});

test('#324 : un tracé ou une boîte inattendus font refuser le logo entier', () => {
  const ok = { d: 'M0 0h24v24H0z' };
  const cas = {
    d: { vb: '0 0 24 24', p: [{ d: 'M0 0"/><script>' }] },
    dVide: { vb: '0 0 24 24', p: [{}] },
    nul: { vb: '0 0 24 24', p: [null] },
    f: { vb: '0 0 24 24', p: [{ ...ok, f: 'url(#x)' }] },
    o: { vb: '0 0 24 24', p: [{ ...ok, o: '1;x' }] },
    r: { vb: '0 0 24 24', p: [{ ...ok, r: 'inherit' }] },
    vb: { vb: '0 0 24 24"', p: [ok] },
    sansVb: { p: [ok] },
    vide: { vb: '0 0 24 24', p: [] },
    sansP: { vb: '0 0 24 24' },
    mixte: { vb: '0 0 24 24', p: [ok, { d: 'M<' }] }
  };
  for (const [id, logo] of Object.entries(cas)) {
    const sid = id.toLowerCase();
    const html = iconeService(sid, 'Nom', { [sid]: logo });
    assert.equal(html, '<span class="svc-ic svc-ic--lettre svc-bg-' + sid + '" aria-hidden="true">N</span>', id);
  }
});

test('#324 : registre personnalisé avec opacité et teinte', () => {
  const html = iconeService('demo', 'Demo', {
    demo: { vb: '0 0 16 16', mono: true, teinte: true, p: [{ d: 'M0 0h16v16H0z', f: 'red', o: '0.5', r: 'evenodd' }] }
  });
  assert.equal(html, '<span class="svc-ic svc-ic--mono svc-ic--teinte svc-fg-demo" aria-hidden="true">' +
    '<svg viewBox="0 0 16 16" fill="currentColor" focusable="false">' +
    '<path d="M0 0h16v16H0z" fill="red" fill-rule="evenodd" clip-rule="evenodd" opacity="0.5"/></svg></span>');
});

test('#324 : service-icons s\'attache à window dans le renderer', () => {
  const chemin = require.resolve('../lib/service-icons.js');
  const avant = global.window;
  global.window = {};
  try {
    delete require.cache[chemin];
    require(chemin);
    assert.equal(typeof global.window.iaoServiceIcons.iconeService, 'function');
  } finally {
    if (avant === undefined) delete global.window; else global.window = avant;
    delete require.cache[chemin];
  }
});
