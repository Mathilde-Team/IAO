'use strict';

// lib/mail-api.js — client de l'API mail-accounts-api (issue #357).
//
// Création et modification des comptes de messagerie via l'API REST du dépôt
// Mathilde-Team/mail-accounts-api (docker-mailserver) : POST /accounts,
// POST /accounts/batch, PATCH /accounts/{email}. PUR : `fetchFn` est injecté
// (fetch global du process principal), aucune dépendance à Electron ni au
// DOM -> testé par `node --test` (invariant 11, CLAUDE.md).
//
// Les résultats sont structurés pour l'interface (notifications) :
//   { ok: true,  statut: 'cree' | 'existant' | 'modifie' | 'melange', ... }
//   { ok: false, statut: 'cle' | 'invalide' | 'stockage' | 'absent' | 'reseau' | 'lot' }
// La clé d'API et le mot de passe ne sont JAMAIS journalisés ici ; l'appelant
// (process principal) ne les remet qu'au coffre ou à la requête.

// Une requête de lot de l'API est limitée à 100 comptes (contrat du serveur).
const LOT_MAX = 100;

// URL de base de l'API : schéma http(s) obligatoire (l'API peut être locale),
// slashs finaux retirés. Renvoie '' si l'URL est inexploitable.
function normaliserUrlApi(url) {
  if (typeof url !== 'string') return '';
  const u = url.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return '';
  return u.replace(/\/+$/, '');
}

// Domaine d'une adresse (partie après le dernier @), en minuscules ; null
// si l'adresse n'a pas de domaine exploitable.
function domaineDeEmail(email) {
  if (typeof email !== 'string') return null;
  const i = email.lastIndexOf('@');
  if (i < 1 || i === email.length - 1) return null;
  return email.slice(i + 1).toLowerCase();
}

// Vrai si l'adresse appartient au domaine des réglages (comparaison en
// minuscules) : seule condition pour tenter la création via l'API.
function domaineCorrespond(email, domaine) {
  const d = domaineDeEmail(email);
  return !!d && typeof domaine === 'string' && d === domaine.trim().toLowerCase();
}

// Traduit un code HTTP de l'API en statut structuré ; null si le code
// n'appelle pas de traduction particulière (succès ou cas géré ailleurs).
function statutErreur(statutHttp) {
  if (statutHttp === 401) return 'cle';
  if (statutHttp === 422) return 'invalide';
  if (statutHttp === 503) return 'stockage';
  if (statutHttp === 404) return 'absent';
  if (statutHttp === 409) return 'existant';
  return 'reseau';
}

// Appel JSON à l'API ; renvoie { statutHttp, corps } ou { erreur: 'reseau' }.
// Le corps de la réponse est lu sans foi : un JSON illisible devient {}.
async function appelApi(fetchFn, urlApi, cle, chemin, options) {
  let reponse;
  try {
    reponse = await fetchFn(urlApi + chemin, {
      method: options.method,
      headers: { 'Authorization': 'Bearer ' + cle, 'Content-Type': 'application/json' },
      body: JSON.stringify(options.corps)
    });
  } catch (_) {
    return { erreur: 'reseau' };
  }
  let corps = {};
  try {
    const texte = await reponse.text();
    if (texte) corps = JSON.parse(texte);
  } catch (_) { /* corps non JSON : seules les erreurs portent un détail */ }
  return { statutHttp: reponse.status, corps };
}

// Crée un compte sur le serveur de messagerie. `motDePasse` facultatif : sans
// mot de passe, le serveur en génère un et ne le renvoie QUE dans la réponse
// de création (201) — il est alors remis à l'appelant pour le coffre.
// Si le compte existe déjà (409) et qu'un mot de passe est fourni, il est
// changé (PATCH) : « l'ajout d'un mot de passe fait un changement de mot de
// passe » (issue #357).
async function creerCompte({ fetchFn, urlApi, cle, email, motDePasse }) {
  const r = await appelApi(fetchFn, urlApi, cle, '/accounts', {
    method: 'POST',
    corps: { email, password: motDePasse || undefined }
  });
  if (r.erreur) return { ok: false, statut: 'reseau' };
  if (r.statutHttp === 201) {
    const genere = r.corps && typeof r.corps.password === 'string' ? r.corps.password : null;
    return { ok: true, statut: 'cree', motDePasseGenere: genere };
  }
  if (r.statutHttp === 409 && motDePasse) return changerMotDePasse({ fetchFn, urlApi, cle, email, motDePasse });
  if (r.statutHttp === 409) return { ok: true, statut: 'existant' };
  return { ok: false, statut: statutErreur(r.statutHttp), detail: detailDe(r.corps) };
}

// Change le mot de passe d'un compte existant (PATCH /accounts/{email}).
// Le mot de passe n'est jamais renvoyé par l'API : seul le statut compte.
async function changerMotDePasse({ fetchFn, urlApi, cle, email, motDePasse }) {
  const r = await appelApi(fetchFn, urlApi, cle, '/accounts/' + encodeURIComponent(email), {
    method: 'PATCH',
    corps: { password: motDePasse }
  });
  if (r.erreur) return { ok: false, statut: 'reseau' };
  if (r.statutHttp >= 200 && r.statutHttp < 300) return { ok: true, statut: 'modifie' };
  return { ok: false, statut: statutErreur(r.statutHttp), detail: detailDe(r.corps) };
}

// Crée un lot de comptes (POST /accounts/batch, transaction atomique côté
// serveur). En cas de doublon dans le lot ou de compte déjà existant (409),
// le lot est refusé ENTIER : on retente alors compte par compte pour créer
// les manquants et signaler les existants.
async function creerLot({ fetchFn, urlApi, cle, comptes }) {
  const liste = (Array.isArray(comptes) ? comptes : []).slice(0, LOT_MAX);
  if (!liste.length) return { ok: false, statut: 'lot' };
  const r = await appelApi(fetchFn, urlApi, cle, '/accounts/batch', {
    method: 'POST',
    corps: { accounts: liste.map((c) => ({ email: c.email, password: c.motDePasse || undefined })) }
  });
  if (r.erreur) return { ok: false, statut: 'reseau' };
  if (r.statutHttp === 201) return { ok: true, statut: 'cree', nombre: liste.length };
  if (r.statutHttp === 409) {
    // Rattrapage unitaire : le lot atomique a été refusé, chaque compte est
    // traité séparément (création, ou changement de mot de passe si fourni).
    const detail = [];
    const creesListe = [], modifieesListe = [];
    let existants = 0, echecs = 0;
    for (const c of liste) {
      const un = await creerCompte({ fetchFn, urlApi, cle, email: c.email, motDePasse: c.motDePasse });
      if (un.ok && un.statut === 'cree') {
        creesListe.push(c.email);
        if (un.motDePasseGenere) detail.push({ email: c.email, motDePasseGenere: un.motDePasseGenere });
        continue;
      }
      if (un.ok && un.statut === 'existant') { existants++; continue; }
      if (un.ok && un.statut === 'modifie') { modifieesListe.push(c.email); continue; }
      echecs++;
    }
    return {
      ok: true, statut: 'melange',
      crees: creesListe.length, existants, modifies: modifieesListe.length, echecs,
      creesListe, modifieesListe, motsDePasseGeneres: detail
    };
  }
  return { ok: false, statut: statutErreur(r.statutHttp), detail: detailDe(r.corps) };
}

// Détail d'erreur du serveur (champ `detail` de FastAPI), borné pour l'UI.
function detailDe(corps) {
  const d = corps && typeof corps.detail === 'string' ? corps.detail : '';
  return d.slice(0, 200);
}

var iaoMailApi = {
  LOT_MAX, normaliserUrlApi, domaineDeEmail, domaineCorrespond,
  creerCompte, creerLot, changerMotDePasse
};
if (typeof window !== 'undefined') window.iaoMailApi = iaoMailApi; // non utilisé côté renderer (CSP)
else module.exports = iaoMailApi;
