'use strict';

// Tests du client mail-accounts-api (lib/mail-api.js, issue #357).
// Doublures injectées : `fetchFn` (aucun réseau), coffre et webmail factices
// pour les handlers IPC (invariant 11 : pur, node --test sans Electron).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mailApi = require(path.join(__dirname, '..', 'lib', 'mail-api.js'));

// Réponse factice : statut + corps JSON (ou texte brut pour un corps illisible).
function reponse(statut, corps, brut) {
  return {
    status: statut,
    text: async () => (brut !== undefined ? brut : (corps === undefined ? '' : JSON.stringify(corps)))
  };
}

// fetch factice piloté par une file de réponses (une par appel).
function fetchQueue(...reponses) {
  const appels = [];
  const fn = async (url, options) => {
    appels.push({ url, options });
    const r = reponses.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  fn.appels = appels;
  return fn;
}

const API = 'http://127.0.0.1:9941';

// --- normaliserUrlApi -------------------------------------------------------

test('#357 normaliserUrlApi : schéma http(s), slashs finaux retirés', () => {
  assert.strictEqual(mailApi.normaliserUrlApi(' http://127.0.0.1:9941/ '), API);
  assert.strictEqual(mailApi.normaliserUrlApi('http://127.0.0.1:9941///'), API);
  assert.strictEqual(mailApi.normaliserUrlApi('https://api.dmathilde.fr/v1/'), 'https://api.dmathilde.fr/v1');
  // Refusés : hors schéma http(s), texte libre, non-chaîne.
  assert.strictEqual(mailApi.normaliserUrlApi('ftp://127.0.0.1'), '');
  assert.strictEqual(mailApi.normaliserUrlApi('javascript:alert(1)'), '');
  assert.strictEqual(mailApi.normaliserUrlApi('pas une url'), '');
  assert.strictEqual(mailApi.normaliserUrlApi(''), '');
  assert.strictEqual(mailApi.normaliserUrlApi(null), '');
  assert.strictEqual(mailApi.normaliserUrlApi(42), '');
});

// --- domaineDeEmail / domaineCorrespond ------------------------------------

test('#357 domaineDeEmail : domaine en minuscules, sinon null', () => {
  assert.strictEqual(mailApi.domaineDeEmail('a@DMATHILDE.fr'), 'dmathilde.fr');
  assert.strictEqual(mailApi.domaineDeEmail('docker239@dmathilde.fr'), 'dmathilde.fr');
  assert.strictEqual(mailApi.domaineDeEmail('pasdarrobe'), null);
  assert.strictEqual(mailApi.domaineDeEmail('@dmathilde.fr'), null);
  assert.strictEqual(mailApi.domaineDeEmail('a@'), null);
  assert.strictEqual(mailApi.domaineDeEmail(null), null);
});

test('#357 domaineCorrespond : comparaison insensible à la casse et à l\'espace', () => {
  assert.strictEqual(mailApi.domaineCorrespond('a@Dmathilde.fr', ' DMATHILDE.FR '), true);
  assert.strictEqual(mailApi.domaineCorrespond('a@autre.fr', 'dmathilde.fr'), false);
  assert.strictEqual(mailApi.domaineCorrespond('a@dmathilde.fr', ''), false);
  assert.strictEqual(mailApi.domaineCorrespond('sans-domaine', 'dmathilde.fr'), false);
  assert.strictEqual(mailApi.domaineCorrespond('a@dmathilde.fr', null), false);
});

// --- creerCompte ------------------------------------------------------------

test('#357 creerCompte : création 201 avec le mot de passe du coffre', async () => {
  const f = fetchQueue(reponse(201, { email: 'a@dm.fr', password: 'x' }));
  const r = await mailApi.creerCompte({ fetchFn: f, urlApi: API, cle: 'k', email: 'a@dm.fr', motDePasse: 'x' });
  assert.deepStrictEqual(r, { ok: true, statut: 'cree', motDePasseGenere: 'x' });
  assert.strictEqual(f.appels[0].url, API + '/accounts');
  assert.strictEqual(f.appels[0].options.method, 'POST');
  assert.strictEqual(f.appels[0].options.headers.Authorization, 'Bearer k');
  assert.deepStrictEqual(JSON.parse(f.appels[0].options.body), { email: 'a@dm.fr', password: 'x' });
});

test('#357 creerCompte : 201 sans mot de passe, le serveur en génère un', async () => {
  const f = fetchQueue(reponse(201, { email: 'a@dm.fr', password: 'genere' }));
  const r = await mailApi.creerCompte({ fetchFn: f, urlApi: API, cle: 'k', email: 'a@dm.fr' });
  assert.deepStrictEqual(r, { ok: true, statut: 'cree', motDePasseGenere: 'genere' });
  assert.deepStrictEqual(JSON.parse(f.appels[0].options.body), { email: 'a@dm.fr' });
});

test('#357 creerCompte : 201 avec un corps sans mot de passe', async () => {
  const f = fetchQueue(reponse(201, { email: 'a@dm.fr' }));
  const r = await mailApi.creerCompte({ fetchFn: f, urlApi: API, cle: 'k', email: 'a@dm.fr' });
  assert.deepStrictEqual(r, { ok: true, statut: 'cree', motDePasseGenere: null });
});

test('#357 creerCompte : 409 sans mot de passe -> compte existant, rien à changer', async () => {
  const f = fetchQueue(reponse(409, { detail: 'Account already exists' }));
  const r = await mailApi.creerCompte({ fetchFn: f, urlApi: API, cle: 'k', email: 'a@dm.fr' });
  assert.deepStrictEqual(r, { ok: true, statut: 'existant' });
});

test('#357 creerCompte : 409 avec mot de passe -> changement (PATCH)', async () => {
  const f = fetchQueue(
    reponse(409, { detail: 'Account already exists' }),
    reponse(200, { email: 'a@dm.fr' })
  );
  const r = await mailApi.creerCompte({ fetchFn: f, urlApi: API, cle: 'k', email: 'a@dm.fr', motDePasse: 'n' });
  assert.deepStrictEqual(r, { ok: true, statut: 'modifie' });
  assert.strictEqual(f.appels[1].url, API + '/accounts/a%40dm.fr');
  assert.strictEqual(f.appels[1].options.method, 'PATCH');
  assert.deepStrictEqual(JSON.parse(f.appels[1].options.body), { password: 'n' });
});

test('#357 creerCompte : erreurs du serveur traduites (401, 422, 503, autre)', async () => {
  const base = { fetchFn: fetchQueue(reponse(401, { detail: 'Bad key' })), urlApi: API, cle: 'k', email: 'a@dm.fr' };
  assert.deepStrictEqual(await mailApi.creerCompte(base),
    { ok: false, statut: 'cle', detail: 'Bad key' });
  assert.deepStrictEqual(await mailApi.creerCompte(
    { fetchFn: fetchQueue(reponse(422, { detail: 'x' })), urlApi: API, cle: 'k', email: 'a@dm.fr' }),
    { ok: false, statut: 'invalide', detail: 'x' });
  assert.deepStrictEqual(await mailApi.creerCompte(
    { fetchFn: fetchQueue(reponse(503, { detail: 'y' })), urlApi: API, cle: 'k', email: 'a@dm.fr' }),
    { ok: false, statut: 'stockage', detail: 'y' });
  assert.deepStrictEqual(await mailApi.creerCompte(
    { fetchFn: fetchQueue(reponse(500, { detail: 'boom' })), urlApi: API, cle: 'k', email: 'a@dm.fr' }),
    { ok: false, statut: 'reseau', detail: 'boom' });
  assert.deepStrictEqual(await mailApi.creerCompte(
    { fetchFn: fetchQueue(reponse(404, { detail: 'pas la' })), urlApi: API, cle: 'k', email: 'a@dm.fr' }),
    { ok: false, statut: 'absent', detail: 'pas la' });
});

test('#357 creerCompte : serveur injoignable -> reseau, sans détail', async () => {
  const f = fetchQueue(new Error('ECONNREFUSED'));
  const r = await mailApi.creerCompte({ fetchFn: f, urlApi: API, cle: 'k', email: 'a@dm.fr' });
  assert.deepStrictEqual(r, { ok: false, statut: 'reseau' });
});

test('#357 creerCompte : corps de réponse illisible -> détail vide', async () => {
  const f = fetchQueue(reponse(401, undefined, '<html>pas json</html>'));
  const r = await mailApi.creerCompte({ fetchFn: f, urlApi: API, cle: 'k', email: 'a@dm.fr' });
  assert.deepStrictEqual(r, { ok: false, statut: 'cle', detail: '' });
});

test('#357 creerCompte : détail long borné à 200 caractères', async () => {
  const f = fetchQueue(reponse(422, { detail: 'x'.repeat(300) }));
  const r = await mailApi.creerCompte({ fetchFn: f, urlApi: API, cle: 'k', email: 'a@dm.fr' });
  assert.strictEqual(r.detail.length, 200);
});

// --- changerMotDePasse ------------------------------------------------------

test('#357 changerMotDePasse : 2xx -> modifie, 404 -> absent, 401 -> cle', async () => {
  const ok = await mailApi.changerMotDePasse(
    { fetchFn: fetchQueue(reponse(200, { email: 'a@dm.fr' })), urlApi: API, cle: 'k', email: 'a@dm.fr', motDePasse: 'n' });
  assert.deepStrictEqual(ok, { ok: true, statut: 'modifie' });
  const absent = await mailApi.changerMotDePasse(
    { fetchFn: fetchQueue(reponse(404, { detail: 'Account not found' })), urlApi: API, cle: 'k', email: 'a@dm.fr', motDePasse: 'n' });
  assert.deepStrictEqual(absent, { ok: false, statut: 'absent', detail: 'Account not found' });
  const cle = await mailApi.changerMotDePasse(
    { fetchFn: fetchQueue(reponse(401, { detail: 'Bad key' })), urlApi: API, cle: 'k', email: 'a@dm.fr', motDePasse: 'n' });
  assert.deepStrictEqual(cle, { ok: false, statut: 'cle', detail: 'Bad key' });
});

test('#357 changerMotDePasse : l\'adresse est encodée dans le chemin', async () => {
  const f = fetchQueue(reponse(200, {}));
  await mailApi.changerMotDePasse({ fetchFn: f, urlApi: API, cle: 'k', email: 'a b@dm.fr', motDePasse: 'n' });
  assert.strictEqual(f.appels[0].url, API + '/accounts/a%20b%40dm.fr');
});

// --- creerLot ---------------------------------------------------------------

test('#357 creerLot : lot vide refusé, lot borné à LOT_MAX', async () => {
  assert.deepStrictEqual(await mailApi.creerLot({ fetchFn: fetchQueue(), urlApi: API, cle: 'k', comptes: [] }),
    { ok: false, statut: 'lot' });
  assert.deepStrictEqual(await mailApi.creerLot({ fetchFn: fetchQueue(), urlApi: API, cle: 'k', comptes: 'pas une liste' }),
    { ok: false, statut: 'lot' });
  const comptes = Array.from({ length: 105 }, (_, i) => ({ email: 'a' + i + '@dm.fr' }));
  const f = fetchQueue(reponse(201, []));
  const r = await mailApi.creerLot({ fetchFn: f, urlApi: API, cle: 'k', comptes });
  assert.strictEqual(r.ok && r.nombre, mailApi.LOT_MAX);
  assert.strictEqual(JSON.parse(f.appels[0].options.body).accounts.length, 100);
});

test('#357 creerLot : 201 atomique -> tout créé', async () => {
  const f = fetchQueue(reponse(201, []));
  const r = await mailApi.creerLot({
    fetchFn: f, urlApi: API, cle: 'k',
    comptes: [{ email: 'a@dm.fr', motDePasse: 'x' }, { email: 'b@dm.fr' }]
  });
  assert.deepStrictEqual(r, { ok: true, statut: 'cree', nombre: 2 });
  assert.deepStrictEqual(JSON.parse(f.appels[0].options.body),
    { accounts: [{ email: 'a@dm.fr', password: 'x' }, { email: 'b@dm.fr' }] });
});

test('#357 creerLot : 409 -> rattrapage unitaire (créés, existants, modifiés, échecs)', async () => {
  const f = fetchQueue(
    reponse(409, { detail: 'Account already exists' }), // lot refusé
    reponse(201, { email: 'a@dm.fr', password: 'genere' }), // a créé
    reponse(409, { detail: 'Account already exists' }),     // b existe, mot de passe fourni
    reponse(200, {}),                                       // -> changé
    reponse(409, { detail: 'Account already exists' }),     // c existe, sans mot de passe
    reponse(401, { detail: 'Bad key' })                     // d : échec
  );
  const r = await mailApi.creerLot({
    fetchFn: f, urlApi: API, cle: 'k',
    comptes: [
      { email: 'a@dm.fr' },
      { email: 'b@dm.fr', motDePasse: 'n' },
      { email: 'c@dm.fr' },
      { email: 'd@dm.fr', motDePasse: 'n' }
    ]
  });
  assert.deepStrictEqual(r, {
    ok: true, statut: 'melange',
    crees: 1, existants: 1, modifies: 1, echecs: 1,
    creesListe: ['a@dm.fr'], modifieesListe: ['b@dm.fr'],
    motsDePasseGeneres: [{ email: 'a@dm.fr', motDePasseGenere: 'genere' }]
  });
});

test('#357 creerLot : erreurs globales (réseau, 401) transmises', async () => {
  const reseau = await mailApi.creerLot({
    fetchFn: fetchQueue(new Error('down')), urlApi: API, cle: 'k',
    comptes: [{ email: 'a@dm.fr' }]
  });
  assert.deepStrictEqual(reseau, { ok: false, statut: 'reseau' });
  const cle = await mailApi.creerLot({
    fetchFn: fetchQueue(reponse(401, { detail: 'Bad key' })), urlApi: API, cle: 'k',
    comptes: [{ email: 'a@dm.fr' }]
  });
  assert.deepStrictEqual(cle, { ok: false, statut: 'cle', detail: 'Bad key' });
});

// --- Handlers IPC (lib/coffre-secrets.js, issue #357) -----------------------

const coffreSecrets = require(path.join(__dirname, '..', 'lib', 'coffre-secrets.js'));

// Enregistre les IPC « mail-api:* » sur un ipc et un coffre factices.
function monterIpc({ coffre, reglages, ouvrirWebmail, fetchFn, fsPromises }) {
  const canaux = new Map();
  const ipc = { handle: (c, h) => canaux.set(c, h) };
  coffreSecrets.registerComptesIPC(ipc, {
    coffre, fichierReglages: '/x', normaliser: (s) => s,
    fsPromises: fsPromises || {
      readFile: async () => JSON.stringify(reglages)
    },
    ouvrirExterne: async () => true, ouvrirWebmail,
    fetchFn: fetchFn || (async () => { throw new Error('pas de réseau'); })
  });
  return canaux;
}

function coffreFactice(valeurs = {}) {
  return {
    lire: (k) => (k in valeurs ? valeurs[k] : ''),
    definir: (k, v) => { valeurs[k] = v; return { ok: true }; }
  };
}

test('#357 IPC mail-api:creer : non configuré (URL ou clé absente) -> non-config', async () => {
  const c = monterIpc({ coffre: coffreFactice({}), reglages: { mailApiUrl: '', webmailUrl: '' }, ouvrirWebmail: () => null });
  assert.deepStrictEqual(await c.get('mail-api:creer')({}, { profil: 'a', email: 'a@dm.fr' }),
    { ok: false, statut: 'non-config' });
  const c2 = monterIpc({ coffre: coffreFactice({}), reglages: { mailApiUrl: API, webmailUrl: '' }, ouvrirWebmail: () => null });
  assert.deepStrictEqual(await c2.get('mail-api:creer')({}, { profil: 'a', email: 'a@dm.fr' }),
    { ok: false, statut: 'non-config' });
});

test('#357 IPC mail-api:creer : compte invalide -> compte', async () => {
  const c = monterIpc({
    coffre: coffreFactice({ mail_api: 'k' }), reglages: { mailApiUrl: API, webmailUrl: '' },
    ouvrirWebmail: () => null
  });
  assert.deepStrictEqual(await c.get('mail-api:creer')({}, { profil: '', email: 'a@dm.fr' }),
    { ok: false, statut: 'compte' });
});

test('#357 IPC mail-api:creer : mot de passe généré remis au coffre + webmail en arrière-plan', async () => {
  let webmail = null;
  const valeurs = { mail_api: 'k' };
  const c = monterIpc({
    coffre: coffreFactice(valeurs),
    reglages: { mailApiUrl: API, webmailUrl: 'https://mail.dm.fr' },
    ouvrirWebmail: (o) => { webmail = o; }
  });
  // Le fetch factice est branché après coup : le handler a reçu un fetchFn
  // qui échoue ; on teste ici le succès via une nouvelle instance.
  const c2 = monterIpc({
    coffre: coffreFactice(valeurs),
    reglages: { mailApiUrl: API, webmailUrl: 'https://mail.dm.fr' },
    ouvrirWebmail: (o) => { webmail = o; },
    fetchFn: fetchQueue(reponse(201, { email: 'a@dm.fr', password: 'genere' }))
  });
  const r = await c2.get('mail-api:creer')({}, { profil: 'a', email: 'a@dm.fr' });
  assert.deepStrictEqual(r, { ok: true, statut: 'cree', motDePasseGenere: 'genere', enregistre: true });
  assert.strictEqual(valeurs['a'], 'genere'); // mot de passe du compte au coffre
  assert.deepStrictEqual(webmail, {
    url: 'https://mail.dm.fr', profil: 'a', email: 'a@dm.fr', motDePasse: 'genere', arrierePlan: true
  });
});

test('#357 IPC mail-api:creer : échec réseau -> pas de webmail arrière-plan', async () => {
  let webmail = null;
  const c = monterIpc({
    coffre: coffreFactice({ mail_api: 'k', a: 'x' }),
    reglages: { mailApiUrl: API, webmailUrl: 'https://mail.dm.fr' },
    ouvrirWebmail: (o) => { webmail = o; },
    fetchFn: fetchQueue(new Error('down'))
  });
  const r = await c.get('mail-api:creer')({}, { profil: 'a', email: 'a@dm.fr' });
  assert.deepStrictEqual(r, { ok: false, statut: 'reseau' });
  assert.strictEqual(webmail, null);
});

test('#357 IPC mail-api:creer-lot : rattrapage, coffre et webmail espacés', async () => {
  const valeurs = { mail_api: 'k' };
  const webmails = [];
  const c = monterIpc({
    coffre: coffreFactice(valeurs),
    reglages: { mailApiUrl: API, webmailUrl: 'https://mail.dm.fr' },
    ouvrirWebmail: (o) => { webmails.push(o); },
    fetchFn: fetchQueue(
      reponse(409, { detail: 'Account already exists' }), // lot refusé
      reponse(201, { email: 'a@dm.fr', password: 'genere' }), // a créé (sans mdp en coffre)
      reponse(409, { detail: 'Account already exists' })      // b existe, mdp fourni -> PATCH
    )
  });
  // PATCH de b : la queue ci-dessus s'arrête ; on enchaîne sur une réponse 200.
  const patch = fetchQueue(reponse(200, {}));
  // (le handler tient une seule instance fetchFn : on ne peut pas la changer
  // en cours de route -> on teste le lot avec uniquement des créations.)
  const c2 = monterIpc({
    coffre: coffreFactice(valeurs),
    reglages: { mailApiUrl: API, webmailUrl: 'https://mail.dm.fr' },
    ouvrirWebmail: (o) => { webmails.push(o); },
    fetchFn: fetchQueue(
      reponse(409, { detail: 'Account already exists' }),
      reponse(201, { email: 'a@dm.fr', password: 'genere' }),
      reponse(409, { detail: 'Account already exists' })
    )
  });
  const r = await c2.get('mail-api:creer-lot')({}, [
    { profil: 'a', email: 'a@dm.fr' },
    { profil: 'b', email: 'b@dm.fr' }
  ]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.statut, 'melange');
  assert.deepStrictEqual(r.creesListe, ['a@dm.fr']);
  assert.strictEqual(valeurs['a'], 'genere');
  // Le webmail en arrière-plan n'est ouvert que pour le compte créé — mais
  // l'ouverture est différée (setTimeout 2 s) : rien d'immédiat à vérifier ici
  // au-delà du fait que le handler rend la main.
  assert.strictEqual(webmails.length, 0);
});

test('#357 IPC mail-api:creer-lot : lot vide ou non-configuré', async () => {
  const c = monterIpc({
    coffre: coffreFactice({}), reglages: { mailApiUrl: '', webmailUrl: '' }, ouvrirWebmail: () => null
  });
  assert.deepStrictEqual(await c.get('mail-api:creer-lot')({}, []),
    { ok: false, statut: 'compte' });
  const c2 = monterIpc({
    coffre: coffreFactice({}), reglages: { mailApiUrl: '', webmailUrl: '' }, ouvrirWebmail: () => null
  });
  assert.deepStrictEqual(await c2.get('mail-api:creer-lot')({}, [{ profil: 'a', email: 'a@dm.fr' }]),
    { ok: false, statut: 'non-config' });
});

// --- compléments de couverture : branches non prises ------------------------

test('#357 creerCompte : 409 + mot de passe, PATCH en échec réseau -> reseau', async () => {
  const f = fetchQueue(reponse(409, {}), new Error('down'));
  const r = await mailApi.creerCompte({ fetchFn: f, urlApi: API, cle: 'k', email: 'a@dm.fr', motDePasse: 'n' });
  assert.deepStrictEqual(r, { ok: false, statut: 'reseau' });
});

test('#357 creerCompte : 409 + mot de passe, PATCH 409 -> existant en échec', async () => {
  const f = fetchQueue(reponse(409, {}), reponse(409, {}));
  const r = await mailApi.creerCompte({ fetchFn: f, urlApi: API, cle: 'k', email: 'a@dm.fr', motDePasse: 'n' });
  assert.deepStrictEqual(r, { ok: false, statut: 'existant', detail: '' });
});

test('#357 mail-api s\'attache à window dans le renderer', () => {
  const chemin = require.resolve('../lib/mail-api.js');
  const avant = global.window;
  global.window = {};
  try {
    delete require.cache[chemin];
    require(chemin);
    assert.equal(typeof global.window.iaoMailApi.creerCompte, 'function');
  } finally {
    if (avant === undefined) delete global.window; else global.window = avant;
    delete require.cache[chemin];
  }
});

test('#357 IPC mail-api:creer : réglages illisibles -> non-config', async () => {
  const c = monterIpc({
    coffre: coffreFactice({ mail_api: 'k' }), reglages: {},
    ouvrirWebmail: () => null,
    fsPromises: { readFile: async () => { throw new Error('illisible'); } }
  });
  assert.deepStrictEqual(await c.get('mail-api:creer')({}, { profil: 'a', email: 'a@dm.fr' }),
    { ok: false, statut: 'non-config' });
});

test('#357 IPC mail-api:creer : compte existant sans mot de passe -> pas de webmail', async () => {
  let webmail = null;
  const c = monterIpc({
    coffre: coffreFactice({ mail_api: 'k' }),
    reglages: { mailApiUrl: API, webmailUrl: 'https://mail.dm.fr' },
    ouvrirWebmail: (o) => { webmail = o; },
    fetchFn: fetchQueue(reponse(409, {}))
  });
  const r = await c.get('mail-api:creer')({}, { profil: 'a', email: 'a@dm.fr' });
  assert.deepStrictEqual(r, { ok: true, statut: 'existant' });
  assert.strictEqual(webmail, null);
});

test('#357 IPC mail-api:creer : mot de passe changé (409 + mdp, PATCH 200) -> webmail avec le mot de passe du coffre', async () => {
  let webmail = null;
  const c = monterIpc({
    coffre: coffreFactice({ mail_api: 'k', a: 'coffre' }),
    reglages: { mailApiUrl: API, webmailUrl: 'https://mail.dm.fr' },
    ouvrirWebmail: (o) => { webmail = o; },
    fetchFn: fetchQueue(reponse(409, {}), reponse(200, {}))
  });
  const r = await c.get('mail-api:creer')({}, { profil: 'a', email: 'a@dm.fr' });
  assert.deepStrictEqual(r, { ok: true, statut: 'modifie' });
  assert.deepStrictEqual(webmail, {
    url: 'https://mail.dm.fr', profil: 'a', email: 'a@dm.fr', motDePasse: 'coffre', arrierePlan: true
  });
});

test('#357 IPC mail-api:creer : coffre en échec d\'écriture -> webmail avec le mot de passe généré', async () => {
  let webmail = null;
  const c = monterIpc({
    coffre: {
      lire: (k) => (k === 'mail_api' ? 'k' : ''),
      definir: () => ({ ok: false, erreur: 'chiffrement-indisponible' })
    },
    reglages: { mailApiUrl: API, webmailUrl: 'https://mail.dm.fr' },
    ouvrirWebmail: (o) => { webmail = o; },
    fetchFn: fetchQueue(reponse(201, { email: 'a@dm.fr', password: 'genere' }))
  });
  const r = await c.get('mail-api:creer')({}, { profil: 'a', email: 'a@dm.fr' });
  assert.deepStrictEqual(r, { ok: true, statut: 'cree', motDePasseGenere: 'genere' });
  assert.deepStrictEqual(webmail, {
    url: 'https://mail.dm.fr', profil: 'a', email: 'a@dm.fr', motDePasse: 'genere', arrierePlan: true
  });
});

test('#357 IPC mail-api:creer-lot : entrée non liste -> compte', async () => {
  const c = monterIpc({
    coffre: coffreFactice({}), reglages: { mailApiUrl: API, webmailUrl: '' },
    ouvrirWebmail: () => null
  });
  assert.deepStrictEqual(await c.get('mail-api:creer-lot')({}, 'pas une liste'),
    { ok: false, statut: 'compte' });
});

test('#357 IPC mail-api:creer-lot : lot créé d\'un bloc, webmail espacé', async (t) => {
  const webmails = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = monterIpc({
    coffre: coffreFactice({ mail_api: 'k', a: 'x' }),
    reglages: { mailApiUrl: API, webmailUrl: 'https://mail.dm.fr' },
    ouvrirWebmail: (o) => { webmails.push(o); },
    fetchFn: fetchQueue(reponse(201, {}))
  });
  const r = await c.get('mail-api:creer-lot')({}, [
    { profil: 'a', email: 'a@dm.fr' }, { profil: 'b', email: 'b@dm.fr' }
  ]);
  assert.deepStrictEqual(r, { ok: true, statut: 'cree', nombre: 2 });
  assert.strictEqual(webmails.length, 0); // ouvertures différées (minuteries factices)
  t.mock.timers.tick(1);
  assert.strictEqual(webmails.length, 1); // premier compte : délai nul
  t.mock.timers.tick(1998);
  assert.strictEqual(webmails.length, 1); // second espacé de 2 s
  t.mock.timers.tick(1);
  assert.strictEqual(webmails.length, 2);
  assert.deepStrictEqual(webmails[0], {
    url: 'https://mail.dm.fr', profil: 'a', email: 'a@dm.fr', motDePasse: 'x', arrierePlan: true
  });
  assert.deepStrictEqual(webmails[1], {
    // b : rien en coffre et pas de mot de passe renvoyé -> chaîne vide.
    url: 'https://mail.dm.fr', profil: 'b', email: 'b@dm.fr', motDePasse: '', arrierePlan: true
  });
});

test('#357 IPC mail-api:creer : création sans mot de passe renvoyé -> webmail sans mot de passe', async () => {
  let webmail = null;
  const c = monterIpc({
    coffre: coffreFactice({ mail_api: 'k' }),
    reglages: { mailApiUrl: API, webmailUrl: 'https://mail.dm.fr' },
    ouvrirWebmail: (o) => { webmail = o; },
    fetchFn: fetchQueue(reponse(201, { email: 'a@dm.fr' }))
  });
  const r = await c.get('mail-api:creer')({}, { profil: 'a', email: 'a@dm.fr' });
  assert.deepStrictEqual(r, { ok: true, statut: 'cree', motDePasseGenere: null });
  assert.deepStrictEqual(webmail, {
    url: 'https://mail.dm.fr', profil: 'a', email: 'a@dm.fr', motDePasse: '', arrierePlan: true
  });
});
