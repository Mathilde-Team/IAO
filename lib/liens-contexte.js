'use strict';

// lib/liens-contexte.js — Issue #362 : liens de l'interface, menu contextuel
// et navigateur externe. Fonctions PURES (aucune dépendance à Electron ni au
// DOM), testées par test/liens-contexte.test.js (invariant 11, CLAUDE.md).
//
// Le menu lui-même est dessiné par assets/app.js (DOM) ; l'ouverture effective
// (shell.openExternal, BrowserWindow, processus externe) vit dans main.js. Ce
// module décide seulement : quelles actions proposer, avec quels libellés, et
// comment lancer un navigateur détecté (commande + drapeau navigation privée).

// Seuls les liens web (http/https) ouvrent le menu : pas de data:, mailto:,
// file:... — même politique que lib/popup-guard.js pour les popups.
function estUrlWeb(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// N_ marque une chaîne extraite pour la traduction (xgettext --keyword=N_)
// sans être traduite ici : le front (assets/app.js) la passe à _() au
// moment de l'affichage. En Node (tests), N_ renvoie la chaîne telle quelle.
function N_(chaine) { return chaine; }

// Actions du menu, dans l'ordre d'affichage. `navigateur` est le nom affiché
// du navigateur choisi (null : libellé générique, l'ouverture externe reste
// possible — le main résout le navigateur au moment de l'action).
// Renvoie [] quand l'URL n'est pas un lien web : pas de menu du tout.
function construireItemsMenu(url, navigateur) {
  if (!estUrlWeb(url)) return [];
  return [
    { id: 'copier', cle: N_("Copier l'adresse du lien") },
    { id: 'onglet', cle: N_('Ouvrir dans un autre onglet') },
    { id: 'fenetre', cle: N_('Ouvrir dans une autre fenêtre') },
    navigateur
      ? { id: 'navigateur', cle: N_('Ouvrir avec {navigateur}'), params: { navigateur } }
      : { id: 'navigateur', cle: N_('Ouvrir avec un navigateur externe') },
    navigateur
      ? { id: 'navigateur-prive', cle: N_('Ouvrir avec {navigateur} en navigation privée'), params: { navigateur } }
      : { id: 'navigateur-prive', cle: N_('Ouvrir avec un navigateur externe en navigation privée') }
  ];
}

// Drapeau de navigation privée de chaque navigateur connu. Un navigateur
// inconnu reçoit '' : l'ouverture se fera sans navigation privée, le main le
// signale plutôt que de deviner un drapeau erroné.
const DRAPEAUX_PRIVES = {
  chrome: '--incognito',
  chromium: '--incognito',
  edge: '--incognito',
  brave: '--incognito',
  vivaldi: '--incognito',
  opera: '--private',
  firefox: '--private-window',
  safari: '--private'
};

function drapeauPrive(idNavigateur) {
  return Object.prototype.hasOwnProperty.call(DRAPEAUX_PRIVES, idNavigateur)
    ? DRAPEAUX_PRIVES[idNavigateur]
    : '';
}

// Ligne de commande de lancement (child_process.spawn). L'URL va en DERNIER
// argument : les drapeaux du navigateur ne peuvent pas être confondus avec
// une URL (un lien commençant par « - » ne serait pas chargé comme tel).
function construireLigneCommande(navigateur, url, prive) {
  const args = [];
  const drapeau = prive ? drapeauPrive(navigateur && navigateur.id) : '';
  if (drapeau) args.push(drapeau);
  args.push(url);
  return { commande: navigateur.commande, args };
}

// Résout le navigateur à utiliser : la préférence des réglages si elle
// désigne un navigateur détecté, sinon le défaut du système, sinon le
// premier détecté. Renvoie null si rien n'est disponible.
function choisirNavigateur(detectes, preference, defautSysteme) {
  if (!Array.isArray(detectes) || detectes.length === 0) return null;
  if (preference) {
    const choisi = detectes.find((n) => n && n.id === preference);
    if (choisi) return choisi;
  }
  if (defautSysteme) {
    const systeme = detectes.find((n) => n && n.id === defautSysteme);
    if (systeme) return systeme;
  }
  return detectes[0];
}

// Nom affiché du navigateur choisi (pour les libellés du menu), ou null.
function nomNavigateurChoisi(detectes, preference, defautSysteme) {
  const choisi = choisirNavigateur(detectes, preference, defautSysteme);
  return choisi ? choisi.nom : null;
}

// Candidats à sonder, par plateforme. Les chemins Windows contiennent des
// variables d'environnement (%ProgramFiles%...) : le main les développe avant
// de tester l'existence (le module reste pur, sans accès à l'environnement).
function candidatsNavigateurs(platforme) {
  const linux = [
    { id: 'chrome', nom: 'Google Chrome', chemins: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'] },
    { id: 'chromium', nom: 'Chromium', chemins: ['/usr/bin/chromium', '/usr/bin/chromium-browser'] },
    { id: 'firefox', nom: 'Mozilla Firefox', chemins: ['/usr/bin/firefox', '/usr/bin/firefox-esr'] },
    { id: 'brave', nom: 'Brave', chemins: ['/usr/bin/brave-browser'] },
    { id: 'vivaldi', nom: 'Vivaldi', chemins: ['/usr/bin/vivaldi'] },
    { id: 'opera', nom: 'Opera', chemins: ['/usr/bin/opera'] },
    { id: 'edge', nom: 'Microsoft Edge', chemins: ['/usr/bin/microsoft-edge'] }
  ];
  const mac = [
    { id: 'safari', nom: 'Safari', chemins: ['/Applications/Safari.app/Contents/MacOS/Safari'] },
    { id: 'chrome', nom: 'Google Chrome', chemins: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] },
    { id: 'chromium', nom: 'Chromium', chemins: ['/Applications/Chromium.app/Contents/MacOS/Chromium'] },
    { id: 'firefox', nom: 'Mozilla Firefox', chemins: ['/Applications/Firefox.app/Contents/MacOS/firefox'] },
    { id: 'brave', nom: 'Brave', chemins: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'] },
    { id: 'edge', nom: 'Microsoft Edge', chemins: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] }
  ];
  const windows = [
    { id: 'chrome', nom: 'Google Chrome', chemins: ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe'] },
    { id: 'edge', nom: 'Microsoft Edge', chemins: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe', '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe'] },
    { id: 'firefox', nom: 'Mozilla Firefox', chemins: ['%ProgramFiles%\\Mozilla Firefox\\firefox.exe', '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe'] },
    { id: 'brave', nom: 'Brave', chemins: ['%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', '%ProgramFiles(x86)%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'] },
    { id: 'vivaldi', nom: 'Vivaldi', chemins: ['%ProgramFiles%\\Vivaldi\\Application\\vivaldi.exe', '%ProgramFiles(x86)%\\Vivaldi\\Application\\vivaldi.exe'] }
  ];
  if (platforme === 'win32') return windows;
  if (platforme === 'darwin') return mac;
  return linux;
}

// Détection effective : ne garde que les candidats dont un chemin existe
// (le main développe les variables d'environnement avant l'appel). Les
// candidats sans id ou sans commande sont ignorés.
function detecterNavigateurs(candidats, existeChemin) {
  if (!Array.isArray(candidats)) return [];
  return candidats
    .filter((c) => c && typeof c.id === 'string' && c.id)
    .map((c) => {
      const chemin = (Array.isArray(c.chemins) ? c.chemins : []).find((p) => existeChemin(p));
      return chemin ? { id: c.id, nom: c.nom || c.id, commande: chemin } : null;
    })
    .filter(Boolean);
}

// Rapproche le nom applicatif du défaut du système (renvoyé par
// app.getApplicationNameForProtocol) et un candidat : le nom du candidat ou
// son id, insensible à la casse, est cherché dans le nom système. « Google
// Chrome » → chrome ; « firefox.desktop » → firefox.
function correspondDefautSysteme(nomSysteme, candidat) {
  if (typeof nomSysteme !== 'string' || !nomSysteme || !candidat) return false;
  const cible = nomSysteme.toLowerCase();
  const nom = String(candidat.nom || '').toLowerCase();
  const id = String(candidat.id || '').toLowerCase();
  return (nom && cible.indexOf(nom) !== -1) || (id && cible.indexOf(id) !== -1);
}

// Chargé à la fois via <script src="lib/liens-contexte.js"> dans index.html
// et via require() depuis test/ (même pattern que les autres modules lib/).
const EXPORTS = {
  estUrlWeb,
  construireItemsMenu,
  drapeauPrive,
  construireLigneCommande,
  choisirNavigateur,
  nomNavigateurChoisi,
  candidatsNavigateurs,
  detecterNavigateurs,
  correspondDefautSysteme
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EXPORTS;
}
if (typeof window !== 'undefined') {
  window.IaoLiens = EXPORTS;
}
