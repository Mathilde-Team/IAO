'use strict';

// lib/sauvegarde-complete.js — fonctions PURES de la sauvegarde complète
// (issue #329) : zip du dossier de données + secrets transportables.
//
// Le dossier de données (<userData> : « ai-manager », voir README « Emplacement
// des données ») contient les comptes (profils.json et ses copies), les mots
// de passe de messagerie (secrets.json, chiffrés par le trousseau du système :
// illisibles sur une autre machine), les statistiques (stats/) et le journal
// (logs/). La sauvegarde complète en fait UN fichier zip.
//
// Problème posé par l'issue : secrets.json est chiffré par le trousseau du
// système (DPAPI/libsecret), donc illisible ailleurs. À l'écriture de la
// sauvegarde, chaque mot de passe est déchiffré par le trousseau puis
// rechiffré avec le mot de passe de la sauvegarde (scrypt + AES-256-GCM) :
// le zip est transportable. À la restauration, l'inverse : déchiffrer avec
// le mot de passe de la sauvegarde, rechiffrer avec le trousseau local.
//
// Aucune dépendance Electron ni DOM -> testable par `node --test`
// (invariant 11, CLAUDE.md).

// Chemins exclus de la sauvegarde, en relatif depuis le dossier de données :
//   logs/  : journal de l'application, recréé au premier lancement ;
//   har/   : captures réseau volumineuses et sensibles (README « Capture HAR ») ;
//   *.tmp  : écritures temporaires (écriture atomique : *.tmp puis renommage) ;
//   *.illisible : profils.json illisible, mis de côté à la récupération.
const EXCLUSIONS = [
  /^logs\//,
  /^har\//,
  /\.tmp$/,
  /\.illisible$/
];

// secrets.json est exclu tel quel : remplacé dans le zip par sa forme
// transportable (secrets-sauvegarde.json, chiffré au mot de passe de la
// sauvegarde).
const FICHIER_SECRETS = 'secrets.json';
const FICHIER_SECRETS_PORTABLES = 'secrets-sauvegarde.json';

function cheminExclu(chemin) {
  if (chemin === FICHIER_SECRETS) return true;
  return EXCLUSIONS.some((re) => re.test(chemin));
}

// Trie une liste de chemins relatifs : ceux qui entrent dans le zip, secrets.json
// mis à part (transportable, pas copié tel quel).
function cheminsASauvegarder(chemins) {
  const liste = Array.isArray(chemins) ? chemins.map(String) : [];
  return liste.filter((c) => !cheminExclu(c)).sort();
}

// --- Secrets transportables -------------------------------------------------

// Clé dérivée du mot de passe de la sauvegarde (scrypt : mémoire dure, la
// force brute d'un zip volé coûte cher). Le sel est aléatoire par sauvegarde.
function derive(motDePasse, selHex, crypto) {
  return crypto.scryptSync(String(motDePasse), Buffer.from(selHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
}

// coffre = secrets.json lu tel quel : { profil: base64-trousseau }.
// dechiffrerTrousseau = (base64) => mot de passe en clair | null (chiffré par
// une autre machine, ou illisible : le compte garde son mot de passe vide).
// Renvoie le contenu JSON de secrets-sauvegarde.json : chaque profil est
// chiffré à part (AES-256-GCM, iv et tag propres).
function secretsPortables(coffre, motDePasse, dechiffrerTrousseau, crypto) {
  const source = coffre && typeof coffre === 'object' && !Array.isArray(coffre) ? coffre : {};
  const sel = crypto.randomBytes(16);
  const cle = derive(motDePasse, sel.toString('hex'), crypto);
  const entrees = {};
  for (const [profil, valeur] of Object.entries(source)) {
    if (typeof profil !== 'string' || profil.length === 0 || typeof valeur !== 'string') continue;
    const clair = dechiffrerTrousseau(valeur);
    if (clair === null || typeof clair !== 'string') continue; // non lisible ici : pas dans le zip
    const iv = crypto.randomBytes(12);
    const chiffre = crypto.createCipheriv('aes-256-gcm', cle, iv);
    const donnees = Buffer.concat([chiffre.update(clair, 'utf8'), chiffre.final()]);
    entrees[profil] = {
      iv: iv.toString('hex'),
      tag: chiffre.getAuthTag().toString('hex'),
      donnees: donnees.toString('hex')
    };
  }
  return { version: 1, sel: sel.toString('hex'), entrees };
}

// L'inverse de secretsPortables : { profil: mot de passe en clair }.
// Renvoie null si le mot de passe est faux (authentification GCM en échec)
// ou si le conteneur est mal formé ; {} si le conteneur est vide.
function secretsEnClair(portables, motDePasse, crypto) {
  if (!portables || typeof portables !== 'object' || Array.isArray(portables)) return null;
  if (portables.version !== 1 || typeof portables.sel !== 'string') return null;
  const entrees = portables.entrees;
  if (!entrees || typeof entrees !== 'object' || Array.isArray(entrees)) return null;
  const cle = derive(motDePasse, portables.sel, crypto);
  const clair = {};
  for (const [profil, e] of Object.entries(entrees)) {
    if (!e || typeof e !== 'object' || typeof e.iv !== 'string' || typeof e.tag !== 'string' || typeof e.donnees !== 'string') return null;
    try {
      const dechiffre = crypto.createDecipheriv('aes-256-gcm', cle, Buffer.from(e.iv, 'hex'));
      dechiffre.setAuthTag(Buffer.from(e.tag, 'hex'));
      clair[profil] = Buffer.concat([dechiffre.update(Buffer.from(e.donnees, 'hex')), dechiffre.final()]).toString('utf8');
    } catch (_) {
      return null; // mot de passe faux ou conteneur corrompu : échec net
    }
  }
  return clair;
}

module.exports = {
  FICHIER_SECRETS,
  FICHIER_SECRETS_PORTABLES,
  cheminsASauvegarder,
  cheminExclu,
  secretsEnClair,
  secretsPortables
};
