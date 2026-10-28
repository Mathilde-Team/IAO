'use strict';

// Issue #310 (relecture) : codes et liens de connexion reçus dans le webmail
// (lib/webmail-codes.js). Messages fictifs calqués sur ceux de l'issue
// (Perplexity, Mistral) : codes et jetons inventés.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const w = require('../lib/webmail-codes');

const MAINTENANT = Date.parse('Mon, 26 Oct 2026 21:26:00 +0000');

const PERPLEXITY = [
  'Return-Path: <x@envelope.mail.perplexity.ai>',
  'Date: Mon, 26 Oct 2026 21:24:55 +0000',
  'From: Perplexity <team@mail.perplexity.ai>',
  'To: docker1@exemple.fr',
  'Subject: =?utf-8?B?Q29ubmVjdGV6LXZvdXMgw6AgUGVycGxleGl0eQ==?=',
  'Content-Type: multipart/alternative; boundary=r4951cry47',
  '',
  '--r4951cry47',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  '=C2=A0',
  '',
  'https://www.perplexity.ai/api/auth/callback/email?callbackUrl=3Dhttps%3A%2F=',
  '%2Fwww.perplexity.ai%2F&email=3Ddocker1%40exemple.fr&token=3D482913',
  '',
  'Connectez-vous =C3=A0 votre compte',
  'Ce lien et ce code ne seront valides que pendant les 5 prochaines minutes. =',
  'Si le lien ne fonctionne pas, vous pouvez utiliser le',
  'code de v=C3=A9rification de connexion directement :',
  '',
  '482913',
  '',
  'support@perplexity.ai',
  '--r4951cry47',
  'Content-Type: text/html; charset=UTF-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  '<html><head><style>.a{color:#123456}</style></head><body>',
  '<a href=3D"https://www.perplexity.ai/api/auth/callback/email?token=3D482913&amp;x=3D1">Se connecter</a>',
  '<p>482913</p></body></html>',
  '--r4951cry47--',
  ''
].join('\r\n');

const MISTRAL = [
  'From: Mistral AI <no-reply@emails.mistral.ai>',
  'To: docker1@exemple.fr',
  'Subject: Please verify your email address for your account',
  'Date: Mon, 26 Oct 2026 21:20:15 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative;',
  ' boundary="--_NmP-1904b-Part_1"',
  '',
  '----_NmP-1904b-Part_1',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Thank you for signing up.',
  'Please use the following code to complete =',
  'the verification process: 997001 or open this link: https://auth.mistral.=',
  'ai/self-service/verification?code=3D997001&flow=3D2def7f2d',
  '----_NmP-1904b-Part_1--',
  ''
].join('\n');

test('#310 analyserMail : mail Perplexity (code et lien du service)', () => {
  const r = w.analyserMail(PERPLEXITY, MAINTENANT);
  assert.equal(r.service, 'perplexity');
  assert.equal(r.code, '482913');
  assert.equal(new URL(r.lien).host, 'www.perplexity.ai');
  assert.equal(new URL(r.lien).searchParams.get('token'), '482913');
  assert.equal(r.sujet, 'Connectez-vous à Perplexity');
  assert.equal(r.recuA, Date.parse('Mon, 26 Oct 2026 21:24:55 +0000'));
});

test('#310 analyserMail : mail Mistral (sous-domaine d\'envoi, boundary entre guillemets)', () => {
  const r = w.analyserMail(MISTRAL, MAINTENANT);
  assert.equal(r.service, 'mistral');
  assert.equal(r.code, '997001');
  assert.equal(r.lien, 'https://auth.mistral.ai/self-service/verification?code=997001&flow=2def7f2d');
});

test('#310 analyserMail : refus (expéditeur inconnu, trop ancien, futur, sans date, rien d\'utile)', () => {
  assert.equal(w.analyserMail('', MAINTENANT), null);
  assert.equal(w.analyserMail(null, MAINTENANT), null);
  assert.equal(w.analyserMail(PERPLEXITY.replace('team@mail.perplexity.ai', 'team@perplexity.ai.evil.example'), MAINTENANT), null);
  assert.equal(w.analyserMail(PERPLEXITY.replace('From: Perplexity <team@mail.perplexity.ai>', 'From: Perplexity'), MAINTENANT), null);
  assert.equal(w.analyserMail(PERPLEXITY, MAINTENANT + w.FRAICHEUR_MS + 60000), null);
  assert.equal(w.analyserMail(PERPLEXITY, MAINTENANT - w.FRAICHEUR_MS - 5 * 60000), null);
  assert.equal(w.analyserMail(PERPLEXITY.replace(/^Date: .*$/m, 'Date: hier'), MAINTENANT), null);
  assert.equal(w.analyserMail(PERPLEXITY.replace(/^Date: .*\r\n/m, ''), MAINTENANT), null);
  const sansRien = 'From: a@claude.ai\nDate: Mon, 26 Oct 2026 21:24:55 +0000\nSubject: Bienvenue\n\nBonjour, rien ici.';
  assert.equal(w.analyserMail(sansRien, MAINTENANT), null);
  // Sans corps ni en-tête de contenu : texte brut vide.
  assert.equal(w.analyserMail('From: a@claude.ai\nDate: Mon, 26 Oct 2026 21:24:55 +0000', MAINTENANT), null);
});

test('#310 analyserMail : code dans le sujet, lien seul, source tronquée', () => {
  const sujet = 'From: Anthropic <no-reply@mail.anthropic.com>\nDate: Mon, 26 Oct 2026 21:24:55 +0000\n' +
    'Subject: Your code is 123456\nContent-Type: text/plain\n\nHello 654321';
  assert.deepEqual([w.analyserMail(sujet, MAINTENANT).service, w.analyserMail(sujet, MAINTENANT).code], ['claude', '123456']);
  const lienSeul = 'From: a@claude.ai\nDate: Mon, 26 Oct 2026 21:24:55 +0000\nContent-Type: text/plain; charset=us-ascii\n\n' +
    'Sign in: https://claude.ai/magic-link#abc.';
  const r = w.analyserMail(lienSeul, MAINTENANT);
  assert.equal(r.code, '');
  assert.equal(r.lien, 'https://claude.ai/magic-link#abc');
  assert.equal(r.sujet, '');
  const enorme = sujet + ' ' + 'x'.repeat(w.SOURCE_MAX);
  assert.equal(w.analyserMail(enorme, MAINTENANT).code, '123456');
});

test('#310 décodage : quoted-printable, en-têtes RFC 2047, latin1, base64', () => {
  assert.equal(w.decoderQP('caf=C3=A9 =\nfin =ZZ').toString('utf8'), 'café fin =ZZ');
  assert.equal(w.decoderEntete('=?utf-8?Q?Caf=C3=A9_cr=C3=A8me?= =?ISO-8859-1?B?6XTp?='), 'Café crèmeété');
  assert.equal(w.decoderEntete(undefined), '');
  const b64 = 'Content-Type: text/plain; charset="iso-8859-1"\nContent-Transfer-Encoding: base64\n\n' +
    Buffer.from('Code de vérification : 246810', 'latin1').toString('base64');
  assert.deepEqual(w.partiesTexte(b64), [{ type: 'plain', texte: 'Code de vérification : 246810' }]);
  // Parties ignorées : pièce jointe, multipart sans boundary, imbrication trop profonde.
  assert.deepEqual(w.partiesTexte('Content-Type: image/png\n\nxxx'), []);
  assert.deepEqual(w.partiesTexte('Content-Type: multipart/mixed\n\nxxx'), []);
  let imbrique = 'Content-Type: text/plain\n\n111111';
  for (let i = 0; i < 6; i++) imbrique = 'Content-Type: multipart/mixed; boundary=b' + i + '\n\n--b' + i + '\n' + imbrique + '\n--b' + i + '--';
  assert.deepEqual(w.partiesTexte(imbrique), []);
  // En-tête sans deux-points, en-tête répété (le premier compte), corps vide.
  assert.deepEqual(w.partiesTexte('bizarre\nContent-Type: text/html\nContent-Type: text/plain'), [{ type: 'html', texte: '' }]);
});

test('#310 htmlVersTexte : liens des href, entités, style et script retirés', () => {
  const h = w.htmlVersTexte('<style>p{color:#111111}</style><script>var x=222222</script>' +
    '<a href="https://claude.ai/login?a=1&amp;b=2">Go</a> &lt;&gt;&quot;&apos;&nbsp;&#233;&#xE9;&inconnue;&#0;');
  assert.deepEqual(h.liens, ['https://claude.ai/login?a=1&b=2']);
  assert.equal(h.texte.trim().replace(/\s+/g, ' '), 'Go <>"\' éé&inconnue;&#0;');
});

test('#310 serviceDeExpediteur : domaine du service, sous-domaine, inconnu', () => {
  assert.equal(w.serviceDeExpediteur('X <noreply@tm.openai.com>'), 'chatgpt');
  assert.equal(w.serviceDeExpediteur('no-reply@accounts.google.com'), 'gemini');
  assert.equal(w.serviceDeExpediteur('a@notperplexity.ai'), null);
  assert.equal(w.serviceDeExpediteur(''), null);
  assert.equal(w.serviceDeExpediteur(undefined), null);
});

test('#310 lienDuService : https, domaine du service, mot de connexion', () => {
  const ok = 'https://www.perplexity.ai/api/auth/callback/email?token=1';
  assert.equal(w.lienDuService(['pas une url', 'http://www.perplexity.ai/api/auth/x', 'https://u:p@www.perplexity.ai/auth',
    'https://evil.example/auth?perplexity.ai', 'https://www.perplexity.ai/blog', ok + ')'], 'perplexity'), ok);
  assert.equal(w.lienDuService(['https://www.perplexity.ai/blog'], 'perplexity'), '');
});

test('#310 codeDans : hors liens, adresses et couleurs ; près du mot « code »', () => {
  assert.equal(w.codeDans('Commande 111111. Votre code : 222222'), '222222');
  assert.equal(w.codeDans('Ticket 333333 sans mot-clé'), '333333');
  assert.equal(w.codeDans('https://x.fr/?t=444444 et 555555@x.fr et #666666 et 1234567'), '');
  assert.equal(w.codeDans('Vérification ' + ' '.repeat(500) + '777777'), '777777');
});

test('#310 les domaines couvrent exactement les services de l\'application', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8');
  const ids = [...app.matchAll(/\{ id: '([a-z0-9-]+)', name: '[^']+', url: '(https:\/\/[^']+)'/g)];
  assert.ok(ids.length >= 20);
  assert.deepEqual(Object.keys(w.DOMAINES).sort(), ids.map(m => m[1]).sort());
  for (const [, id, url] of ids) {
    const hote = new URL(url).hostname;
    assert.ok(w.DOMAINES[id].some(d => hote === d || hote.endsWith('.' + d)), id + ' : ' + hote);
  }
});

// --- Script de relevé exécuté dans une page Roundcube simulée -----------------

function pageRoundcube({ rcmail, liste = '', sources = {} }) {
  const appels = [];
  const ctx = {
    window: { rcmail },
    location: { pathname: '/webmail/index.php' },
    fetch: async (url, opts) => {
      appels.push([url, opts && opts.headers ? opts.headers['X-Roundcube-Request'] : undefined]);
      if (url.includes('_action=list')) return { json: async () => ({ exec: liste }) };
      const uid = /_uid=(\d+)/.exec(url)[1];
      return { text: async () => sources[uid] };
    }
  };
  return { ctx, appels };
}

test('#310 scriptReleve : hors session, liste puis sources des nouveaux messages', async () => {
  for (const rcmail of [undefined, {}, { env: {} }, { env: { request_token: 't', task: 'login' } }]) {
    const { ctx } = pageRoundcube({ rcmail });
    assert.deepEqual(JSON.parse(JSON.stringify(await vm.runInNewContext(w.scriptReleve(0), ctx))), { etat: 'hors-session' });
  }
  const liste = 'this.add_message_row(7,{});this.add_message_row(9,{});this.add_message_row(12,{});';
  const { ctx, appels } = pageRoundcube({ rcmail: { env: { request_token: 'jeton', task: 'mail' } }, liste, sources: { 9: 'S9', 12: 'S12' } });
  const res = await vm.runInNewContext(w.scriptReleve(7), ctx);
  assert.equal(res.etat, 'ok');
  assert.equal(res.max, 12);
  assert.deepEqual(JSON.parse(JSON.stringify(res.messages)), [{ uid: 12, source: 'S12' }, { uid: 9, source: 'S9' }]);
  assert.deepEqual(appels[0], ['/webmail/?_task=mail&_action=list&_mbox=INBOX&_page=1&_remote=1', 'jeton']);
  assert.equal(appels[1][0], '/webmail/?_task=mail&_mbox=INBOX&_uid=12&_action=viewsource');
  // Liste vide, uid invalide : départ à 0.
  const vide = pageRoundcube({ rcmail: { env: { request_token: 'j' } } });
  const r2 = await vm.runInNewContext(w.scriptReleve(-3), vide.ctx);
  assert.equal(r2.max, 0);
  assert.equal(r2.messages.length, 0);
});

// --- Relevé périodique ---------------------------------------------------------

function releveur(resultats, options = {}) {
  const evenements = [];
  const journal = [];
  const traces = [];
  const scripts = [];
  let minuterie = null;
  let arretee = null;
  const r = w.creerReleveur({
    wc: { executeJavaScript: (s) => { scripts.push(s); const x = resultats.shift(); return x instanceof Error ? Promise.reject(x) : Promise.resolve(x); } },
    profil: 'p1',
    signaler: (e) => evenements.push(e),
    journal: (n, m) => journal.push(n + ' ' + m),
    debug: (m) => traces.push(m),
    maintenant: () => MAINTENANT,
    setIntervalFn: (fn, ms) => { minuterie = { fn, ms }; return 42; },
    clearIntervalFn: (id) => { arretee = id; },
    ...options
  });
  return { r, evenements, journal, traces, scripts, get minuterie() { return minuterie; }, get arretee() { return arretee; } };
}

test('#310 creerReleveur : signale une fois chaque connexion, sans code ni lien au journal', async () => {
  const t = releveur([
    { etat: 'hors-session' },
    { etat: 'ok', max: 5, messages: [{ uid: 5, source: PERPLEXITY }, { uid: 4, source: 'From: x@inconnu.fr\n\nrien' }, null] },
    { etat: 'ok', max: 6, messages: [{ uid: 6, source: PERPLEXITY }] }, // même code : pas de doublon
    { etat: 'ok', max: 3, messages: 'pas un tableau' },
    { etat: 'ok', max: 'x', messages: [{ uid: 8, source: MISTRAL }] }
  ]);
  assert.equal(t.minuterie.ms, 10000);
  assert.equal(await t.r.relever(), 'hors-session');
  assert.equal(await t.r.relever(), 'ok');
  assert.match(t.scripts[1], /u > 0\)/);
  assert.equal(await t.r.relever(), 'ok');
  assert.match(t.scripts[2], /u > 5\)/);
  await t.r.relever();
  assert.match(t.scripts[3], /u > 6\)/);
  await t.minuterie.fn();
  assert.match(t.scripts[4], /u > 6\)/);
  assert.deepEqual(t.evenements.map(e => [e.profil, e.service, e.code]), [['p1', 'perplexity', '482913'], ['p1', 'mistral', '997001']]);
  assert.deepEqual(t.journal, [
    'info Webmail : mail de connexion perplexity reçu pour « p1 » (code, lien).',
    'info Webmail : mail de connexion mistral reçu pour « p1 » (code, lien).'
  ]);
  assert.ok(t.journal.concat(t.traces).every(l => !l.includes('482913') && !l.includes('997001')), 'code jamais journalisé');
  assert.deepEqual(t.traces, ['Webmail : relevé des codes pour « p1 » : hors-session.', 'Webmail : relevé des codes pour « p1 » : ok.']);
  t.r.arreter();
  assert.equal(t.arretee, 42);
  assert.equal(t.traces.at(-1), 'Webmail : relevé arrêté pour « p1 ».');
});

test('#310 creerReleveur : page étrangère, relevé en cours, erreurs journalisées', async () => {
  let actif = false;
  const t = releveur([new Error('page fermée'), 'brut', null], { actif: () => actif });
  assert.equal(await t.r.relever(), 'inactif');
  assert.equal(t.scripts.length, 0);
  actif = true;
  const p1 = t.r.relever();
  assert.equal(await t.r.relever(), 'occupe');
  assert.equal(await p1, 'erreur');
  const t2 = releveur([Promise.reject('brut')]);
  assert.equal(await t2.r.relever(), 'erreur');
  const t3 = releveur([undefined]);
  assert.equal(await t3.r.relever(), 'hors-session');
  const t4 = releveur([{ get etat() { throw null; } }]);
  assert.equal(await t4.r.relever(), 'erreur');
  assert.deepEqual([t.journal, t2.journal, t4.journal], [
    ['warning Webmail : relevé des mails impossible pour « p1 » (page fermée).'],
    ['warning Webmail : relevé des mails impossible pour « p1 » (brut).'],
    ['warning Webmail : relevé des mails impossible pour « p1 » (null).']
  ]);
  // Lien sans code, code sans lien : le journal le dit, sans les valeurs.
  const lienSeul = 'From: a@claude.ai\nDate: Mon, 26 Oct 2026 21:24:55 +0000\n\nhttps://claude.ai/magic-link#k';
  const codeSeul = 'From: a@claude.ai\nDate: Mon, 26 Oct 2026 21:24:55 +0000\n\nYour code: 135790';
  const t5 = releveur([{ etat: 'ok', max: 2, messages: [{ uid: 2, source: lienSeul }, { uid: 1, source: codeSeul }] }]);
  await t5.r.relever();
  assert.deepEqual(t5.journal, [
    'info Webmail : mail de connexion claude reçu pour « p1 » (sans code, lien).',
    'info Webmail : mail de connexion claude reçu pour « p1 » (code, sans lien).'
  ]);
  // Valeurs par défaut : journal et debug muets, minuterie réelle arrêtée.
  const r = w.creerReleveur({ wc: { executeJavaScript: async () => ({ etat: 'ok', max: 1, messages: [{ uid: 1, source: MISTRAL }] }) }, profil: 'p', signaler: () => {}, maintenant: () => MAINTENANT });
  assert.equal(await r.relever(), 'ok');
  r.arreter();
});

// --- File d'attente vers l'interface ---------------------------------------------

test('#310 creerFileConnexions : remise immédiate, attente longue, délai écoulé', async () => {
  const minuteries = [];
  const f = w.creerFileConnexions({
    delaiMs: 25000,
    setTimeoutFn: (fn, ms) => { minuteries.push({ fn, ms, annulee: false }); return minuteries.length - 1; },
    clearTimeoutFn: (i) => { minuteries[i].annulee = true; }
  });
  f.ajouter({ n: 1 });
  assert.deepEqual(await f.attendre(), [{ n: 1 }]);
  const a = f.attendre();
  const b = f.attendre();
  f.ajouter({ n: 2 });
  assert.deepEqual(await a, [{ n: 2 }]);
  assert.deepEqual(await b, [{ n: 2 }]);
  assert.ok(minuteries[0].annulee && minuteries[1].annulee);
  const c = f.attendre();
  minuteries[2].fn();
  assert.deepEqual(await c, []);
  assert.equal(minuteries[2].ms, 25000);
  // Sans attente en cours : l'événement reste en file.
  f.ajouter({ n: 3 });
  assert.deepEqual(await f.attendre(), [{ n: 3 }]);
  // Valeurs par défaut.
  const g = w.creerFileConnexions();
  g.ajouter('x');
  assert.deepEqual(await g.attendre(), ['x']);
});
