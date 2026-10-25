'use strict';

// lib/har.js — issue #305 : enregistrement HAR des 15 premières minutes d'une
// connexion à un compte IA. But : capturer le trafic réseau (requêtes, en-têtes,
// corps de réponses) au moment où l'utilisateur configure skills et connecteurs,
// pour pouvoir rejouer cette configuration plus tard.
//
// Fonctions PURES (invariant 11, CLAUDE.md) : aucune dépendance à Electron ni au
// DOM -> testable par `node --test`. Le câblage réel (CDP via le débogueur du
// webContents, écriture disque) vit dans main.js et injecte ses dépendances :
// horloge (`maintenant`), lecture des corps (`lireCorps`), écriture du fichier
// (`ecrireFichier`), création du dossier (`creerDossier`), journal (`journal`).
//
// Source des événements : Chrome DevTools Protocol, domaine Network. Le webview
// diffuse `Network.requestWillBeSent` / `Network.responseReceived` /
// `Network.loadingFinished` / `Network.loadingFailed` ; les corps de réponses
// sont relus à la finalisation via `Network.getResponseBody` (injecté ici sous
// le nom `lireCorps`).

// --- Constantes de capture --------------------------------------------------

// Durée de la capture : 15 minutes à partir de l'ouverture du webview.
var DUREE_CAPTURE_MS = 15 * 60 * 1000;
// Nombre maximum d'entrées (requêtes) enregistrées : au-delà, la capture
// s'arrête (un onglet très bavard ne doit pas remplir le disque).
var MAX_ENTREES = 2000;
// Taille maximum d'un corps de réponse conservé (octets de la chaîne) :
// au-delà, le corps est tronqué et signalé.
var MAX_OCTETS_CORPS = 512 * 1024;

// Construit le nom de fichier HAR : <hote>-<AAAAMMJJ-HHMMSS>.har
// (hote = hôte de la première URL, sans caractères dangereux pour le système
// de fichiers ; horodatage injecté pour rester testable).
function nomFichier(hote, horodatageMs) {
  var h = String(hote || 'inconnu').replace(/[^a-zA-Z0-9.-]+/g, '_');
  var d = new Date(horodatageMs);
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  var stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
    '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  return h + '-' + stamp + '.har';
}

// Convertit un objet d'en-têtes CDP ({ nom: valeur }) en tableau HAR.
function enTetesHAR(enTetes) {
  var liste = [];
  if (enTetes && typeof enTetes === 'object') {
    Object.keys(enTetes).forEach(function (nom) {
      liste.push({ name: nom, value: String(enTetes[nom]) });
    });
  }
  return liste;
}

// Convertit la chaîne de requête d'une URL en tableau HAR.
function requeteHAR(url) {
  var liste = [];
  try {
    var u = new URL(String(url));
    u.searchParams.forEach(function (valeur, nom) {
      liste.push({ name: nom, value: valeur });
    });
  } catch (_) { /* URL illisible : pas de query string */ }
  return liste;
}

// Convertit des secondes epoch (wallTime CDP) en ISO 8601 ; repli sur
// l'horodatage injecté si absent/invalid.
function versISO(secondesEpoch, repliMs) {
  var ms = repliMs;
  if (typeof secondesEpoch === 'number' && isFinite(secondesEpoch) && secondesEpoch > 0) {
    ms = secondesEpoch * 1000;
  }
  return new Date(ms).toISOString();
}

// Crée une entrée HAR à partir d'un événement Network.requestWillBeSent.
// Redirections : le CDP reprend le même requestId avec redirectResponse —
// chaque requestWillBeSent crée une NOUVELLE entrée (comportement HAR usuel).
function creerEntree(params, repliMs) {
  var req = params.request || {};
  var entree = {
    _resourceType: params.type ? String(params.type) : 'other',
    // Horodatage CDP (secondes, relatif au débogueur) : non énumérable pour
    // rester hors du JSON final, utilisé pour calculer la durée totale.
    // (posé ci-dessous via defineProperty)
    startedDateTime: versISO(params.wallTime, repliMs),
    time: -1,
    request: {
      method: req.method || 'GET',
      url: String(req.url || ''),
      httpVersion: 'HTTP/1.1',
      headers: enTetesHAR(req.headers),
      queryString: requeteHAR(req.url),
      cookies: [],
      headersSize: -1,
      bodySize: -1
    },
    response: {
      status: 0,
      statusText: '',
      httpVersion: 'HTTP/1.1',
      headers: [],
      cookies: [],
      content: { size: 0, mimeType: '' },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1
    },
    cache: {},
    timings: { send: -1, wait: -1, receive: -1 }
  };
  if (typeof req.postData === 'string' && req.postData.length > 0) {
    entree.request.postData = {
      mimeType: (req.headers && req.headers['Content-Type']) || '',
      text: req.postData.slice(0, MAX_OCTETS_CORPS)
    };
  }
  Object.defineProperty(entree, '_tsDebut', {
    value: (typeof (params && params.timestamp) === 'number') ? params.timestamp : null,
    enumerable: false,
    writable: true
  });
  return entree;
}

// Crée un enregistreur HAR. Toutes les dépendances sont injectées :
//   maintenant()  -> nombre, horloge (ms epoch)
//   lireCorps(requeteId) -> Promise<{ body, base64Encoded } | null>
//   ecrireFichier(chemin, contenu) -> Promise<void>
//   creerDossier(chemin) -> Promise<void> (mkdir recursive)
//   journal(niveau, message) -> journalisation (loguru côté main.js)
//   construireChemin(hote, horodatageMs) -> chemin du fichier .har
function creerEnregistreurHAR(options) {
  var opts = options || {};
  var maintenant = opts.maintenant || function () { return Date.now(); };
  var lireCorps = opts.lireCorps || function () { return Promise.resolve(null); };
  var ecrireFichier = opts.ecrireFichier || function () { return Promise.resolve(); };
  var creerDossier = opts.creerDossier || function () { return Promise.resolve(); };
  var construireChemin = opts.construireChemin ||
    function (hote, ms) { return nomFichier(hote, ms); };
  var journal = opts.journal || function () {};

  // État : null quand aucune capture n'est en cours.
  var etat = null;

  function demarrer(meta) {
    if (etat) return false;
    var m = meta || {};
    var debut = maintenant();
    etat = {
      hote: String(m.hote || 'inconnu'),
      debut: debut,
      fin: debut + DUREE_CAPTURE_MS,
      entrees: [],
      dernieres: {},   // requestId -> dernière entrée créée pour cet id
      corps: {},        // requestId -> { body, base64Encoded }
      termine: false,
      resultat: null
    };
    journal('info', 'capture HAR démarrée (' + m.hote + '), ' +
      (DUREE_CAPTURE_MS / 60000) + ' min max');
    return true;
  }

  // Traite un événement CDP { methode, params }. Renvoie :
  //   'ignore'     : capture non démarrée, déjà terminée, ou méthode hors périmètre
  //   'enregistre' : événement pris en compte
  //   'termine'    : événement pris en compte PUIS la capture est arrivée à son
  //                  terme (fenêtre de 15 min écoulée ou MAX_ENTREES atteint) —
  //                  l'appelant doit alors appeler arreter().
  function notifier(evenement) {
    if (!etat || etat.termine) return 'ignore';
    var ev = evenement || {};
    var params = ev.params || {};
    var idRequete = params.requestId;

    switch (ev.methode) {
      case 'Network.requestWillBeSent':
        if (!idRequete) return 'ignore';
        var entree = creerEntree(params, etat.debut);
        etat.entrees.push(entree);
        etat.dernieres[idRequete] = entree;
        break;
      case 'Network.responseReceived':
        var cible = etat.dernieres[idRequete];
        if (!cible) return 'ignore';
        var rep = params.response || {};
        cible.response.status = rep.status || 0;
        cible.response.statusText = String(rep.statusText || '');
        cible.response.headers = enTetesHAR(rep.headers);
        if (rep.mimeType) cible.response.content.mimeType = String(rep.mimeType);
        if (rep.protocol) cible.response.httpVersion = String(rep.protocol);
        if (typeof rep.redirectURL === 'string') cible.response.redirectURL = rep.redirectURL;
        break;
      case 'Network.loadingFinished':
        var finie = etat.dernieres[idRequete];
        if (!finie) return 'ignore';
        if (typeof params.encodedDataLength === 'number') {
          finie.response.bodySize = params.encodedDataLength;
          finie.response.content.size = params.encodedDataLength;
        }
        if (typeof params.timestamp === 'number' && typeof finie._tsDebut === 'number') {
          finie.time = Math.max(0, Math.round((params.timestamp - finie._tsDebut) * 1000));
        }
        etat.corps[idRequete] = true; // corps à relire à la finalisation
        break;
      case 'Network.loadingFailed':
        var ratee = etat.dernieres[idRequete];
        if (!ratee) return 'ignore';
        ratee.response.statusText = String(params.errorText || params.type || 'erreur réseau');
        break;
      default:
        return 'ignore';
    }

    // Fin de capture : fenêtre écoulée (vérifiée paresseusement à chaque
    // événement) ou quota d'entrées atteint.
    if (maintenant() >= etat.fin) {
      journal('info', 'fenêtre de 15 minutes écoulée, capture à finaliser');
      return 'termine';
    }
    if (etat.entrees.length >= MAX_ENTREES) {
      journal('warning', 'quota de ' + MAX_ENTREES + ' entrées atteint, capture à finaliser');
      return 'termine';
    }
    return 'enregistre';
  }

  // Finalise la capture : relit les corps des réponses terminées, construit le
  // HAR 1.2 et l'écrit sur le disque. Idempotent : les appels suivants
  // renvoient le premier résultat. Renvoie { ecrit, fichier?, entrees, erreur? }.
  async function arreter() {
    if (etat && etat.resultat) return etat.resultat;
    if (!etat) return { ecrit: false, entrees: 0, erreur: 'aucune capture en cours' };
    etat.termine = true;
    var resultat;
    var chemin = construireChemin(etat.hote, etat.debut);
    try {
      // Corps de réponses (au mieux : une erreur de lecture est ignorée, le
      // HAR garde les métadonnées sans le corps).
      var ids = Object.keys(etat.corps);
      for (var i = 0; i < ids.length; i++) {
        try {
          var corps = await lireCorps(ids[i]);
          if (corps && typeof corps.body === 'string') {
            // dernieres[ids[i]] existe toujours (etat.corps n'est rempli qu'après
            // un requestWillBeSent pour ce requestId).
            var cible = etat.dernieres[ids[i]];
            var tronque = corps.body.length > MAX_OCTETS_CORPS;
            cible.response.content.text = tronque
              ? corps.body.slice(0, MAX_OCTETS_CORPS) : corps.body;
            if (tronque) cible.response.content.comment =
              'corps tronqué (' + corps.body.length + ' octets)';
            if (corps.base64Encoded) cible.response.content.encoding = 'base64';
          }
        } catch (_) { /* corps illisible : HAR sans ce corps */ }
      }
      var har = {
        log: {
          version: '1.2',
          creator: { name: 'IAO', version: 'issue #305' },
          comment: '15 premières minutes de la connexion — rejouer la ' +
            'configuration des skills et connecteurs',
          entries: etat.entrees
        }
      };
      await creerDossier(chemin);
      await ecrireFichier(chemin, JSON.stringify(har));
      resultat = { ecrit: true, fichier: chemin, entrees: etat.entrees.length };
      journal('info', 'HAR écrit : ' + chemin + ' (' + etat.entrees.length + ' entrées)');
    } catch (e) {
      resultat = { ecrit: false, fichier: chemin, entrees: etat.entrees.length,
        erreur: e && e.message ? e.message : String(e) };
      journal('error', 'échec d\'écriture du HAR : ' + resultat.erreur);
    }
    etat.resultat = resultat;
    return resultat;
  }

  return {
    demarrer: demarrer,
    notifier: notifier,
    arreter: arreter,
    DUREE_CAPTURE_MS: DUREE_CAPTURE_MS,
    MAX_ENTREES: MAX_ENTREES,
    MAX_OCTETS_CORPS: MAX_OCTETS_CORPS
  };
}

module.exports = {
  creerEnregistreurHAR: creerEnregistreurHAR,
  nomFichier: nomFichier,
  DUREE_CAPTURE_MS: DUREE_CAPTURE_MS,
  MAX_ENTREES: MAX_ENTREES,
  MAX_OCTETS_CORPS: MAX_OCTETS_CORPS
};
