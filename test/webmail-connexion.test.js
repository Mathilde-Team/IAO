'use strict';

// Issue #310 : webmail ouvert dans la partition du compte et connecté avec
// l'adresse et le mot de passe du coffre (lib/webmail-connexion.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const { compteValide, scriptConnexion, creerOuvreurWebmail, EMAIL_MAX } = require('../lib/webmail-connexion');

test('compteValide : profil obligatoire, adresse facultative, rien d\'autre', () => {
  assert.equal(compteValide(null), null);
  assert.equal(compteValide('docker1'), null);
  assert.equal(compteValide({ profil: 12 }), null);
  assert.equal(compteValide({ profil: '../x' }), null);
  assert.equal(compteValide({ profil: '' }), null);
  assert.deepEqual(compteValide({ profil: 'p1', email: 7 }), { profil: 'p1', email: '' });
  assert.deepEqual(compteValide({ profil: 'p1', email: '  a@b.fr ', url: 'https://evil' }),
    { profil: 'p1', email: 'a@b.fr' });
  assert.equal(compteValide({ profil: 'p1', email: 'a'.repeat(EMAIL_MAX + 1) }), null);
  assert.equal(compteValide({ profil: 'p1', email: 'a@b.fr\nX' }), null);
});

// Page Roundcube simulée : champs, bouton, formulaire, événements reçus.
function page({ user = true, pass = true, bouton = true, requestSubmit = true } = {}) {
  const trace = [];
  const formulaire = { submit: () => trace.push('submit') };
  if (requestSubmit) formulaire.requestSubmit = () => trace.push('requestSubmit');
  const champ = (nom) => ({
    value: '', form: formulaire,
    dispatchEvent: (ev) => trace.push(nom + ':' + ev.type)
  });
  const champs = {
    '#rcmloginuser, input[name="_user"]': user ? champ('user') : null,
    '#rcmloginpwd, input[name="_pass"]': pass ? champ('pass') : null,
    '#rcmloginsubmit': bouton ? { click: () => trace.push('click') } : null
  };
  const document = { querySelector: (s) => champs[s] || null };
  class Event { constructor(type, init) { this.type = type; this.init = init; } }
  return { trace, champs, ctx: vm.createContext({ document, Event }) };
}
const executer = (p, script) => vm.runInContext(script, p.ctx);

test('scriptConnexion : remplit et valide le formulaire Roundcube', () => {
  const p = page();
  assert.equal(executer(p, scriptConnexion('a@b.fr', 'mdp"\'`${x}')), 'soumis');
  assert.equal(p.champs['#rcmloginuser, input[name="_user"]'].value, 'a@b.fr');
  assert.equal(p.champs['#rcmloginpwd, input[name="_pass"]'].value, 'mdp"\'`${x}'); // aucune injection
  assert.deepEqual(p.trace, ['user:input', 'user:change', 'pass:input', 'pass:change', 'click']);
});

test('scriptConnexion : sans bouton, requestSubmit puis submit', () => {
  const p = page({ bouton: false });
  assert.equal(executer(p, scriptConnexion('a@b.fr', 'x')), 'soumis');
  assert.equal(p.trace.at(-1), 'requestSubmit');
  const q = page({ bouton: false, requestSubmit: false });
  assert.equal(executer(q, scriptConnexion('a@b.fr', 'x')), 'soumis');
  assert.equal(q.trace.at(-1), 'submit');
});

test('scriptConnexion : pas de formulaire, pas de mot de passe', () => {
  assert.equal(executer(page({ user: false }), scriptConnexion('a@b.fr', 'x')), 'absent');
  const p = page();
  assert.equal(executer(p, scriptConnexion('', null)), 'adresse');
  assert.equal(p.champs['#rcmloginuser, input[name="_user"]'].value, '');
  assert.equal(p.champs['#rcmloginpwd, input[name="_pass"]'].value, '');
  assert.equal(executer(page({ pass: false }), scriptConnexion('a@b.fr', 'x')), 'adresse');
});

// Doublure de BrowserWindow : options, URL chargée, écouteurs, script exécuté.
function doublure({ resultat = Promise.resolve('soumis') } = {}) {
  const fenetres = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.detruite = false;
      this.focus = () => { this.focalisee = (this.focalisee || 0) + 1; };
      this.isDestroyed = () => this.detruite;
      this.loadURL = (u) => { this.charge = u; this.url = u; };
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (fn) => { this.webContents.popup = fn; };
      this.webContents.getURL = () => this.url;
      this.webContents.scripts = [];
      this.webContents.executeJavaScript = (s) => {
        this.webContents.scripts.push(s);
        return typeof resultat === 'function' ? resultat() : resultat;
      };
      fenetres.push(this);
    }
  }
  return { BrowserWindow, fenetres };
}
const attendre = () => new Promise((r) => setImmediate(r));

test('ouvrir : fenêtre sans privilèges dans la partition du compte, une tentative', async () => {
  const d = doublure();
  const journal = [];
  const traces = [];
  const ouvrir = creerOuvreurWebmail({
    BrowserWindow: d.BrowserWindow,
    journal: (n, m) => journal.push(n + ' ' + m),
    debug: (m) => traces.push(m)
  });
  const win = ouvrir({ url: 'https://mail.dmathilde.fr/', profil: 'p1', email: 'a@b.fr', motDePasse: 's3cret' });
  assert.deepEqual(win.options.webPreferences,
    { partition: 'persist:p1', nodeIntegration: false, contextIsolation: true, sandbox: true });
  assert.equal(win.charge, 'https://mail.dmathilde.fr/');
  assert.deepEqual(win.webContents.popup({ url: 'https://mail.dmathilde.fr/piece' }), { action: 'allow' });
  assert.deepEqual(win.webContents.popup({ url: 'javascript:alert(1)' }), { action: 'deny' });
  // Page d'un autre hôte (SSO, redirection) : rien n'est rempli.
  win.url = 'https://ailleurs.example/login';
  win.webContents.emit('did-finish-load');
  win.url = 'pas une url';
  win.webContents.emit('did-finish-load');
  assert.equal(win.webContents.scripts.length, 0);
  win.url = 'https://mail.dmathilde.fr/?_task=login';
  win.webContents.emit('did-finish-load');
  win.webContents.emit('did-finish-load'); // page suivante : pas de seconde tentative
  await attendre();
  assert.equal(win.webContents.scripts.length, 1);
  assert.match(win.webContents.scripts[0], /"s3cret"/);
  assert.deepEqual(journal, ['info Webmail : connexion « soumis » pour « p1 ».']);
  assert.ok(journal.concat(traces).every((l) => !l.includes('s3cret')), 'mot de passe jamais journalisé');
  assert.match(traces[0], /mot de passe présent/);
  // Second clic : même fenêtre ramenée au premier plan.
  assert.equal(ouvrir({ url: 'https://mail.dmathilde.fr/', profil: 'p1', email: 'a@b.fr' }), win);
  assert.equal(win.focalisee, 1);
  // Fenêtre détruite ou fermée : une nouvelle est créée.
  win.detruite = true;
  const autre = ouvrir({ url: 'https://mail.dmathilde.fr/', profil: 'p1', email: 'a@b.fr' });
  assert.notEqual(autre, win);
  autre.emit('closed');
  assert.notEqual(ouvrir({ url: 'https://mail.dmathilde.fr/', profil: 'p1' }), autre);
  assert.equal(d.fenetres.length, 3);
  assert.match(traces.at(-2), /mot de passe absent/);
});

test('ouvrir : échec du remplissage journalisé, journal muet par défaut', async () => {
  const echecs = [new Error('page fermée'), 'brut', null];
  const d = doublure({ resultat: () => Promise.reject(echecs.shift()) });
  const journal = [];
  const ouvrir = creerOuvreurWebmail({ BrowserWindow: d.BrowserWindow, journal: (n, m) => journal.push(n + ' ' + m) });
  for (const profil of ['a', 'b', 'c']) {
    const w = ouvrir({ url: 'https://m.fr/', profil, email: '', motDePasse: '' });
    w.webContents.emit('did-finish-load');
  }
  await attendre();
  assert.deepEqual(journal, [
    'warning Webmail : remplissage impossible pour « a » (page fermée).',
    'warning Webmail : remplissage impossible pour « b » (brut).',
    'warning Webmail : remplissage impossible pour « c » (null).'
  ]);
  const muet = creerOuvreurWebmail({ BrowserWindow: doublure().BrowserWindow });
  const w = muet({ url: 'https://m.fr/', profil: 'p', email: 'x@m.fr', motDePasse: 'y' });
  w.webContents.emit('did-finish-load');
  await attendre();
  assert.equal(w.webContents.scripts.length, 1);
});
