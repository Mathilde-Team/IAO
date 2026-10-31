'use strict';

// lib/webmail-connexion.js — ouverture du webmail connectée au compte (issue #310,
// suite de #201 : « raccourci à la page de messagerie (avec mail/mdp) vers
// roundcube »).
//
// Le navigateur système (shell.openExternal) ne reçoit rien de l'application :
// Roundcube s'y ouvrait sans compte ni mot de passe. Le webmail s'ouvre donc
// dans une fenêtre IAO SANS privilèges (sandbox, contextIsolation, aucun
// preload applicatif), dans la partition du compte (persist:<profil>) : une
// session Roundcube par compte, comme les onglets d'IA.
//
// Au premier chargement d'une page de l'hôte du webmail des réglages, le
// formulaire de connexion Roundcube (#rcmloginuser / #rcmloginpwd) est rempli
// avec l'adresse du compte et le mot de passe du coffre (#201), puis validé.
// Une seule tentative par fenêtre : un mot de passe refusé ne boucle pas. Le
// mot de passe, déchiffré par le process principal, n'est envoyé qu'à cette
// fenêtre et jamais journalisé. Sans mot de passe, l'adresse seule est remplie.
//
// Process principal ; BrowserWindow et journal injectés (testé par node --test).

const { decidePopup } = require('./popup-guard');
const { creerReleveur } = require('./webmail-codes');

const PROFIL_RE = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL_MAX = 256;

// Compte transmis par le renderer : profil (clé de partition) obligatoire,
// adresse facultative. Toute autre donnée (une URL, par exemple) est ignorée.
function compteValide(compte) {
  if (!compte || typeof compte !== 'object') return null;
  const profil = typeof compte.profil === 'string' ? compte.profil : '';
  if (!PROFIL_RE.test(profil)) return null;
  const email = typeof compte.email === 'string' ? compte.email.trim() : '';
  // Pas de caractère de contrôle : l'adresse part dans un champ de formulaire.
  if (email.length > EMAIL_MAX || /[\u0000-\u001f\u007f]/.test(email)) return null;
  return { profil, email };
}

// Script exécuté dans la page du webmail. Les valeurs y entrent par
// JSON.stringify (aucune interprétation possible comme code). Résultat :
//   'absent'  : pas de formulaire de connexion (session déjà ouverte, autre page) ;
//   'adresse' : adresse remplie, pas de mot de passe à saisir ;
//   'soumis'  : adresse et mot de passe remplis, formulaire validé.
function scriptConnexion(email, motDePasse) {
  return `(() => {
  const user = document.querySelector('#rcmloginuser, input[name="_user"]');
  const pass = document.querySelector('#rcmloginpwd, input[name="_pass"]');
  if (!user) return 'absent';
  const remplir = (champ, valeur) => {
    champ.value = valeur;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    champ.dispatchEvent(new Event('change', { bubbles: true }));
  };
  remplir(user, ${JSON.stringify(String(email || ''))});
  const motDePasse = ${JSON.stringify(String(motDePasse || ''))};
  if (!pass || !motDePasse) return 'adresse';
  remplir(pass, motDePasse);
  const bouton = document.querySelector('#rcmloginsubmit');
  const formulaire = user.form || pass.form;
  if (bouton) bouton.click();
  else if (formulaire && formulaire.requestSubmit) formulaire.requestSubmit();
  else if (formulaire) formulaire.submit();
  return 'soumis';
})()`;
}

function hoteDe(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return null;
  }
}

// Fabrique l'ouvreur : une fenêtre par profil, refocalisée si elle existe déjà.
//   BrowserWindow : classe Electron (ou doublure) ;
//   journal(niveau, message) : iao.log (jamais le mot de passe) ;
//   debug(message) : traces du mode debug (#162), entrée et sortie ;
//   signaler(evenement) : facultatif (#310, relecture) — tant que la fenêtre est
//   ouverte, ses mails de connexion (code, lien) sont relevés (lib/webmail-codes)
//   et remis à l'interface par cette fonction.
// Mode « arrière-plan » (issue #357) : la fenêtre est créée CACHÉE (show:
// false) pour tenter la connexion Roundcube sans l'afficher — la session
// établie reste dans la partition du compte (persist:<profil>). La fenêtre se
// referme d'elle-même quand la tentative est faite (et au plus tard après
// ARRIERE_PLAN_MAX_MS) : aucune fenêtre cachée ne s'accumule (cf. issue #354).
const ARRIERE_PLAN_MAX_MS = 20000;
const ARRIERE_PLAN_APRES_TENTATIVE_MS = 1500;

function creerOuvreurWebmail({ BrowserWindow, journal = () => {}, debug = () => {}, signaler = null,
  creerReleveurFn = creerReleveur,
  // Délais de fermeture du mode arrière-plan, injectés pour les tests.
  arrierePlanDelais = { max: ARRIERE_PLAN_MAX_MS, apresTentative: ARRIERE_PLAN_APRES_TENTATIVE_MS } }) {
  const fenetres = new Map();
  return function ouvrir({ url, profil, email, motDePasse, arrierePlan = false }) {
    debug('Webmail : ouverture pour « ' + profil + ' » (mot de passe ' +
      (motDePasse ? 'présent' : 'absent') + (arrierePlan ? ', arrière-plan' : '') + ').');
    const existante = fenetres.get(profil);
    if (existante && !existante.isDestroyed()) {
      existante.focus();
      debug('Webmail : fenêtre existante de « ' + profil + ' » ramenée au premier plan.');
      return existante;
    }
    const win = new BrowserWindow({
      width: 1200,
      height: 850,
      show: !arrierePlan,
      title: 'Webmail',
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:' + profil,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    fenetres.set(profil, win);
    const wc = win.webContents;
    const hote = hoteDe(url);
    // Fenêtre cachée : elle se referme seule, quoi qu'il arrive (issue #357,
    // garde-fou de l'issue #354 : pas de fenêtre invisible qui traîne).
    let minuteurArrierePlan = null;
    if (arrierePlan) {
      const fermer = () => { if (!win.isDestroyed()) win.close(); };
      minuteurArrierePlan = setTimeout(fermer, arrierePlanDelais.max);
      win.on('closed', () => { if (minuteurArrierePlan) clearTimeout(minuteurArrierePlan); });
    }
    // Relevé des mails de connexion, seulement sur une page de l'hôte du
    // webmail (une page tierce ne peut pas fournir de faux messages).
    const releveur = signaler ? creerReleveurFn({
      wc, profil, signaler, journal, debug, actif: () => hoteDe(wc.getURL()) === hote
    }) : null;
    win.on('closed', () => {
      fenetres.delete(profil);
      if (releveur) releveur.arreter();
    });
    // Pièces jointes, liens : même politique que les popups des onglets.
    // #354 : pas de fenêtre ouverte en arrière-plan depuis le webmail non plus.
    wc.setWindowOpenHandler(({ url: cible, disposition }) =>
      disposition !== 'background-tab' && decidePopup(cible) === 'allow'
        ? { action: 'allow' } : { action: 'deny' });
    let tente = false;
    wc.on('did-finish-load', () => {
      if (tente || hoteDe(wc.getURL()) !== hote) return;
      tente = true; // une seule tentative : un refus ne boucle pas
      Promise.resolve()
        .then(() => wc.executeJavaScript(scriptConnexion(email, motDePasse)))
        .then((resultat) => {
          journal('info', 'Webmail : connexion « ' + resultat + ' » pour « ' + profil + ' ».');
        })
        .catch((e) => {
          journal('warning', 'Webmail : remplissage impossible pour « ' + profil + ' » (' +
            (e && e.message ? e.message : String(e)) + ').');
        })
        .then(() => {
          // Arrière-plan : la tentative est faite, on laisse le cookie de
          // session se poser puis on referme la fenêtre cachée.
          if (arrierePlan && !win.isDestroyed()) {
            if (minuteurArrierePlan) clearTimeout(minuteurArrierePlan);
            minuteurArrierePlan = setTimeout(() => { if (!win.isDestroyed()) win.close(); },
              arrierePlanDelais.apresTentative);
          }
        });
    });
    win.loadURL(url);
    debug('Webmail : fenêtre créée pour « ' + profil + ' » sur ' + hote + '.');
    return win;
  };
}

module.exports = {
  compteValide, scriptConnexion, creerOuvreurWebmail, PROFIL_RE, EMAIL_MAX,
  ARRIERE_PLAN_MAX_MS, ARRIERE_PLAN_APRES_TENTATIVE_MS
};
