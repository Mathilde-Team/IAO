'use strict';

// test/har.test.js — issue #305 : enregistrement HAR des 15 premières minutes
// d'une connexion (lib/har.js). Horloge, lecture des corps, écriture du
// fichier et journalisation injectées -> module pur, testé par node --test.

const test = require('node:test');
const assert = require('node:assert/strict');

const har = require('../lib/har.js');

const T0 = new Date(2026, 9, 25, 9, 0, 0).getTime(); // 25/10/2026 09:00 locale
const MIN = 60 * 1000;

// Horloge contrôlée : démarre à T0, avancer(ms) déplace le temps.
function horloge() {
  let t = T0;
  const f = () => t;
  f.avancer = (ms) => { t += ms; };
  f.maintenant = () => t;
  return f;
}

// Fabrique un enregistreur avec espions : fichiers écrits, journaux, corps.
function fabrique(opts) {
  const o = opts || {};
  const fichiers = [];
  const journaux = [];
  const corps = o.corps || {}; // requestId -> { body, base64Encoded } | Error
  const rec = har.creerEnregistreurHAR({
    maintenant: o.horloge || horloge().maintenant,
    lireCorps: (id) => {
      const c = corps[id];
      if (c instanceof Error) return Promise.reject(c);
      return Promise.resolve(c || null);
    },
    ecrireFichier: (chemin, contenu) => {
      fichiers.push({ chemin, contenu });
      if (o.echecEcriture) return Promise.reject(new Error(o.echecEcriture));
      return Promise.resolve();
    },
    creerDossier: () => o.echecDossier
      ? Promise.reject(new Error(o.echecDossier))
      : Promise.resolve(),
    construireChemin: (hote, ms) => '/tmp/har/' + har.nomFichier(hote, ms),
    journal: (niveau, message) => journaux.push([niveau, message])
  });
  return { rec, fichiers, journaux, corps };
}

// Événement CDP Network.requestWillBeSent « réaliste ».
function requeteEnvoyee(id, url, extras) {
  return {
    methode: 'Network.requestWillBeSent',
    params: Object.assign({
      requestId: id,
      type: 'Document',
      timestamp: 1.0,
      wallTime: T0 / 1000 + 60, // +60 s après T0 (epoch secondes)
      request: {
        url: url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'session=x' },
        postData: '{"cle": "valeur"}'
      }
    }, extras)
  };
}

function reponseRecue(id, extras) {
  return {
    methode: 'Network.responseReceived',
    params: Object.assign({
      requestId: id,
      timestamp: 1.5,
      type: 'Document',
      response: {
        url: 'https://exemple.fr/api',
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
        mimeType: 'application/json',
        protocol: 'http/1.1'
      }
    }, extras)
  };
}

function chargementTermine(id, ts, taille) {
  return {
    methode: 'Network.loadingFinished',
    params: { requestId: id, timestamp: ts, encodedDataLength: taille }
  };
}

// --- nomFichier --------------------------------------------------------------

test('nomFichier : hôte nettoyé + horodatage AAAAMMJJ-HHMMSS', () => {
  const nom = har.nomFichier('exemple.fr', T0);
  assert.match(nom, /^exemple\.fr-\d{8}-\d{6}\.har$/);
  assert.equal(nom.endsWith('.har'), true);
  // Hôte absent ou dangereux : remplacé.
  assert.equal(har.nomFichier('', T0).startsWith('inconnu-'), true);
  assert.equal(har.nomFichier('a b/c', T0).startsWith('a_b_c-'), true);
});

// --- Cycle nominal ------------------------------------------------------------

test('capture complète : démarrage, événements, finalisation, fichier HAR', async () => {
  const h = horloge();
  const { rec, fichiers, journaux } = fabrique({ horloge: h.maintenant });
  assert.equal(rec.demarrer({ hote: 'exemple.fr' }), true);
  // Double démarrage refusé.
  assert.equal(rec.demarrer({ hote: 'autre.fr' }), false);

  assert.equal(rec.notifier(requeteEnvoyee('r1', 'https://exemple.fr/parametrage?onglet=1')), 'enregistre');
  assert.equal(rec.notifier(reponseRecue('r1')), 'enregistre');
  assert.equal(rec.notifier(chargementTermine('r1', 2.0, 1500)), 'enregistre');

  const res = await rec.arreter();
  assert.deepEqual(res, {
    ecrit: true,
    fichier: '/tmp/har/exemple.fr-20261025-090000.har',
    entrees: 1
  });
  assert.equal(fichiers.length, 1);
  assert.equal(journaux.some(([, m]) => m.indexOf('démarrée') !== -1), true);
  assert.equal(journaux.some(([, m]) => m.indexOf('HAR écrit') !== -1), true);

  // Structure HAR 1.2.
  const harJson = JSON.parse(fichiers[0].contenu);
  assert.equal(harJson.log.version, '1.2');
  assert.equal(harJson.log.creator.name, 'IAO');
  assert.match(harJson.log.comment, /15 premières minutes/);
  assert.equal(harJson.log.entries.length, 1);
  const e = harJson.log.entries[0];
  assert.equal(e.request.method, 'POST');
  assert.equal(e.request.url, 'https://exemple.fr/parametrage?onglet=1');
  assert.deepEqual(e.request.queryString, [{ name: 'onglet', value: '1' }]);
  assert.deepEqual(e.request.headers, [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'Cookie', value: 'session=x' }
  ]);
  assert.equal(e.request.postData.text, '{"cle": "valeur"}');
  assert.equal(e.request.postData.mimeType, 'application/json');
  assert.equal(e.response.status, 200);
  assert.equal(e.response.statusText, 'OK');
  assert.equal(e.response.bodySize, 1500);
  assert.equal(e.response.content.size, 1500);
  assert.equal(e.response.content.mimeType, 'application/json');
  assert.equal(e.time, 1000); // (2.0 - 1.0) s
  assert.equal(e._resourceType, 'Document');
  assert.equal(JSON.stringify(e).indexOf('_tsDebut'), -1); // champ interne absent
  assert.equal(e.startedDateTime, new Date(T0 / 1000 * 1000 + 60000).toISOString());
});

test('arreter() est idempotent et renvoie le même résultat', async () => {
  const { rec } = fabrique();
  rec.demarrer({ hote: 'a.fr' });
  rec.notifier(requeteEnvoyee('r1', 'https://a.fr/x'));
  const r1 = await rec.arreter();
  const r2 = await rec.arreter();
  assert.deepEqual(r1, r2);
});

test('arreter() sans capture : erreur explicite, rien d\'écrit', async () => {
  const { rec, fichiers } = fabrique();
  const res = await rec.arreter();
  assert.equal(res.ecrit, false);
  assert.equal(res.erreur, 'aucune capture en cours');
  assert.equal(fichiers.length, 0);
});

// --- Corps de réponses ----------------------------------------------------------

test('corps de réponse : texte, base64, erreur de lecture, troncature', async () => {
  const gros = 'x'.repeat(har.MAX_OCTETS_CORPS + 10);
  const { rec, fichiers } = fabrique({
    corps: {
      'r-txt': { body: '{"ok": true}' },
      'r-b64': { body: 'PGh0bWw+', base64Encoded: true },
      'r-ko': new Error('session fermée'),
      'r-gros': { body: gros }
    }
  });
  rec.demarrer({ hote: 'exemple.fr' });
  for (const id of ['r-txt', 'r-b64', 'r-ko', 'r-gros']) {
    rec.notifier(requeteEnvoyee(id, 'https://exemple.fr/' + id));
    rec.notifier(reponseRecue(id));
    rec.notifier(chargementTermine(id, 2.0, 100));
  }
  await rec.arreter();
  const entries = JSON.parse(fichiers[0].contenu).log.entries;
  const par = {};
  entries.forEach((e) => { par[e.request.url.split('/').pop()] = e; });
  assert.equal(par['r-txt'].response.content.text, '{"ok": true}');
  assert.equal(par['r-txt'].response.content.encoding, undefined);
  assert.equal(par['r-b64'].response.content.text, 'PGh0bWw+');
  assert.equal(par['r-b64'].response.content.encoding, 'base64');
  assert.equal(par['r-ko'].response.content.text, undefined); // erreur ignorée
  assert.equal(par['r-gros'].response.content.text.length, har.MAX_OCTETS_CORPS);
  assert.match(par['r-gros'].response.content.comment, /tronqué/);
});

// --- Événements ignorés / erreurs -----------------------------------------------

test('événements hors périmètre ou inconnus : ignorés', () => {
  const { rec } = fabrique();
  assert.equal(rec.notifier({ methode: 'Network.requestWillBeSent', params: {} }), 'ignore');
  assert.equal(rec.notifier({ methode: 'Network.responseReceived', params: { requestId: 'x' } }), 'ignore');
  assert.equal(rec.notifier({ methode: 'Network.loadingFinished', params: { requestId: 'x' } }), 'ignore');
  assert.equal(rec.notifier({ methode: 'Network.loadingFailed', params: { requestId: 'x' } }), 'ignore');
  assert.equal(rec.notifier({ methode: 'Network.autreChose', params: { requestId: 'x' } }), 'ignore');
  assert.equal(rec.notifier(null), 'ignore');
  rec.demarrer({ hote: 'a.fr' });
  assert.equal(rec.notifier({ methode: 'Network.autreChose', params: { requestId: 'x' } }), 'ignore');
  // Événements sans capture démarrée : déjà couverts ci-dessus (ignore).
});

test('requête échouée : loadingFailed conserve le motif, pas de corps', async () => {
  const { rec, fichiers } = fabrique();
  rec.demarrer({ hote: 'echec.fr' });
  rec.notifier(requeteEnvoyee('r1', 'https://echec.fr/x'));
  rec.notifier({
    methode: 'Network.loadingFailed',
    params: { requestId: 'r1', errorText: 'net::ERR_CONNECTION_RESET' }
  });
  const res = await rec.arreter();
  assert.equal(res.ecrit, true);
  const e = JSON.parse(fichiers[0].contenu).log.entries[0];
  assert.equal(e.response.statusText, 'net::ERR_CONNECTION_RESET');
  assert.equal(e.response.status, 0);
});

test('redirection : deux requestWillBeSent sur le même requestId = 2 entrées', async () => {
  const { rec, fichiers } = fabrique();
  rec.demarrer({ hote: 'exemple.fr' });
  rec.notifier(requeteEnvoyee('r1', 'https://exemple.fr/login'));
  rec.notifier({
    methode: 'Network.requestWillBeSent',
    params: {
      requestId: 'r1',
      type: 'Document',
      timestamp: 2.0,
      wallTime: T0 / 1000 + 120,
      redirectResponse: { status: 302 },
      request: { url: 'https://exemple.fr/accueil', method: 'GET', headers: {} }
    }
  });
  rec.notifier(reponseRecue('r1'));
  const res = await rec.arreter();
  assert.equal(res.entrees, 2);
  const entries = JSON.parse(fichiers[0].contenu).log.entries;
  assert.equal(entries[1].request.url, 'https://exemple.fr/accueil');
  // La réponse est rattachée à la dernière entrée du requestId.
  assert.equal(entries[1].response.status, 200);
});

test('échec d\'écriture ou de création de dossier : rapporté, journalisé', async () => {
  const a = fabrique({ echecEcriture: 'disque plein' });
  a.rec.demarrer({ hote: 'a.fr' });
  a.rec.notifier(requeteEnvoyee('r1', 'https://a.fr/x'));
  const res = await a.rec.arreter();
  assert.equal(res.ecrit, false);
  assert.equal(res.erreur, 'disque plein');
  assert.equal(res.entrees, 1);
  assert.equal(a.journaux.some(([n]) => n === 'error'), true);

  const b = fabrique({ echecDossier: 'accès refusé' });
  b.rec.demarrer({ hote: 'b.fr' });
  const res2 = await b.rec.arreter();
  assert.equal(res2.ecrit, false);
  assert.equal(res2.erreur, 'accès refusé');
});

// --- Fenêtre de 15 minutes et quota ----------------------------------------------

test('fenêtre de 15 minutes : la capture se termine après expiration', async () => {
  const h = horloge();
  const { rec, journaux } = fabrique({ horloge: h.maintenant });
  rec.demarrer({ hote: 'exemple.fr' });
  assert.equal(rec.notifier(requeteEnvoyee('r1', 'https://exemple.fr/x')), 'enregistre');
  h.avancer(15 * MIN - 1);
  assert.equal(rec.notifier(requeteEnvoyee('r2', 'https://exemple.fr/y')), 'enregistre');
  h.avancer(2); // 15 min + 1 s écoulées
  assert.equal(rec.notifier(requeteEnvoyee('r3', 'https://exemple.fr/z')), 'termine');
  assert.equal(journaux.some(([, m]) => m.indexOf('fenêtre') !== -1), true);
  const res = await rec.arreter();
  assert.equal(res.ecrit, true);
  // Le dernier événement est enregistré avant la finalisation.
  assert.equal(res.entrees, 3);
  // Après 'termine' + arreter(), tout est ignoré.
  assert.equal(rec.notifier(requeteEnvoyee('r4', 'https://exemple.fr/w')), 'ignore');
});

test('quota d\'entrées : la capture se termine au-delà de MAX_ENTREES', async () => {
  const h = horloge();
  const { rec, journaux } = fabrique({ horloge: h.maintenant });
  rec.demarrer({ hote: 'quotas.fr' });
  let statut = 'enregistre';
  for (let i = 0; i < har.MAX_ENTREES; i++) {
    statut = rec.notifier(requeteEnvoyee('r' + i, 'https://quotas.fr/' + i));
  }
  assert.equal(statut, 'termine');
  assert.equal(journaux.some(([n]) => n === 'warning'), true);
  const res = await rec.arreter();
  assert.equal(res.entrees, har.MAX_ENTREES);
});

// --- Événements dégénérés (champs manquants) ------------------------------------

test('événements dégénérés : champs manquants, replis, erreur non-Error', async () => {
  const fichiers = [];
  const rec = har.creerEnregistreurHAR({
    // Horloge par défaut (Date.now) : démarrer() sans meta.
    ecrireFichier: (chemin, contenu) => { fichiers.push({ chemin, contenu }); return Promise.resolve(); },
    lireCorps: () => Promise.resolve({ body: 42 }), // corps non-chaîne : ignoré
    journal: () => {}
  });
  assert.equal(rec.demarrer(), true); // meta absente -> hôte « inconnu »
  assert.equal(rec.notifier(null), 'ignore'); // événement nul pendant la capture

  // requestWillBeSent minimal : pas de type, pas de wallTime, pas de timestamp,
  // pas de method, pas de postData, en-têtes absents, URL sans query.
  rec.notifier({
    methode: 'Network.requestWillBeSent',
    params: { requestId: 'd1', request: { url: 'https://x.fr/sans-query' } }
  });
  // responseReceived minimal : status 0, pas de mimeType/protocol/redirectURL.
  rec.notifier({
    methode: 'Network.responseReceived',
    params: { requestId: 'd1', response: {} }
  });
  // loadingFinished sans timestamp ni encodedDataLength.
  rec.notifier({ methode: 'Network.loadingFinished', params: { requestId: 'd1' } });
  // loadingFailed sans errorText ni type.
  rec.notifier({ methode: 'Network.loadingFailed', params: { requestId: 'd1' } });
  // URL illisible (requêteHAR catch) via une requête sans URL.
  rec.notifier({
    methode: 'Network.requestWillBeSent',
    params: { requestId: 'd2', type: 'Other', request: {} }
  });

  // requestWillBeSent sans requestId, avec postData mais sans en-têtes.
  assert.equal(rec.notifier({ methode: 'Network.requestWillBeSent', params: {} }), 'ignore');
  rec.notifier({
    methode: 'Network.requestWillBeSent',
    params: {
      requestId: 'd3', type: 'XHR',
      request: { url: 'https://x.fr/api', method: 'PUT', postData: '{"a":1}' }
    }
  });
  // Événements avec requestId inconnu après démarrage : ignorés.
  assert.equal(rec.notifier({ methode: 'Network.responseReceived', params: { requestId: 'absent' } }), 'ignore');
  assert.equal(rec.notifier({ methode: 'Network.loadingFinished', params: { requestId: 'absent' } }), 'ignore');
  assert.equal(rec.notifier({ methode: 'Network.loadingFailed', params: { requestId: 'absent', type: 'XHR' } }), 'ignore');
  // requestWillBeSent sans champ request : entrée vide mais valide.
  rec.notifier({ methode: 'Network.requestWillBeSent', params: { requestId: 'd4', type: 'Other' } });
  // responseReceived sans response (repli {}), puis avec redirectURL, puis
  // loadingFailed sans errorText mais avec type (après les responseReceived
  // pour ne pas être écrasé par le statusText vide du dernier).
  rec.notifier({ methode: 'Network.responseReceived', params: { requestId: 'd3' } });
  rec.notifier({
    methode: 'Network.responseReceived',
    params: { requestId: 'd3', response: { status: 301, redirectURL: 'https://x.fr/suivant' } }
  });
  rec.notifier({ methode: 'Network.loadingFailed', params: { requestId: 'd3', type: 'XHR' } });

  const res = await rec.arreter();
  assert.equal(res.ecrit, true);
  assert.equal(res.entrees, 4);
  const entries = JSON.parse(fichiers[0].contenu).log.entries;
  assert.equal(entries[0]._resourceType, 'other');
  assert.equal(entries[0].request.method, 'GET');
  assert.equal(entries[0].request.url, 'https://x.fr/sans-query');
  assert.deepEqual(entries[0].request.queryString, []);
  assert.deepEqual(entries[0].request.headers, []);
  assert.equal(entries[0].response.status, 0);
  assert.equal(entries[0].time, -1); // pas de timestamp de fin
  assert.equal(entries[1].request.url, '');
  assert.deepEqual(entries[3].request.headers, []);
  assert.equal(entries[3].request.method, 'GET');
  assert.equal(entries[2].request.postData.text, '{"a":1}');
  assert.equal(entries[2].request.postData.mimeType, '');
  assert.equal(entries[2].response.statusText, 'XHR');
  assert.equal(entries[2].response.status, 301);
  assert.equal(entries[2].response.redirectURL, 'https://x.fr/suivant');
  assert.match(fichiers[0].chemin, /^inconnu-/);
});

test('échec d\'écriture non-Error : message replié sur String(e)', async () => {
  const rec = har.creerEnregistreurHAR({
    ecrireFichier: () => Promise.reject('panne disque'),
    journal: () => {}
  });
  rec.demarrer({ hote: 'a.fr' });
  const res = await rec.arreter();
  assert.equal(res.ecrit, false);
  assert.equal(res.erreur, 'panne disque');
});

// --- Dépendances par défaut -------------------------------------------------------

test('valeurs par défaut : nomFichier comme chemin, pas d\'horloge injectée', async () => {
  // Sans aucun argument : chemin par défaut nomFichier (chemin relatif),
  // lecture de corps null, écriture réussie.
  const rec = har.creerEnregistreurHAR();
  rec.demarrer({ hote: 'defaut.fr' });
  rec.notifier(requeteEnvoyee('r1', 'https://defaut.fr/x'));
  rec.notifier(chargementTermine('r1', 2, 10));
  const res = await rec.arreter();
  assert.equal(res.ecrit, true);
  assert.match(res.fichier, /^defaut\.fr-\d{8}-\d{6}\.har$/);
});
