'use strict';

// lib/ecriture-zip.js — écriture d'une archive ZIP, sans shell ni dépendance
// npm (pendant d'écriture de lib/lecture-zip.js, invariant 7).
//
// Issue #329 : la sauvegarde complète zipppe le dossier de données. Ce module
// fabrique l'archive en mémoire : une entrée locale + répertoire central + fin
// d'archive, méthode « deflate » (zlib) ou « stockée » si la compression
// grossit le contenu. Noms en UTF-8 (drapeau 0x0800), CRC-32 vérifié à la
// lecture. Refus explicite de ce qui casserait le lecteur : ZIP64 (une
// entrée ou l'archive de plus de 4 Go) et les chemins absolus ou qui remontent
// (« ../ », « C:\ ») — un nom d'entrée est une donnée, jamais un chemin vers
// lequel écrire sans contrôle (invariant 1).
//
// Aucune dépendance Electron ni DOM -> testable par `node --test`
// (invariant 11, CLAUDE.md).

const zlib = require('zlib');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_FIN = 0x06054b50;
const DRAPEAU_UTF8 = 0x0800;
const METHODE_STOCKE = 0;
const METHODE_DEFLATE = 8;
const TAILLE_MAX = 0xffffffff; // garde ZIP64 : refusé avant d'écrire un tel zip

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

// Date et heure DOS des en-têtes (2 + 2 octets) : l'interoperabilité avec les
// outils du système veut une valeur plausible ; le lecteur ne la vérifie pas.
function dateHeureDOS(date) {
  const d = date instanceof Date ? date : new Date();
  const heures = Math.max(0, Math.min(23, d.getHours()));
  const minutes = Math.max(0, Math.min(59, d.getMinutes()));
  const secondes = Math.max(0, Math.min(29, Math.floor(d.getSeconds() / 2)));
  const annee = Math.max(1980, Math.min(2107, d.getFullYear()));
  const mois = Math.max(1, Math.min(12, d.getMonth() + 1));
  const jour = Math.max(1, Math.min(31, d.getDate()));
  return {
    heure: (heures << 11) | (minutes << 5) | secondes,
    jour: ((annee - 1980) << 9) | (mois << 5) | jour
  };
}

// CRC-32 (IEEE 802.3, même table que lib/lecture-zip.js : les archives écrites
// ici doivent se relire là-bas avec le CRC contrôlé).
const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const octet of buf) c = TABLE_CRC[(c ^ octet) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Un nom d'entrée est sûr pour la restauration : relatif, sans « .. », sans
// racine. Les dossiers se terminent par « / ».
function nomSure(nom) {
  // 512 caractères ⇒ 2048 octets UTF-8 au pire : la longueur (16 bits) du
  // champ de l'en-tête ne peut jamais déborder.
  if (typeof nom !== 'string' || nom.length === 0 || nom.length > 512) return false;
  if (nom.includes('..') || /^[a-zA-Z]:/.test(nom) || nom.startsWith('/') || nom.startsWith('\\')) return false;
  if (nom.includes(':') && nom.indexOf(':') === 1) return false;
  const parties = nom.split('/');
  for (const p of parties) {
    if (p === '' || p === '.' || p === '..') return false;
  }
  return true;
}

// Fabrique l'archive complète. entrées : [{ nom, contenu (Buffer|chaîne) }]
// Renvoie le Buffer du zip. Lève si une entrée est trop grosse (ZIP64) ou si
// un nom n'est pas sûr.
// Garde ZIP64 : au-delà du plafond, le lecteur ne sait plus relire l'archive.
// Plafond injectable pour tester les refus sans allouer 4 Go.
function garantirPlafond(taille, plafond, message) {
  if (taille > plafond) throw new Error(message);
}

function ecrireZip(entrees, options = {}) {
  const plafond = typeof options.plafond === 'number' ? options.plafond : TAILLE_MAX;
  const liste = Array.isArray(entrees) ? entrees : [];
  const locales = [];
  const centraux = [];
  let offset = 0;
  let total = 0;
  for (const e of liste) {
    const nom = typeof e.nom === 'string' ? e.nom : '';
    if (!nomSure(nom)) throw new Error('nom d’entrée non sûr : ' + JSON.stringify(nom));
    const brut = Buffer.isBuffer(e.contenu) ? e.contenu : Buffer.from(String(e.contenu), 'utf8');
    garantirPlafond(brut.length, plafond, 'entrée trop grande (ZIP64 non pris en charge) : ' + nom);
    total += brut.length;
    garantirPlafond(total, plafond, 'archive trop grande (ZIP64 non pris en charge)');
    const nomBuf = Buffer.from(nom, 'utf8');
    const crc = crc32(brut);
    let compresse = zlib.deflateRawSync(brut, { level: 6 });
    let methode = METHODE_DEFLATE;
    if (compresse.length >= brut.length) {
      compresse = brut;
      methode = METHODE_STOCKE;
    }
    const dos = dateHeureDOS(e.date);
    const local = Buffer.concat([
      u32(SIG_LOCAL), u16(20), u16(DRAPEAU_UTF8), u16(methode), u16(dos.heure), u16(dos.jour), u32(crc),
      u32(compresse.length), u32(brut.length), u16(nomBuf.length), u16(0), nomBuf
    ]);
    locales.push({ local, compresse });
    const central = Buffer.concat([
      u32(SIG_CENTRAL), u16(20), u16(20), u16(DRAPEAU_UTF8), u16(methode), u16(dos.heure), u16(dos.jour), u32(crc),
      u32(compresse.length), u32(brut.length), u16(nomBuf.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nomBuf
    ]);
    centraux.push(central);
    offset += local.length + compresse.length;
    garantirPlafond(offset, plafond, 'archive trop grande (ZIP64 non pris en charge)');
  }
  const fin = Buffer.concat([
    u32(SIG_FIN), u16(0), u16(0), u16(liste.length), u16(liste.length),
    u32(Buffer.concat(centraux).length), u32(offset), u16(0)
  ]);
  return Buffer.concat([
    ...locales.map(l => Buffer.concat([l.local, l.compresse])),
    ...centraux,
    fin
  ]);
}

module.exports = { crc32, dateHeureDOS, ecrireZip, garantirPlafond, nomSure };
