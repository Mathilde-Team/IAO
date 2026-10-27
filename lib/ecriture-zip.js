'use strict';

// lib/ecriture-zip.js — écriture d'une archive ZIP, sans dépendance npm ni
// outil système (issue #329, invariant 7). Pendant de lib/lecture-zip.js :
// mêmes limites (pas de ZIP64), donc toute archive écrite ici se relit avec
// lecture-zip.
//
// - noms en UTF-8 (drapeau 0x0800), séparateur « / » ;
// - chaque entrée est compressée (deflate) quand c'est plus court, stockée
//   sinon ;
// - écriture dans un descripteur ouvert par l'appelant (fs injecté) : seule
//   l'entrée en cours est en mémoire, pas toute l'archive.

const zlib = require('zlib');
const { crc32 } = require('./lecture-zip');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_FIN = 0x06054b50;
const DRAPEAU_UTF8 = 0x0800;
const METHODE_STOCKE = 0;
const METHODE_DEFLATE = 8;
const VERSION = 20;
const LIMITE_32 = 0xffffffff;
const ENTREES_MAX = 0xfffe;

class ErreurEcritureZip extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurEcritureZip';
  }
}

// Date et heure au format MS-DOS (heure locale, précision 2 s, années 1980-2107).
function dateDos(date) {
  const annee = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    heure: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    jour: ((annee - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

class EcrivainZip {
  // fd : descripteur ouvert en écriture ; fs : module fs (writeSync).
  constructor(fd, fs) {
    this.fd = fd;
    this.fs = fs;
    this.position = 0;
    this.central = [];
    this.noms = new Set();
  }

  _ecrire(buf) {
    let ecrits = 0;
    while (ecrits < buf.length) ecrits += this.fs.writeSync(this.fd, buf, ecrits, buf.length - ecrits);
    this.position += buf.length;
  }

  // Ajoute une entrée. nom : chemin relatif « a/b.txt » ; donnees : Buffer.
  ajouter(nom, donnees, date) {
    if (typeof nom !== 'string' || nom === '' || nom.startsWith('/') || nom.includes('\\') || nom.split('/').includes('..')) {
      throw new ErreurEcritureZip('nom d\'entrée invalide : ' + nom);
    }
    if (this.noms.has(nom)) throw new ErreurEcritureZip('entrée en double : ' + nom);
    if (this.central.length >= ENTREES_MAX) throw new ErreurEcritureZip('trop de fichiers pour une archive ZIP sans ZIP64');
    if (donnees.length >= LIMITE_32) throw new ErreurEcritureZip('fichier trop grand pour une archive ZIP sans ZIP64 : ' + nom);
    const brut = Buffer.from(nom, 'utf8');
    const compresse = zlib.deflateRawSync(donnees);
    const deflate = compresse.length < donnees.length;
    const contenu = deflate ? compresse : donnees;
    const methode = deflate ? METHODE_DEFLATE : METHODE_STOCKE;
    const crc = crc32(donnees);
    const { heure, jour } = dateDos(date || new Date());
    const decalage = this.position;
    if (decalage + 30 + brut.length + contenu.length >= LIMITE_32) {
      throw new ErreurEcritureZip('archive trop grande pour le format ZIP sans ZIP64 (4 Go)');
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(DRAPEAU_UTF8, 6);
    local.writeUInt16LE(methode, 8);
    local.writeUInt16LE(heure, 10);
    local.writeUInt16LE(jour, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(contenu.length, 18);
    local.writeUInt32LE(donnees.length, 22);
    local.writeUInt16LE(brut.length, 26);
    local.writeUInt16LE(0, 28);
    this._ecrire(local);
    this._ecrire(brut);
    this._ecrire(contenu);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(DRAPEAU_UTF8, 8);
    central.writeUInt16LE(methode, 10);
    central.writeUInt16LE(heure, 12);
    central.writeUInt16LE(jour, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(contenu.length, 20);
    central.writeUInt32LE(donnees.length, 24);
    central.writeUInt16LE(brut.length, 28);
    central.writeUInt32LE(decalage, 42);
    this.central.push(Buffer.concat([central, brut]));
    this.noms.add(nom);
  }

  // Écrit le répertoire central et la fin d'archive. Retourne la taille totale.
  terminer() {
    const debut = this.position;
    const central = Buffer.concat(this.central);
    if (debut + central.length + 22 >= LIMITE_32) {
      throw new ErreurEcritureZip('archive trop grande pour le format ZIP sans ZIP64 (4 Go)');
    }
    this._ecrire(central);
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(SIG_FIN, 0);
    fin.writeUInt16LE(this.central.length, 8);
    fin.writeUInt16LE(this.central.length, 10);
    fin.writeUInt32LE(central.length, 12);
    fin.writeUInt32LE(debut, 16);
    this._ecrire(fin);
    return this.position;
  }
}

module.exports = { EcrivainZip, ErreurEcritureZip, dateDos, ENTREES_MAX };
