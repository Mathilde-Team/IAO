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
//   debug(message) : traces du mode debug (#162), entrée et sortie.
function creerOuvreurWebmail({ BrowserWindow, journal = () => {}, debug = () => {} }) {
  const fenetres = new Map();
  return function ouvrir({ url, profil, email, motDePasse }) {
    debug('Webmail : ouverture pour « ' + profil + ' » (mot de passe ' +
      (motDePasse ? 'présent' : 'absent') + ').');
    const existante = fenetres.get(profil);
    if (existante && !existante.isDestroyed()) {
      existante.focus();
      debug('Webmail : fenêtre existante de « ' + profil + ' » ramenée au premier plan.');
      return existante;
    }
    const win = new BrowserWindow({
      width: 1200,
      height: 850,
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
    win.on('closed', () => { fenetres.delete(profil); });
    const wc = win.webContents;
    // Pièces jointes, liens : même politique que les popups des onglets.
    wc.setWindowOpenHandler(({ url: cible }) =>
      decidePopup(cible) === 'allow' ? { action: 'allow' } : { action: 'deny' });
    const hote = hoteDe(url);
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
        });
    });
    win.loadURL(url);
    debug('Webmail : fenêtre créée pour « ' + profil + ' » sur ' + hote + '.');
    return win;
  };
}

module.exports = { compteValide, scriptConnexion, creerOuvreurWebmail, PROFIL_RE, EMAIL_MAX };
