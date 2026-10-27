'use strict';

// lib/accounts-recovery.js — fonctions PURES de l'issue #186 (« pourquoi il ne
// charge pas les profils au démarrage ? il faut faire un import »).
//
// Constat (journal de #58, 12/10/2026) : au lancement, l'ordonnanceur
// connaissait ~70 profils (son instantané <userData>/scheduler/
// accounts-snapshot.json, écrit à chaque saveAccounts()), alors que
// l'interface n'en lisait aucun dans son localStorage. La cause de la perte du
// localStorage n'est pas reproduite ; ces fonctions la rendent visible dans
// iao.log et permettent de restaurer les comptes depuis l'instantané, sans
// import. Les sessions (cookies) ne sont pas perdues : elles vivent dans les
// partitions persist:<profil>, que l'instantané conserve.
//
// Aucune dépendance Electron ni DOM -> testable par `node --test`
// (invariant 11, CLAUDE.md).

const STORAGE_STATUSES = Object.freeze(['ok', 'empty', 'corrupt', 'erreur']);

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toTimestamp(value) {
  return Number(value) || 0;
}

// Reconstruit des comptes à partir de l'instantané de l'ordonnanceur
// ({ id, name, email, profile, automation }). Les entrées sans id ou sans profil
// sont ignorées, ainsi que les doublons d'id ou de profil (invariant 4 : deux
// comptes sur le même profil partageraient leurs cookies). L'e-mail est dans
// l'instantané depuis l'issue #311 ; celui d'un ancien instantané reste vide et
// se complète depuis « Modifier le compte ».
// Services et cooldowns sont ajoutés ensuite par migrateOldAccounts().
function accountsFromSnapshot(snapshot) {
  const out = [];
  const ids = new Set();
  const profiles = new Set();
  for (const entry of Array.isArray(snapshot) ? snapshot : []) {
    if (!entry || typeof entry !== 'object') continue;
    const id = cleanString(entry.id);
    const profile = cleanString(entry.profile);
    if (!id || !profile || ids.has(id) || profiles.has(profile)) continue;
    ids.add(id);
    profiles.add(profile);
    const auto = entry.automation && typeof entry.automation === 'object' ? entry.automation : {};
    out.push({
      id,
      name: cleanString(entry.name) || profile,
      // Issue #311 : adresse gardée par l'ordonnanceur ; vide pour un ancien instantané.
      email: cleanString(entry.email),
      profile,
      automation: {
        enabled: auto.enabled !== false,
        lastUsedAt: toTimestamp(auto.lastUsedAt),
        lastAutomationAt: toTimestamp(auto.lastAutomationAt)
      }
    });
  }
  return out;
}

// Issue #311 (suite) : copie COMPLÈTE de la liste des comptes, au format du
// fichier d'export (<userData>/comptes-sauvegarde.json, écrite à chaque
// saveAccounts()). Elle se suffit à elle-même : restaurer = importer cette
// copie (même chemin que « Importer », importAccountsJSON côté interface).
// Renvoie la liste telle quelle si chaque entrée est un objet avec un id et
// un profil, null sinon (copie absente, vide ou douteuse : on retombe sur
// l'ancien instantané, accountsFromSnapshot).
function accountsFromBackup(backup) {
  if (!Array.isArray(backup) || backup.length === 0) return null;
  const ok = backup.every(e => e && typeof e === 'object' && !Array.isArray(e) &&
    cleanString(e.id) !== '' && cleanString(e.profile) !== '');
  return ok ? backup : null;
}

// Ligne de journal du démarrage et décision de proposer la restauration.
//   loaded        : { status: 'ok' | 'empty' | 'corrupt' | 'erreur', count } envoyé par l'interface
//   snapshotCount : nombre de comptes valides dans l'instantané
// Un stockage « corrupt » a déjà sa propre récupération (ai_accounts_backup,
// chantier C) : pas de seconde proposition dans ce cas. Un stockage « erreur »
// (accès impossible, issues #52/#186) est la situation où la restauration
// depuis l'instantané est la PLUS utile : elle est proposée.
function startupAccountsReport(loaded, snapshotCount) {
  const info = loaded && typeof loaded === 'object' ? loaded : {};
  const status = STORAGE_STATUSES.includes(info.status) ? info.status : 'inconnu';
  const count = Number.isInteger(info.count) && info.count > 0 ? info.count : 0;
  const known = Number.isInteger(snapshotCount) && snapshotCount > 0 ? snapshotCount : 0;
  const offerRestore = count === 0 && status !== 'corrupt' && known > 0;
  let message = 'Comptes lus au démarrage : ' + count + " (stockage de l'interface : " + status +
    ") ; instantané de l'ordonnanceur : " + known + ' compte(s).';
  if (offerRestore) {
    message += " Aucun compte dans l'interface alors que l'instantané en contient : restauration proposée (issue #186).";
  }
  return { level: offerRestore ? 'warning' : 'info', message, offerRestore };
}

module.exports = { accountsFromBackup, accountsFromSnapshot, startupAccountsReport };
