'use strict';

// test/settings-applied.test.js — Tests des réglages effectivement appliqués
// et de la restauration des onglets (lot 18/09/2026).
// Teste buildApplySettingsPlan, serializeOpenTabs, deserializeOpenTabs,
// buildDeliveryPrompt — fonctions pures de lib/settings.js.

var test = require('node:test');
var assert = require('node:assert');

var settings = require('../lib/settings');

// --- buildApplySettingsPlan : thème ----------------------------------------

test('buildApplySettingsPlan extrait le thème pour data-theme', function() {
  var plan = settings.buildApplySettingsPlan({ theme: 'dark' });
  assert.strictEqual(plan.themeAttr, 'dark');
});

test('buildApplySettingsPlan utilise le thème par défaut si invalide', function() {
  var plan = settings.buildApplySettingsPlan({ theme: 'invalid' });
  assert.strictEqual(plan.themeAttr, 'iao');
});

test('buildApplySettingsPlan gère les trois thèmes valides', function() {
  assert.strictEqual(settings.buildApplySettingsPlan({ theme: 'iao' }).themeAttr, 'iao');
  assert.strictEqual(settings.buildApplySettingsPlan({ theme: 'light' }).themeAttr, 'light');
  assert.strictEqual(settings.buildApplySettingsPlan({ theme: 'dark' }).themeAttr, 'dark');
});

// --- buildApplySettingsPlan : Monaco options -------------------------------

test('buildApplySettingsPlan construit les options Monaco', function() {
  var plan = settings.buildApplySettingsPlan({ editorFontSize: 18, editorWordWrap: 'on' });
  assert.strictEqual(plan.monacoOptions.fontSize, 18);
  assert.strictEqual(plan.monacoOptions.wordWrap, 'on');
});

test('buildApplySettingsPlan borne la taille de police', function() {
  var plan = settings.buildApplySettingsPlan({ editorFontSize: 100 });
  assert.strictEqual(plan.monacoOptions.fontSize, 32);
  assert.strictEqual(plan.fallbackFontSizePx, '32px');
});

test('buildApplySettingsPlan normalise wordWrap invalide', function() {
  var plan = settings.buildApplySettingsPlan({ editorWordWrap: 'invalid' });
  assert.strictEqual(plan.monacoOptions.wordWrap, 'off');
});

test('buildApplySettingsPlan produit la taille CSS pour le textarea de secours', function() {
  var plan = settings.buildApplySettingsPlan({ editorFontSize: 14 });
  assert.strictEqual(plan.fallbackFontSizePx, '14px');
});

// --- buildApplySettingsPlan : scheduler config push ------------------------

test('buildApplySettingsPlan pousse showAutomationWindows vers le scheduler', function() {
  var plan = settings.buildApplySettingsPlan({ showAutomationWindows: true });
  assert.strictEqual(plan.schedulerConfigPush.showAutomationWindows, true);
});

test('buildApplySettingsPlan showAutomationWindows false par défaut', function() {
  var plan = settings.buildApplySettingsPlan({});
  assert.strictEqual(plan.schedulerConfigPush.showAutomationWindows, false);
});

// --- buildApplySettingsPlan : shouldRestoreTabs ----------------------------

test('buildApplySettingsPlan shouldRestoreTabs true si startWithLastSession', function() {
  var plan = settings.buildApplySettingsPlan({ startWithLastSession: true });
  assert.strictEqual(plan.shouldRestoreTabs, true);
});

test('buildApplySettingsPlan shouldRestoreTabs false par défaut', function() {
  var plan = settings.buildApplySettingsPlan({});
  assert.strictEqual(plan.shouldRestoreTabs, false);
});

// --- buildApplySettingsPlan : shouldConfirmClose --------------------------

test('buildApplySettingsPlan shouldConfirmClose false par défaut (#330)', function() {
  var plan = settings.buildApplySettingsPlan({});
  assert.strictEqual(plan.shouldConfirmClose, false);
});

test('buildApplySettingsPlan shouldConfirmClose true si la case est cochée (#330)', function() {
  var plan = settings.buildApplySettingsPlan({ confirmTabClose: true });
  assert.strictEqual(plan.shouldConfirmClose, true);
});

test('buildApplySettingsPlan shouldConfirmClose false si désactivé', function() {
  var plan = settings.buildApplySettingsPlan({ confirmTabClose: false });
  assert.strictEqual(plan.shouldConfirmClose, false);
});

// --- buildApplySettingsPlan : cas null/undefined ---------------------------

test('buildApplySettingsPlan gère null', function() {
  var plan = settings.buildApplySettingsPlan(null);
  assert.strictEqual(plan.themeAttr, 'iao');
  assert.strictEqual(plan.shouldConfirmClose, false);
  assert.strictEqual(plan.shouldRestoreTabs, false);
});

test('buildApplySettingsPlan gère undefined', function() {
  var plan = settings.buildApplySettingsPlan(undefined);
  assert.strictEqual(plan.themeAttr, 'iao');
  assert.strictEqual(plan.monacoOptions.fontSize, 14);
});

// --- serializeOpenTabs -----------------------------------------------------

test('serializeOpenTabs sérialise une liste d\'onglets', function() {
  var tabs = [
    { accId: 'acc1', svcId: 'claude', name: 'Test1' },
    { accId: 'acc2', svcId: 'chatgpt', name: 'Test2' }
  ];
  var json = settings.serializeOpenTabs(tabs);
  var parsed = JSON.parse(json);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].accId, 'acc1');
  assert.strictEqual(parsed[0].svcId, 'claude');
  assert.strictEqual(parsed[1].accId, 'acc2');
  assert.strictEqual(parsed[1].svcId, 'chatgpt');
});

test('serializeOpenTabs filtre les onglets sans accId/svcId', function() {
  var tabs = [
    { accId: 'acc1', svcId: 'claude' },
    { accId: null, svcId: 'chatgpt' },
    { accId: 'acc3', svcId: null },
    { name: 'no ids' }
  ];
  var json = settings.serializeOpenTabs(tabs);
  var parsed = JSON.parse(json);
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].accId, 'acc1');
});

test('serializeOpenTabs renvoie [] pour un tableau vide', function() {
  var json = settings.serializeOpenTabs([]);
  assert.deepStrictEqual(JSON.parse(json), []);
});

test('serializeOpenTabs renvoie [] pour null', function() {
  var json = settings.serializeOpenTabs(null);
  assert.deepStrictEqual(JSON.parse(json), []);
});

test('serializeOpenTabs renvoie [] pour undefined', function() {
  var json = settings.serializeOpenTabs(undefined);
  assert.deepStrictEqual(JSON.parse(json), []);
});

test('serializeOpenTabs ne garde que accId et svcId', function() {
  var tabs = [{ accId: 'a', svcId: 'b', name: 'secret', password: '1234' }];
  var json = settings.serializeOpenTabs(tabs);
  var parsed = JSON.parse(json);
  assert.strictEqual(Object.keys(parsed[0]).length, 2);
  assert.strictEqual(parsed[0].accId, 'a');
  assert.strictEqual(parsed[0].svcId, 'b');
  assert.strictEqual(parsed[0].name, undefined);
});

// --- deserializeOpenTabs ---------------------------------------------------

test('deserializeOpenTabs désérialise une liste valide', function() {
  var json = JSON.stringify([
    { accId: 'acc1', svcId: 'claude' },
    { accId: 'acc2', svcId: 'chatgpt' }
  ]);
  var tabs = settings.deserializeOpenTabs(json);
  assert.strictEqual(tabs.length, 2);
  assert.strictEqual(tabs[0].accId, 'acc1');
  assert.strictEqual(tabs[1].svcId, 'chatgpt');
});

test('deserializeOpenTabs filtre les entrées invalides', function() {
  var json = JSON.stringify([
    { accId: 'acc1', svcId: 'claude' },
    { accId: null, svcId: 'chatgpt' },
    { accId: 'acc3' },
    'not-an-object',
    null
  ]);
  var tabs = settings.deserializeOpenTabs(json);
  assert.strictEqual(tabs.length, 1);
  assert.strictEqual(tabs[0].accId, 'acc1');
});

test('deserializeOpenTabs renvoie [] pour JSON invalide', function() {
  assert.deepStrictEqual(settings.deserializeOpenTabs('not-json'), []);
  assert.deepStrictEqual(settings.deserializeOpenTabs('{bad json}'), []);
});

test('deserializeOpenTabs renvoie [] pour null', function() {
  assert.deepStrictEqual(settings.deserializeOpenTabs(null), []);
});

test('deserializeOpenTabs renvoie [] pour undefined', function() {
  assert.deepStrictEqual(settings.deserializeOpenTabs(undefined), []);
});

test('deserializeOpenTabs renvoie [] pour un non-tableau', function() {
  assert.deepStrictEqual(settings.deserializeOpenTabs(JSON.stringify({ not: 'array' })), []);
  assert.deepStrictEqual(settings.deserializeOpenTabs(JSON.stringify('string')), []);
});

test('deserializeOpenTabs gère une chaîne vide', function() {
  assert.deepStrictEqual(settings.deserializeOpenTabs(''), []);
});

// --- Round-trip serialize → deserialize -----------------------------------

test('Round-trip serialize → deserialize préserve les données', function() {
  var original = [
    { accId: 'acc1', svcId: 'claude' },
    { accId: 'acc2', svcId: 'chatgpt' },
    { accId: 'acc3', svcId: 'gemini' }
  ];
  var json = settings.serializeOpenTabs(original);
  var restored = settings.deserializeOpenTabs(json);
  assert.strictEqual(restored.length, 3);
  assert.strictEqual(restored[0].accId, 'acc1');
  assert.strictEqual(restored[2].svcId, 'gemini');
});

// --- buildDeliveryPrompt ---------------------------------------------------

test('buildDeliveryPrompt génère un prompt avec l\'id du job', function() {
  var prompt = settings.buildDeliveryPrompt({ id: 'job_001', profile: 'profil_1' });
  assert.ok(prompt.indexOf('job_001') !== -1);
  assert.ok(prompt.indexOf('profil_1') !== -1);
});

test('buildDeliveryPrompt génère un prompt avec les mots-clés attendus', function() {
  var prompt = settings.buildDeliveryPrompt({ id: 'job_001', profile: 'profil_1' });
  assert.ok(prompt.indexOf('features') !== -1);
  assert.ok(prompt.indexOf('suivi') !== -1);
  assert.ok(prompt.indexOf('tests') !== -1);
  assert.ok(prompt.indexOf('documentation') !== -1);
  assert.ok(prompt.indexOf('zip') !== -1);
});

test('buildDeliveryPrompt gère un job null', function() {
  var prompt = settings.buildDeliveryPrompt(null);
  assert.ok(prompt.indexOf('job_inconnu') !== -1);
  assert.ok(prompt.indexOf('profil_inconnu') !== -1);
});

test('buildDeliveryPrompt gère un job sans champs', function() {
  var prompt = settings.buildDeliveryPrompt({});
  assert.ok(prompt.indexOf('job_inconnu') !== -1);
});
