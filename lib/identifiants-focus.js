'use strict';

// lib/identifiants-focus.js — proposition d'identifiants au focus d'un champ
// de connexion (issue #278, lot 2). Logique du process principal, injectable
// (Menu, screen, horloge) pour être testée sans Electron.
//
// Principe (les secrets restent dans le process principal) : le preload de
// session signale le focus ('iao-identifiants:focus') ; ici, on lit l'URL
// RÉELLE du webContents émetteur (jamais une donnée de la page) ; s'il existe
// des identifiants pour cet hôte, un menu natif (Menu.popup) propose les
// logins ; au choix, le mot de passe est déchiffré et envoyé au webContents
// émetteur — et à lui seul — sur 'iao-identifiants:remplir'. Le renderer
// n'apparaît nulle part dans ce parcours.
//
// Anti-boucle : après une proposition, un délai (cooldown) bloque les
// propositions suivantes — fermer le menu rend le focus au champ, ce qui
// re-déclenche focusin.

// Issue #363 : même-site que l'onglet fixe (lib/onglet-fixe.js, pur).
const OngletFixe = require('./onglet-fixe');

const COOLDOWN_MS = 1200;

// Hôte https (et lui seul) d'une URL, en minuscules ; null sinon.
function hoteDepuisUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch (_) {
    return null;
  }
}

// Issue #363 : identifiants du site de l'onglet fixe. Dans cet onglet, la
// navigation est verrouillée sur le site choisi dans les réglages (même hôte
// ou sous-domaine, lib/onglet-fixe.js). Les identifiants enregistrés pour ce
// site sont donc proposés même si l'hôte exact de la page diffère de l'hôte
// enregistré (www vs racine, sous-domaine de connexion) : avec `site` (URL
// des réglages de l'onglet fixe), on retient les identifiants de tous les
// hôtes du site — sinon, comportement historique : hôte exact seulement.
function loginsDuSite(liste, hote, site) {
  const logins = [];
  const ajouter = (hoteEnregistre) => {
    for (const l of liste[hoteEnregistre] || []) logins.push({ login: l.login, hote: hoteEnregistre });
  };
  ajouter(hote);
  if (!site) return logins;
  for (const hoteEnregistre in liste) {
    if (hoteEnregistre === hote) continue;
    if (OngletFixe.memeSite('https://' + hoteEnregistre + '/', site)) ajouter(hoteEnregistre);
  }
  return logins;
}

// Décide s'il faut proposer le menu : hôte https + au moins un identifiant
// enregistré + cooldown écoulé.
function doitProposer(o) {
  const hote = hoteDepuisUrl(o.url);
  if (!hote) return { proposer: false, hote: null };
  const logins = loginsDuSite((o.lister && o.lister()) || {}, hote, o.site || null);
  if (!logins.length) return { proposer: false, hote };
  if (o.maintenant - o.derniereProposition < o.cooldownMs) return { proposer: false, hote };
  return { proposer: true, hote, logins };
}

// Fabrique le gestionnaire branché sur ipcMain.on(CANAL_FOCUS).
function creer(o) {
  const journal = o.journal || (() => {});
  let derniereProposition = 0;
  const canalRemplir = o.canalRemplir || 'iao-identifiants:remplir';
  const remplir = (sender, hote, login, site) => {
    try {
      if (!sender || typeof sender.getURL !== 'function' || typeof sender.send !== 'function') return false;
      // La page peut avoir navigué depuis la proposition : l'origine doit
      // toujours être l'hôte proposé — sinon rien n'est déchiffré ni envoyé.
      // Onglet fixe (issue #363) : l'origine peut être n'importe quel hôte du
      // site choisi (la navigation y est verrouillée sur ce site), à condition
      // que l'identifiant provienne lui aussi d'un hôte de ce site.
      const origine = sender.getURL();
      const origineOk = hoteDepuisUrl(origine) === hote ||
        (site && OngletFixe.memeSite(origine, site) && OngletFixe.memeSite('https://' + hote + '/', site));
      if (!origineOk) {
        journal('warning', 'Identifiants : émetteur n\'est plus sur « ' + hote + ' », remplissage ignoré.');
        return false;
      }
      const motDePasse = o.identifiants.obtenir(hote, login);
      if (!motDePasse) {
        journal('warning', 'Identifiants : « ' + login + ' » introuvable pour ' + hote + ' (menu).');
        return false;
      }
      sender.send(canalRemplir, { login, motDePasse });
      journal('info', 'Identifiants : remplissage de « ' + login + ' » demandé pour ' + hote + '.');
      return true;
    } catch (e) {
      journal('warning', 'Identifiants : remplissage impossible (' + (e && e.message) + ').');
      return false;
    }
  };
  return {
    remplir,
    surFocus(event, signal, opts) {
      try {
        const sender = event && event.sender;
        if (!sender || typeof sender.getURL !== 'function' || typeof sender.send !== 'function') return false;
        const site = opts && opts.site ? opts.site : null; // issue #363
        const decision = doitProposer({
          url: sender.getURL(),
          site: site,
          lister: o.identifiants.lister.bind(o.identifiants),
          maintenant: o.maintenant ? o.maintenant() : Date.now(),
          derniereProposition,
          cooldownMs: o.cooldownMs || COOLDOWN_MS
        });
        if (!decision.proposer) return false;
        const fenetre = o.fenetrePour(sender);
        if (!fenetre || typeof o.Menu.buildFromTemplate !== 'function') return false;
        derniereProposition = o.maintenant ? o.maintenant() : Date.now();
        const items = [{ label: decision.hote, enabled: false }].concat(
          decision.logins.map((e) => ({
            label: e.login,
            // Issue #363 : le remplissage utilise l'hôte où l'identifiant
            // est enregistré (le site de l'onglet fixe peut fusionner
            // plusieurs hôtes), pas l'hôte exact de la page.
            click: () => remplir(sender, e.hote, e.login, site)
          })));
        const options = { window: fenetre };
        if (o.pointeur) {
          const p = o.pointeur();
          if (p && typeof p.x === 'number' && typeof p.y === 'number') { options.x = p.x; options.y = p.y; }
        }
        o.Menu.buildFromTemplate(items).popup(options);
        journal('info', 'Identifiants : ' + decision.logins.length + ' identifiant(s) proposé(s) pour ' + decision.hote + '.');
        return true;
      } catch (e) {
        journal('warning', 'Identifiants : proposition impossible (' + (e && e.message) + ').');
        return false;
      }
    }
  };
}

module.exports = { COOLDOWN_MS, hoteDepuisUrl, loginsDuSite, doitProposer, creer };
