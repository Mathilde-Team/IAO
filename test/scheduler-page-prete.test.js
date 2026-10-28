'use strict';

// Issue #320 : l'ordonnanceur ouvre l'onglet Claude mais n'écrit rien.
// Couverture de scheduler/index.js : suivi du chargement (registerWebview),
// webview Claude du profil (_webviewClaude), attente de page prête
// (_attendrePagePrete), popups persistantes et échec d'écriture journalisé.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');

const { Scheduler } = require('../scheduler/index');
const adapter = require('../lib/claude-adapter');

const DETECT = adapter.buildClaudeDetectionScript();
const DISMISS = adapter.buildPopupDismissScript();

function creer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-320-'));
  const s = new Scheduler({ getPath: () => dir }, {});
  s.quietHoursCheck = () => false;
  s.config.minDelayMs = 0;
  s.config.maxDelayMs = 0;
  // Horloge simulée : chaque attente avance le temps.
  s.__t = 1000;
  s.__attentes = [];
  s._maintenant = () => s.__t;
  s._attendre = async (ms) => { s.__attentes.push(ms); s.__t += ms; if (s.__onAttente) s.__onAttente(s); };
  return s;
}
function nettoyer(s) { fs.rmSync(s.dir, { recursive: true, force: true }); }
function journal(s) { return s.log.map(l => l.message); }

function webview(url, extra) {
  const wc = new EventEmitter();
  wc.getURL = () => url;
  wc.scripts = [];
  wc.executeJavaScript = async (script) => {
    wc.scripts.push(script);
    if (script === DETECT) return JSON.stringify(wc.detection || { chatInput: { found: true }, popups: { count: 0 }, quotaMessage: { detected: false } });
    if (script === DISMISS) return JSON.stringify({ ok: true, dismissed: 0 });
    return wc.injection === undefined ? JSON.stringify({ ok: true, method: 'send_button' }) : wc.injection;
  };
  return Object.assign(wc, extra || {});
}

test('registerWebview suit le chargement des onglets ouverts par IAO', () => {
  const s = creer();
  const wc = webview('https://claude.ai/new');
  s.registerWebview('p1', wc, { suivreChargement: true });
  s.registerWebview('p1', wc, { suivreChargement: true }); // pas de doublon
  assert.equal(s._webviewsProfil.get('p1').length, 1);
  const etat = s._chargements.get(wc);
  assert.deepEqual(etat, { ouvertLe: 1000, enChargement: true, chargeLe: 0 });
  s.__t = 5000; wc.emit('did-stop-loading');
  assert.equal(etat.enChargement, false);
  assert.equal(etat.chargeLe, 5000);
  wc.emit('did-start-loading');
  assert.equal(etat.enChargement, true);
  // Sans option ou sans .on : pas de suivi ; arguments manquants : ignoré.
  const brut = { executeJavaScript: async () => '{}' };
  s.registerWebview('p2', brut, { suivreChargement: true });
  s.registerWebview('p3', webview(''));
  s.registerWebview('', wc);
  s.registerWebview('p4', null);
  assert.equal(s._chargements.get(brut), undefined);
  assert.ok(!s._openWebviews.has('p4'));
  nettoyer(s);
});

test('unregisterWebview n\'oublie que l\'onglet fermé', () => {
  const s = creer();
  const claude = webview('https://claude.ai/chat/1');
  const gpt = webview('https://chatgpt.com/');
  s.registerWebview('p1', claude);
  s.registerWebview('p1', gpt);
  s.unregisterWebview('p1', claude); // pas la courante : la courante reste
  assert.equal(s._openWebviews.get('p1'), gpt);
  s.registerWebview('p1', claude);
  s.unregisterWebview('p1', claude); // la courante : repli sur l'autre onglet
  assert.equal(s._openWebviews.get('p1'), gpt);
  s.unregisterWebview('p1', gpt);
  assert.ok(!s._openWebviews.has('p1'));
  assert.ok(!s._webviewsProfil.has('p1'));
  s.unregisterWebview('inconnu', gpt); // profil inconnu : sans effet
  s.registerWebview('p2', gpt);
  s.unregisterWebview('p2'); // sans webContents : tout le profil
  assert.ok(!s._openWebviews.has('p2'));
  assert.ok(!s._webviewsProfil.has('p2'));
  nettoyer(s);
});

test('_webviewClaude préfère l\'onglet claude.ai du profil', () => {
  const s = creer();
  const claude = webview('https://claude.ai/new');
  const gpt = webview('https://chatgpt.com/');
  const casse = webview(''); casse.getURL = () => { throw new Error('détruite'); };
  const sansUrl = webview(''); delete sansUrl.getURL;
  const vide = webview(''); vide.getURL = () => null;
  s.registerWebview('p1', claude);
  s.registerWebview('p1', gpt);
  s.registerWebview('p1', casse);
  s.registerWebview('p1', sansUrl);
  s.registerWebview('p1', vide);
  assert.equal(s._webviewClaude('p1'), claude);
  s.unregisterWebview('p1', claude);
  assert.equal(s._webviewClaude('p1'), vide, 'aucun onglet Claude : la dernière enregistrée');
  assert.equal(s._webviewClaude('absent'), undefined);
  nettoyer(s);
});

test('_attendrePagePrete : 30 s après l\'ouverture, page chargée et stable', async () => {
  const s = creer();
  const wc = webview('https://claude.ai/new');
  assert.deepEqual(await s._attendrePagePrete('p1', wc), { attenteMs: 0 }, 'page non suivie : aucune attente');
  s.registerWebview('p1', wc, { suivreChargement: true });
  s.__onAttente = (sc) => { if (sc.__t >= 3000 && s._chargements.get(wc).enChargement) wc.emit('did-stop-loading'); };
  const r = await s._attendrePagePrete('p1', wc);
  assert.equal(r.attenteMs, 30000);
  assert.equal(journal(s).filter(m => m.includes('Attente du chargement')).length, 1);
  // Déjà prête : pas d'attente.
  assert.deepEqual(await s._attendrePagePrete('p1', wc), { attenteMs: 0 });
  nettoyer(s);
});

test('_attendrePagePrete : réglages et délai maximal', async () => {
  const s = creer();
  s.config.pageOuvertureMs = 0;
  s.config.pageStabiliteMs = 0;
  s.config.pageAttenteMaxMs = 2000;
  const wc = webview('https://claude.ai/new');
  s.registerWebview('p1', wc, { suivreChargement: true }); // reste en chargement
  const r = await s._attendrePagePrete('p1', wc);
  assert.equal(r.attenteMs, 2000);
  assert.ok(journal(s).some(m => m.includes('toujours en chargement après 2 s')));
  nettoyer(s);
});

test('runClaudeJob attend la page puis écrit dans l\'onglet Claude du profil', async () => {
  const s = creer();
  s.config.pageOuvertureMs = 1000;
  const claude = webview('https://claude.ai/new');
  const gpt = webview('https://chatgpt.com/');
  s.registerWebview('p1', claude, { suivreChargement: true });
  claude.emit('did-stop-loading');
  s.registerWebview('p1', gpt); // ouvert après : ne doit pas recevoir le script
  const r = await s.runClaudeJob('p1', 'bonjour', null);
  assert.deepEqual(r, { ok: true, method: 'send_button' });
  assert.equal(gpt.scripts.length, 0);
  assert.ok(claude.scripts.length >= 2);
  assert.ok(s.__attentes.length > 0, 'attente avant la détection');
  nettoyer(s);
});

test('runClaudeJob : popups persistantes, le prompt est écrit quand même (#320)', async () => {
  const s = creer();
  const wc = webview('https://claude.ai/new');
  wc.detection = { chatInput: { found: true }, popups: { count: 2 }, quotaMessage: { detected: false } };
  s.registerWebview('p1', wc);
  const r = await s.runClaudeJob('p1', 'bonjour', null);
  assert.deepEqual(r, { ok: true, method: 'send_button' });
  const derniers = wc.scripts.slice(-1)[0];
  assert.notEqual(derniers, DISMISS, 'le dernier script est l\'écriture, pas la fermeture des popups');
  assert.ok(derniers.includes('bonjour'));
  assert.ok(journal(s).some(m => m.includes('Popups Claude toujours présentes')));
  nettoyer(s);
});

test('runClaudeJob journalise un prompt non envoyé', async () => {
  const s = creer();
  const wc = webview('https://claude.ai/new');
  wc.injection = JSON.stringify({ ok: false, error: 'send_button_disabled' });
  s.registerWebview('p1', wc);
  assert.deepEqual(await s.runClaudeJob('p1', 'x', null), { ok: false, error: 'send_button_disabled' });
  assert.ok(journal(s).some(m => m.includes('Prompt non envoyé dans Claude (« p1 ») : send_button_disabled.')));
  wc.injection = JSON.stringify({ ok: false });
  await s.runClaudeJob('p1', 'x', null);
  assert.ok(journal(s).some(m => m.includes(': unknown.')));
  wc.injection = null;
  assert.deepEqual(await s.runClaudeJob('p1', 'x', null), { ok: false, error: 'unknown' });
  nettoyer(s);
});


test('attente et horloge par défaut', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-320-'));
  const s = new Scheduler({ getPath: () => dir }, {});
  const avant = Date.now();
  await s._attendre(1);
  assert.ok(s._maintenant() >= avant);
  fs.rmSync(s.dir, { recursive: true, force: true });
});
