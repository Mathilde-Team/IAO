'use strict';

// lib/webmail-codes.js — codes et liens de connexion reçus par mail (issue #310,
// relecture du 26/10/2026) : « si on ouvre le webmail dans une fenêtre IAO,
// peut-on capter les mails reçus des comptes et afficher le code à 6 chiffres
// dans la bannière sous l'onglet ? Mieux encore : renvoyer automatiquement
// après 3 s le lien de connexion ».
//
// Tant que la fenêtre du webmail d'un compte est ouverte (session Roundcube du
// compte, partition persist:<profil>), le process principal relève toutes les
// 10 s les derniers messages de la boîte de réception, DANS cette fenêtre
// (requêtes Roundcube de la page elle-même : aucun mot de passe ni cookie ne
// sort de la fenêtre). Chaque nouveau message est analysé ici :
//   - expéditeur d'un domaine connu d'un service d'IA (sinon ignoré) ;
//   - reçu il y a moins de 15 minutes (les codes vivent 5 minutes) ;
//   - code à 6 chiffres hors des liens, de préférence près du mot « code » ;
//   - lien de connexion https vers un domaine DU MÊME service uniquement.
//
// Module pur : analyse MIME minimale (multipart, quoted-printable, base64,
// en-têtes RFC 2047), sans dépendance. Le relevé (script de page, minuterie,
// file d'attente vers l'interface) est en bas, avec ses dépendances injectées.

const FRAICHEUR_MS = 15 * 60 * 1000;
const SOURCE_MAX = 256 * 1024;
const PROFONDEUR_MAX = 5;

// Domaines d'expédition et de lien par service (identifiants de assets/app.js).
// Le premier domaine est celui du service, les suivants ceux de ses mails
// (Claude écrit depuis anthropic.com, ChatGPT depuis openai.com…).
const DOMAINES = {
  claude: ['claude.ai', 'anthropic.com'],
  chatgpt: ['chatgpt.com', 'openai.com'],
  gemini: ['gemini.google.com', 'accounts.google.com'],
  zeta: ['z.ai'],
  perplexity: ['perplexity.ai'],
  grok: ['grok.com', 'x.ai'],
  leonardo: ['leonardo.ai'],
  suno: ['suno.com'],
  meshy: ['meshy.ai'],
  mistral: ['mistral.ai'],
  deepseek: ['deepseek.com'],
  copilot: ['github.com'],
  elicit: ['elicit.com'],
  notebooklm: ['notebooklm.google.com', 'accounts.google.com'],
  wolfram: ['wolframalpha.com', 'wolfram.com'],
  deepl: ['deepl.com'],
  ideogram: ['ideogram.ai'],
  kling: ['klingai.com'],
  runway: ['runwayml.com'],
  pika: ['pika.art'],
  qwen: ['qwen.ai', 'alibabacloud.com']
};

// Mots qui signalent un lien de connexion (chemin ou paramètres).
const RE_LIEN_CONNEXION = /(auth|callback|verif|magic|login|log-in|signin|sign-in|confirm|token|code|otp)/i;

// --- Décodage ---------------------------------------------------------------

function versTexte(octets, charset) {
  const cs = String(charset || 'utf-8').toLowerCase();
  if (cs === 'iso-8859-1' || cs === 'latin1' || cs === 'us-ascii' || cs === 'windows-1252') {
    return octets.toString('latin1');
  }
  return octets.toString('utf8');
}

function decoderQP(texte) {
  const sansCoupures = texte.replace(/=\r?\n/g, '');
  const octets = [];
  for (let i = 0; i < sansCoupures.length; i++) {
    const c = sansCoupures[i];
    const hex = sansCoupures.slice(i + 1, i + 3);
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      octets.push(parseInt(hex, 16));
      i += 2;
    } else {
      octets.push(...Buffer.from(c, 'utf8'));
    }
  }
  return Buffer.from(octets);
}

// En-tête RFC 2047 : =?charset?B|Q?texte?=
function decoderEntete(valeur) {
  // Espaces entre deux mots encodés adjacents : ignorés (RFC 2047 §6.2).
  return String(valeur || '').replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs, enc, txt) => {
      const octets = enc.toUpperCase() === 'B'
        ? Buffer.from(txt, 'base64')
        : decoderQP(txt.replace(/_/g, ' '));
      return versTexte(octets, cs);
    });
}

function entites(texte) {
  const nommees = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    const v = nommees[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// HTML -> texte + liens des href (le texte d'un bouton « Se connecter » ne
// contient pas l'URL : on la garde à part).
function htmlVersTexte(html) {
  const liens = [];
  html.replace(/href\s*=\s*["']([^"']+)["']/gi, (_m, u) => { liens.push(entites(u)); return ''; });
  const texte = entites(html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
  return { texte, liens };
}

function separerEntetes(brut) {
  const m = /\r?\n\r?\n/.exec(brut);
  const tete = m ? brut.slice(0, m.index) : brut;
  const corps = m ? brut.slice(m.index + m[0].length) : '';
  const entetes = {};
  for (const ligne of tete.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = ligne.indexOf(':');
    if (i <= 0) continue;
    const nom = ligne.slice(0, i).trim().toLowerCase();
    if (!(nom in entetes)) entetes[nom] = ligne.slice(i + 1).trim();
  }
  return { entetes, corps };
}

function parametre(valeur, nom) {
  const m = new RegExp('(?:^|;)\\s*' + nom + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]*))', 'i').exec(valeur || '');
  return m ? (m[1] !== undefined ? m[1] : m[2]) : '';
}

// Parties texte d'un message : [{ type: 'plain'|'html', texte }].
function partiesTexte(brut, profondeur = 0) {
  const { entetes, corps } = separerEntetes(brut);
  const type = (entetes['content-type'] || 'text/plain').toLowerCase();
  if (type.startsWith('multipart/')) {
    const limite = parametre(entetes['content-type'], 'boundary');
    if (!limite || profondeur >= PROFONDEUR_MAX) return [];
    const morceaux = corps.split('--' + limite);
    const parties = [];
    for (const morceau of morceaux.slice(1)) {
      if (morceau.startsWith('--')) break;
      parties.push(...partiesTexte(morceau.replace(/^\r?\n/, ''), profondeur + 1));
    }
    return parties;
  }
  if (!type.startsWith('text/plain') && !type.startsWith('text/html')) return [];
  const enc = (entetes['content-transfer-encoding'] || '').toLowerCase();
  const octets = enc === 'base64' ? Buffer.from(corps.replace(/\s+/g, ''), 'base64')
    : enc === 'quoted-printable' ? decoderQP(corps)
      : Buffer.from(corps, 'latin1');
  const texte = versTexte(octets, parametre(entetes['content-type'], 'charset'));
  return [{ type: type.startsWith('text/html') ? 'html' : 'plain', texte }];
}

// --- Analyse ----------------------------------------------------------------

function domaineAppartient(hote, domaine) {
  return hote === domaine || hote.endsWith('.' + domaine);
}

function serviceDeExpediteur(de) {
  const m = /@([A-Za-z0-9.-]+)\s*>?\s*$/.exec(String(de || '').trim());
  if (!m) return null;
  const hote = m[1].toLowerCase();
  // Domaine du service ou sous-domaine d'envoi (mail.perplexity.ai,
  // emails.mistral.ai, mail.anthropic.com) ; le premier service l'emporte
  // pour un domaine partagé (accounts.google.com : Gemini).
  for (const [id, doms] of Object.entries(DOMAINES)) {
    if (doms.some(d => domaineAppartient(hote, d))) return id;
  }
  return null;
}

function nettoyerLien(u) {
  return u.replace(/[\])>.,;'"]+$/, '');
}

function lienDuService(liens, service) {
  const doms = DOMAINES[service];
  for (const brut of liens) {
    let url;
    try { url = new URL(nettoyerLien(brut)); } catch (_) { continue; }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    const hote = url.hostname.toLowerCase();
    if (!doms.some(d => domaineAppartient(hote, d))) continue;
    if (!RE_LIEN_CONNEXION.test(url.pathname + url.search + url.hash)) continue;
    return url.href;
  }
  return '';
}

const RE_URL = /https?:\/\/[^\s<>"'\]]+/gi;
const RE_CODE = /(?<![\w#/=%.@-])(\d{6})(?![\w%@-])/g;

function codeDans(texte) {
  const propre = texte.replace(RE_URL, ' ').replace(/[\w.+-]+@[\w.-]+/g, ' ');
  const trouves = [];
  let m;
  RE_CODE.lastIndex = 0;
  while ((m = RE_CODE.exec(propre)) !== null) trouves.push({ code: m[1], index: m.index });
  if (trouves.length === 0) return '';
  // Le premier précédé de près (400 caractères) par « code » ou « vérification ».
  const positions = [];
  const mot = /(code|v[ée]rification|otp)/gi;
  let mm;
  while ((mm = mot.exec(propre)) !== null) positions.push(mm.index);
  const proche = trouves.find(t => positions.some(p => p < t.index && t.index - p < 400));
  return (proche || trouves[0]).code;
}

// Analyse d'un message brut. Renvoie null si le message n'est pas un mail de
// connexion récent d'un service connu.
//   { service, code, lien, sujet, recuA }
function analyserMail(source, maintenant) {
  if (typeof source !== 'string' || source.length === 0) return null;
  const brut = source.length > SOURCE_MAX ? source.slice(0, SOURCE_MAX) : source;
  const { entetes } = separerEntetes(brut);
  const service = serviceDeExpediteur(decoderEntete(entetes.from));
  if (!service) return null;
  const recuA = Date.parse(entetes.date || '');
  if (!Number.isFinite(recuA) || maintenant - recuA > FRAICHEUR_MS || recuA - maintenant > FRAICHEUR_MS) return null;
  const sujet = decoderEntete(entetes.subject).slice(0, 200);
  const textes = [];
  const liens = [];
  for (const p of partiesTexte(brut)) {
    if (p.type === 'html') {
      const h = htmlVersTexte(p.texte);
      textes.push(h.texte);
      liens.push(...h.liens);
    } else {
      textes.unshift(p.texte); // texte brut d'abord
      liens.unshift(...(p.texte.match(RE_URL) || []));
    }
  }
  const code = codeDans(sujet) || textes.map(codeDans).find(Boolean) || '';
  const lien = lienDuService(liens, service);
  if (!code && !lien) return null;
  return { service, code, lien, sujet, recuA };
}

// --- Relevé dans la fenêtre du webmail -------------------------------------

// Script exécuté dans la page Roundcube (session du compte). Liste la première
// page de la boîte de réception (requête AJAX de Roundcube, jeton de la page)
// et renvoie la source des messages plus récents que `apresUid` (5 au plus).
//   { etat: 'hors-session' } : pas de session Roundcube (page de connexion) ;
//   { etat: 'ok', max, messages: [{ uid, source }] }.
function scriptReleve(apresUid) {
  const apres = Number.isInteger(apresUid) && apresUid > 0 ? apresUid : 0;
  return `(async () => {
  const rc = window.rcmail;
  if (!rc || !rc.env || !rc.env.request_token || rc.env.task === 'login') return { etat: 'hors-session' };
  const base = location.pathname.replace(/[^/]*$/, '');
  const r = await fetch(base + '?_task=mail&_action=list&_mbox=INBOX&_page=1&_remote=1', {
    credentials: 'same-origin', headers: { 'X-Roundcube-Request': rc.env.request_token }
  });
  const j = await r.json();
  const tous = [...String(j.exec || '').matchAll(/add_message_row\\((\\d+)/g)].map(m => Number(m[1]));
  const max = tous.reduce((a, b) => Math.max(a, b), ${apres});
  const nouveaux = tous.filter(u => u > ${apres}).sort((a, b) => b - a).slice(0, 5);
  const messages = [];
  for (const uid of nouveaux) {
    const s = await fetch(base + '?_task=mail&_mbox=INBOX&_uid=' + uid + '&_action=viewsource', { credentials: 'same-origin' });
    messages.push({ uid, source: (await s.text()).slice(0, ${SOURCE_MAX}) });
  }
  return { etat: 'ok', max, messages };
})()`;
}

// Relève périodiquement les mails d'une fenêtre de webmail.
//   wc : webContents de la fenêtre (executeJavaScript) ;
//   profil : compte ; signaler(evenement) : file vers l'interface ;
//   journal(niveau, message), debug(message) ; horloge, minuterie injectées.
// Renvoie { relever, arreter } (relever() exposé pour les tests).
//   actif() : faux tant que la page n'est pas celle du webmail (aucun relevé).
function creerReleveur({ wc, profil, signaler, journal = () => {}, debug = () => {}, actif = () => true,
  maintenant = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval, periodeMs = 10000 }) {
  let dernierUid = 0;
  let enCours = false;
  let etatPrecedent = '';
  const dejaSignales = new Set();
  async function relever() {
    if (enCours) return 'occupe';
    if (!actif()) return 'inactif';
    enCours = true;
    const resultat = await releverUneFois();
    enCours = false;
    return resultat;
  }
  async function releverUneFois() {
    try {
      const res = await wc.executeJavaScript(scriptReleve(dernierUid));
      const etat = res && res.etat === 'ok' ? 'ok' : 'hors-session';
      if (etat !== etatPrecedent) {
        debug('Webmail : relevé des codes pour « ' + profil + ' » : ' + etat + '.');
        etatPrecedent = etat;
      }
      if (etat !== 'ok') return etat;
      if (Number.isInteger(res.max) && res.max > dernierUid) dernierUid = res.max;
      for (const m of Array.isArray(res.messages) ? res.messages : []) {
        const a = analyserMail(m && m.source, maintenant());
        if (!a) continue;
        const cle = a.service + '|' + a.code + '|' + a.lien;
        if (dejaSignales.has(cle)) continue;
        dejaSignales.add(cle);
        // Ni code ni lien dans le journal : ce sont des secrets à usage unique.
        journal('info', 'Webmail : mail de connexion ' + a.service + ' reçu pour « ' + profil + ' » (' +
          (a.code ? 'code' : 'sans code') + ', ' + (a.lien ? 'lien' : 'sans lien') + ').');
        signaler({ profil, ...a });
      }
      return 'ok';
    } catch (e) {
      journal('warning', 'Webmail : relevé des mails impossible pour « ' + profil + ' » (' +
        (e && e.message ? e.message : String(e)) + ').');
      return 'erreur';
    }
  }
  const minuterie = setIntervalFn(() => relever(), periodeMs);
  return {
    relever,
    arreter() { clearIntervalFn(minuterie); debug('Webmail : relevé arrêté pour « ' + profil + ' ».'); }
  };
}

// File des connexions reçues, lue par l'interface en attente longue
// (canal webmail:attendre, le preload n'expose pas ipcRenderer.on).
function creerFileConnexions({ delaiMs = 25000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  let file = [];
  let attentes = [];
  return {
    ajouter(evenement) {
      file.push(evenement);
      const servies = attentes;
      attentes = [];
      if (servies.length) {
        const lot = file;
        file = [];
        for (const a of servies) { clearTimeoutFn(a.minuterie); a.resoudre(lot); }
      }
    },
    attendre() {
      if (file.length) {
        const lot = file;
        file = [];
        return Promise.resolve(lot);
      }
      return new Promise((resoudre) => {
        const a = { resoudre };
        a.minuterie = setTimeoutFn(() => {
          attentes = attentes.filter(x => x !== a);
          resoudre([]);
        }, delaiMs);
        attentes.push(a);
      });
    }
  };
}

module.exports = {
  DOMAINES, FRAICHEUR_MS, SOURCE_MAX,
  decoderQP, decoderEntete, htmlVersTexte, partiesTexte, serviceDeExpediteur,
  lienDuService, codeDans, analyserMail, scriptReleve, creerReleveur, creerFileConnexions
};
