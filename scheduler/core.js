'use strict';

// scheduler/core.js — fonctions PURES de l'ordonnanceur IA (« Ordonnanceur »,
// chantier E, FEATURES.md). Aucune dépendance à Electron ni au système de
// fichiers : entièrement testable avec `node --test`, sans lancer
// l'application. L'orchestration (fs, sessions Electron, IPC) vit dans
// scheduler/index.js, qui s'appuie sur ce module.
//
// Origine : proposition externe (voir historique de conversation / demande
// utilisateur), reprise ici en dur dans le code + le backlog (FEATURES.md).

// ---------------------------------------------------------------------------
// Machine à états des jobs
// ---------------------------------------------------------------------------
// Diagramme (voir FEATURES.md « Ordonnanceur ») :
//   DOWNLOADING -> COMPLETED -> PROJECT_PENDING -> RESUME_REQUIRED -> RUNNING -> DELIVERED
// COMPLETED peut aussi être marqué directement DELIVERED (décision manuelle :
// « ce ZIP est la livraison finale, pas la peine de continuer »).
// WAITING_FOR_PROFILE : le job existe mais aucun profil n'est disponible
// depuis plus de `profileAgeThresholdHours` heures (ordo, point 4) — il reste
// en attente plutôt que de prendre un profil trop récent.
// PAUSED : mise en pause manuelle, depuis n'importe quel état actif.
// ERROR : terminal, mais une relance manuelle repasse par RESUME_REQUIRED.
const JOB_STATES = [
  'DOWNLOADING', 'COMPLETED', 'PROJECT_PENDING', 'WAITING_FOR_PROFILE',
  'RESUME_REQUIRED', 'RUNNING', 'DELIVERED', 'ERROR', 'PAUSED'
];

// Transitions autorisées : { [état actuel]: [états suivants valides] }
const ALLOWED_TRANSITIONS = {
  DOWNLOADING: ['COMPLETED', 'ERROR'],
  COMPLETED: ['PROJECT_PENDING', 'DELIVERED'],
  PROJECT_PENDING: ['WAITING_FOR_PROFILE', 'RESUME_REQUIRED'],
  WAITING_FOR_PROFILE: ['RESUME_REQUIRED', 'PAUSED'],
  RESUME_REQUIRED: ['RUNNING', 'PAUSED', 'ERROR'],
  RUNNING: ['DELIVERED', 'ERROR', 'PAUSED'],
  PAUSED: ['RESUME_REQUIRED', 'WAITING_FOR_PROFILE', 'RUNNING'],
  DELIVERED: [],
  ERROR: ['RESUME_REQUIRED']
};

function isValidState(state) {
  return JOB_STATES.includes(state);
}

function canTransition(from, to) {
  if (!isValidState(from) || !isValidState(to)) return false;
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

// Renvoie le nouvel état si la transition est valide, sinon lève une erreur
// explicite (jamais de transition silencieusement acceptée).
function nextJobState(current, target) {
  if (!canTransition(current, target)) {
    throw new Error('Transition d\'état de job invalide : ' + current + ' -> ' + target);
  }
  return target;
}

// ---------------------------------------------------------------------------
// ZIP / horodatage
// ---------------------------------------------------------------------------
function isZipFilename(name) {
  return typeof name === 'string' && /\.zip$/i.test(name.trim());
}

const TIMESTAMP_RE = /^\d{8}-\d{6}$/;

// Un ZIP livré est valide s'il porte l'horodatage attendu (YYYYMMDD-HHMMSS)
// n'importe où dans son nom, et se termine bien par .zip (ordo, point 8).
function isTimestampedZipName(name, timestamp) {
  if (!isZipFilename(name) || typeof timestamp !== 'string') return false;
  if (!TIMESTAMP_RE.test(timestamp)) return false;
  return name.includes(timestamp);
}

// Horodatage YYYYMMDD-HHMMSS à partir d'un objet Date (heure locale de la
// machine qui exécute l'ordonnanceur — cohérent avec un utilisateur qui
// taperait le prompt à la main).
function formatTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return (
    String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
  );
}

// Le prompt générique de livraison (ordo, point 7) — seul le timestamp change
// d'un job à l'autre. Lève une erreur si l'horodatage est mal formé, pour ne
// jamais envoyer un prompt avec un timestamp invalide à un service IA.
function buildDeliveryPrompt(timestamp) {
  if (!TIMESTAMP_RE.test(timestamp)) {
    throw new Error('Horodatage invalide (attendu YYYYMMDD-HHMMSS) : ' + timestamp);
  }
  return (
    'Continue les features à faire.\n' +
    'Fait évoluer les fichiers de suivi, de tests et de documentation.\n' +
    'Livraison du zip horodaté ' + timestamp + ' sans passer à la suite.'
  );
}

// ---------------------------------------------------------------------------
// Sélection de profil (ordo, point 4)
// ---------------------------------------------------------------------------
// Parmi les comptes fournis, choisit le profil le plus ANCIEN éligible à une
// nouvelle automatisation : automation.enabled !== false, et jamais utilisé
// pour une automatisation (lastAutomationAt === 0) ou utilisé il y a plus de
// `thresholdHours` heures. Renvoie le compte choisi ou null si aucun ne
// convient (le job reste alors WAITING_FOR_PROFILE plutôt que de prendre un
// profil trop récent).
function selectOldestEligibleProfile(accounts, thresholdHours, now = Date.now()) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const thresholdMs = Number(thresholdHours) * 60 * 60 * 1000;
  const eligible = accounts.filter(acc => {
    const auto = acc && acc.automation;
    if (!auto || auto.enabled === false) return false;
    const last = Number(auto.lastAutomationAt) || 0;
    return last === 0 || (now - last) >= thresholdMs;
  });
  if (eligible.length === 0) return null;
  return eligible.reduce((oldest, acc) => {
    const lastOldest = Number(oldest.automation.lastAutomationAt) || 0;
    const lastAcc = Number(acc.automation.lastAutomationAt) || 0;
    return lastAcc < lastOldest ? acc : oldest;
  });
}

// ---------------------------------------------------------------------------
// Jobs : construction et export CSV (ordo, point 1 et 3)
// ---------------------------------------------------------------------------
const CSV_COLUMNS = [
  'id', 'started_at', 'finished_at', 'status', 'profile', 'service',
  'url', 'file_path', 'file_size', 'attempts'
];

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Sérialise une liste de jobs vers le CSV exportable recommandé par ordo
// (« je recommande même un fichier JSON interne + CSV exportable, car le CSV
// seul est mauvais pour gérer proprement les états/reprises »).
function jobsToCSV(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const lines = [CSV_COLUMNS.join(',')];
  for (const job of list) {
    lines.push(CSV_COLUMNS.map(col => csvEscape(job[col])).join(','));
  }
  return lines.join('\n') + '\n';
}

// Construit un enregistrement de job (ordo, point 3) avec des valeurs par
// défaut sûres. `fields.id` est obligatoire (généré par nextJobId côté
// appelant) ; tout le reste est optionnel.
function buildJobRecord(fields) {
  if (!fields || !fields.id) throw new Error('buildJobRecord : id de job manquant');
  const now = fields.createdAt || new Date().toISOString();
  return {
    id: fields.id,
    projectId: fields.projectId || fields.id,
    sourceZip: fields.sourceZip || null,
    profile: fields.profile || null,
    service: fields.service || null,
    createdAt: now,
    lastActivityAt: fields.lastActivityAt || now,
    status: fields.status || 'DOWNLOADING',
    attempts: Number(fields.attempts) || 0,
    outputZip: fields.outputZip || null,
    outputTimestamp: fields.outputTimestamp || null,
    // Champs alignés sur le CSV exportable (point 1).
    started_at: fields.started_at || now,
    finished_at: fields.finished_at || null,
    url: fields.url || null,
    file_path: fields.file_path || null,
    file_size: fields.file_size || null
  };
}

function nextJobId(sequenceNumber) {
  return 'job_' + String(sequenceNumber).padStart(3, '0');
}

// ---------------------------------------------------------------------------
// Détection du service à partir d'un nom d'hôte (utile quand un ZIP est
// détecté dans une <webview> : on associe le job au service correspondant).
// ---------------------------------------------------------------------------
const SERVICE_HOSTS = {
  claude: ['claude.ai'],
  chatgpt: ['chatgpt.com', 'openai.com'],
  gemini: ['gemini.google.com'],
  zeta: ['z.ai', 'chatglm.cn'],
  perplexity: ['perplexity.ai'],
  grok: ['grok.com', 'x.ai'],
  leonardo: ['leonardo.ai'],
  suno: ['suno.com'],
  meshy: ['meshy.ai']
};

function serviceFromHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return null;
  const h = hostname.toLowerCase();
  for (const svc of Object.keys(SERVICE_HOSTS)) {
    if (SERVICE_HOSTS[svc].some(d => h === d || h.endsWith('.' + d))) return svc;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Configuration par défaut de l'ordonnanceur (ordo, section « Interface »)
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  enabled: false,
  maxConcurrentJobs: 2,
  minDelayBetweenAutomationsMinutes: 30,
  profileAgeThresholdHours: 5,
  downloadsDir: null,   // null -> dossier de téléchargements du système
  deliveryDir: null,    // null -> <userData>/scheduler/delivered
  showAutomationWindows: false
};

// ---------------------------------------------------------------------------
// Détection de complétude d'un projet (FEATURES.md P1 « Détection de
// complétude d'un projet »). Aujourd'hui, après un téléchargement (COMPLETED),
// c'est l'utilisateur qui décide manuellement (« Continuer le projet » vs
// « Marquer livré »). Cette fonction analyse le contenu d'un FEATURES.md livré
// dans un ZIP pour compter les cases restantes, sans deviner la décision à
// prendre : elle renvoie juste un récapitulatif que l'app peut afficher.
// ---------------------------------------------------------------------------

// Parse le contenu Markdown d'un FEATURES.md et renvoie le décompte des cases
// à cocher : done ([x] ou [X]), in_progress ([~]), pending ([ ] ou [ ] vide).
// Robuste aux variations d'espacement (GitHub tolère [x], [X], [ x ], etc.).
// Ignore les cases dans des blocs de code (``` ... ```) pour ne pas compter
// du texte cité en exemple.
function parseFeaturesMd(content) {
  const text = typeof content === 'string' ? content : '';
  const lines = text.split('\n');
  let inCodeBlock = false;
  const result = { done: 0, inProgress: 0, pending: 0, total: 0 };
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    // Case à cocher Markdown : - [x], * [x], [x] en début de ligne ou après
    // puces. On accepte [x]/[X] (fait), [~] (en cours), [ ] (à faire).
    // Le \s? ou $ après ] distingue une vraie case à cocher d'un [x] dans un
    // mot (ex. array[x]) — trim() peut supprimer l'espace final d'une ligne
    // « - [x] » seule, d'où l'alternative $ (fin de chaîne).
    const m = trimmed.match(/^[-*+]?\s*\[([ xX~])\](\s|$)/);
    if (!m) continue;
    const mark = m[1];
    if (mark === 'x' || mark === 'X') result.done++;
    else if (mark === '~') result.inProgress++;
    else result.pending++; // espace ou vide
    result.total++;
  }
  return result;
}

// Renvoie true si le projet semble terminé (plus aucune case [ ] ou [~] restante).
// Prudence : un FEATURES.md sans aucune case à cocher n'est PAS considéré comme
// terminé (total === 0 -> false) : on ne sait pas, on ne devine pas.
function isProjectComplete(content) {
  const r = parseFeaturesMd(content);
  return r.total > 0 && r.pending === 0 && r.inProgress === 0;
}

// ---------------------------------------------------------------------------
// Projets et tâches (lot 18/09/2026, point 6)
// L'ordonnanceur gère désormais des projets, chacun contenant des tâches.
// L'utilisateur peut choisir quels comptes peuvent recevoir une tâche.
// Les tâches ne peuvent être confiées qu'aux comptes verts (plus de 5h
// d'inactivité) — voir getAssignableAccounts (lib/activity-status.js).
// ---------------------------------------------------------------------------

// Construit un enregistrement de projet.
function buildProjectRecord(fields) {
  if (!fields || !fields.id) throw new Error('buildProjectRecord : id de projet manquant');
  var now = fields.createdAt || new Date().toISOString();
  return {
    id: fields.id,
    name: fields.name || 'Projet sans nom',
    createdAt: now,
    lastActivityAt: fields.lastActivityAt || now,
    status: fields.status || 'active', // 'active' | 'completed' | 'archived'
    allowedAccountIds: Array.isArray(fields.allowedAccountIds) ? fields.allowedAccountIds : [],
    tasks: Array.isArray(fields.tasks) ? fields.tasks : []
  };
}

// Construit un enregistrement de tâche dans un projet.
function buildTaskRecord(fields) {
  if (!fields || !fields.id) throw new Error('buildTaskRecord : id de tâche manquant');
  var now = fields.createdAt || new Date().toISOString();
  return {
    id: fields.id,
    projectId: fields.projectId || null,
    prompt: fields.prompt || '',
    sourceZip: fields.sourceZip || null,
    assignedProfile: fields.assignedProfile || null,
    status: fields.status || 'pending', // 'pending' | 'assigned' | 'running' | 'completed' | 'failed'
    createdAt: now,
    lastActivityAt: fields.lastActivityAt || now,
    result: fields.result || null
  };
}

// Vérifie qu'un compte est autorisé à recevoir une tâche : il doit être
// dans la liste allowedAccountIds du projet ET être vert (assignable).
// Utilise getAssignableAccounts de lib/activity-status.js (chargé côté
// main.js via require).
function canAssignTaskToAccount(project, account, openAccountIds, thresholdHours, now) {
  if (!project || !account) return false;
  // Le compte doit être dans la liste autorisée du projet (si la liste est
  // vide, tous les comptes sont autorisés — comportement par défaut).
  if (project.allowedAccountIds && project.allowedAccountIds.length > 0) {
    if (!project.allowedAccountIds.includes(account.id)) return false;
  }
  // Le compte doit être vert (assignable)
  var openSet = openAccountIds instanceof Set ? openAccountIds : new Set(openAccountIds || []);
  var hasOpenTab = openSet.has(account.id);
  var lastUsedAt = (account.automation && account.automation.lastUsedAt) || 0;
  var nowMs = Number(now) || Date.now();
  var th = Number(thresholdHours) || 5;
  if (hasOpenTab) return false;
  if (lastUsedAt === 0) return true;
  return (nowMs - lastUsedAt) >= (th * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Limiteur de lancement (FEATURES.md P1 « Respect de minDelayBetweenAutomationsMinutes
// et maxConcurrentJobs »). Fonctions pures testables : l'orchestration Electron
// (scheduler/index.js) les appelle avant de passer un job en RUNNING.
// ---------------------------------------------------------------------------

// Compte les jobs actuellement en cours d'exécution (état RUNNING).
function countRunningJobs(jobs) {
  if (!Array.isArray(jobs)) return 0;
  return jobs.filter(function(j) { return j && j.status === 'RUNNING'; }).length;
}

// Vérifie si on peut lancer un nouveau job selon la limite maxConcurrentJobs.
// Renvoie true si le nombre de jobs RUNNING est strictement inférieur au max.
function canLaunchJob(jobs, config, now) {
  if (!config) return false;
  if (config.enabled === false) return false;
  var max = Number(config.maxConcurrentJobs);
  if (!(max > 0)) max = 1; // au moins 1 par défaut
  return countRunningJobs(jobs) < max;
}

// Vérifie si le délai minimum entre deux automatisations est respecté.
// `lastAutomationAt` est le timestamp (ms) de la dernière automatisation
// exécutée (n'importe quel compte). Renvoie true si assez de temps s'est écoulé.
function isMinDelayRespected(lastAutomationAt, minDelayMinutes, now) {
  var last = Number(lastAutomationAt) || 0;
  if (last === 0) return true; // jamais exécuté -> pas de délai à respecter
  var delay = Number(minDelayMinutes);
  if (!(delay > 0)) return true; // délai à 0 -> pas de restriction
  var nowMs = Number(now) || Date.now();
  return (nowMs - last) >= (delay * 60 * 1000);
}

// Vérifie si un job spécifique peut être lancé maintenant, en considérant
// toutes les contraintes : maxConcurrentJobs, minDelayBetweenAutomationsMinutes,
// et l'état du job (doit être RESUME_REQUIRED).
// Renvoie { canLaunch: bool, reason: string }.
function checkJobLaunchEligibility(job, jobs, config, lastAutomationAt, now) {
  if (!job) return { canLaunch: false, reason: 'Job introuvable.' };
  if (job.status !== 'RESUME_REQUIRED') {
    return { canLaunch: false, reason: 'Le job n\'est pas en attente de reprise (état : ' + job.status + ').' };
  }
  if (!config || config.enabled === false) {
    return { canLaunch: false, reason: 'L\'ordonnanceur est désactivé.' };
  }
  if (!canLaunchJob(jobs, config, now)) {
    var max = Number(config.maxConcurrentJobs) || 1;
    return { canLaunch: false, reason: 'Limite de jobs concurrents atteinte (' + countRunningJobs(jobs) + '/' + max + ').' };
  }
  if (!isMinDelayRespected(lastAutomationAt, config.minDelayBetweenAutomationsMinutes, now)) {
    var delay = Number(config.minDelayBetweenAutomationsMinutes) || 0;
    return { canLaunch: false, reason: 'Délai minimum entre automatisations non respecté (' + delay + ' min).' };
  }
  return { canLaunch: true, reason: 'OK' };
}

// Parmi tous les jobs en RESUME_REQUIRED, sélectionne le prochain job éligible
// au lancement (le plus ancien), en respectant maxConcurrentJobs et
// minDelayBetweenAutomationsMinutes. Renvoie le job ou null.
function selectNextJobToLaunch(jobs, config, lastAutomationAt, now) {
  if (!Array.isArray(jobs) || jobs.length === 0) return null;
  if (!config || config.enabled === false) return null;
  if (!canLaunchJob(jobs, config, now)) return null;
  if (!isMinDelayRespected(lastAutomationAt, config.minDelayBetweenAutomationsMinutes, now)) return null;
  // Parmi les jobs RESUME_REQUIRED, prendre le plus ancien (par createdAt)
  var candidates = jobs.filter(function(j) {
    return j && j.status === 'RESUME_REQUIRED';
  });
  if (candidates.length === 0) return null;
  candidates.sort(function(a, b) {
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Heures calmes (quiet hours) — pause du scheduler entre 15h00 et 20h30
// heure de Paris (Europe/Paris), pour éviter les réponses tronquées de Claude
// pendant les pics de charge. Fonction PURE, testable via node --test.
//
// La fenêtre est : 15:00 inclus → 20:30 exclus. En cas de changement d'heure
// d'été/hiver, Intl.DateTimeFormat gère automatiquement le décalage UTC.
// ---------------------------------------------------------------------------

// Renvoie true si l'instant donné tombe dans la fenêtre de pause.
// Paramètre `now` : Date ou timestamp ms (défaut : Date.now()).
function isFrenchQuietHours(now) {
  var date = (now instanceof Date) ? now : new Date(now || Date.now());
  // Formatage de l'heure en Europe/Paris — gère DST automatiquement.
  var parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  var hours = 0, minutes = 0;
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].type === 'hour') hours = parseInt(parts[i].value, 10);
    if (parts[i].type === 'minute') minutes = parseInt(parts[i].value, 10);
  }
  // Normaliser l'heure 24 (Intl peut renvoyer '24' pour minuit)
  if (hours === 24) hours = 0;
  var timeMinutes = hours * 60 + minutes;
  // Fenêtre : 15:00 (900) inclus → 20:30 (1230) exclus
  return timeMinutes >= 900 && timeMinutes < 1230;
}

// Renvoie le nombre de ms à attendre avant la fin de la pause, ou 0 si hors pause.
function quietHoursRemainingMs(now) {
  var date = (now instanceof Date) ? now : new Date(now || Date.now());
  if (!isFrenchQuietHours(date)) return 0;
  // Calculer la fin de la pause (20:30 Paris) pour aujourd'hui.
  // On utilise Intl pour obtenir l'heure Paris actuelle, puis on calcule
  // la différence jusqu'à 20:30.
  var parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  var hours = 0, minutes = 0, seconds = 0;
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].type === 'hour') hours = parseInt(parts[i].value, 10);
    if (parts[i].type === 'minute') minutes = parseInt(parts[i].value, 10);
    if (parts[i].type === 'second') seconds = parseInt(parts[i].value, 10);
  }
  if (hours === 24) hours = 0;
  var currentSec = hours * 3600 + minutes * 60 + seconds;
  var targetSec = 20 * 3600 + 30 * 60; // 20:30:00
  var waitSec = targetSec - currentSec;
  if (waitSec <= 0) return 0;
  return waitSec * 1000;
}

// Issue #328 : nom de partition d'une session Electron, lu dans son dossier
// de stockage (session.storagePath = <userData>/Partitions/<nom>). Electron
// écrit ce nom en minuscules et encodé façon URL (« Mon Profil » ->
// « mon%20profil », « é » -> « %C3%A9 », « % » -> « %25 »). Renvoie le nom
// décodé en minuscules, ou null (session sans dossier, hors Partitions, nom
// mal encodé). Sert à reconnaître le compte d'un onglet SANS appeler
// session.fromPartition, qui chargerait la session de chaque compte.
function partitionDepuisStoragePath(storagePath) {
  if (typeof storagePath !== 'string' || !storagePath) return null;
  var normalise = storagePath.replace(/\\/g, '/').replace(/\/+$/, '');
  var m = /(?:^|\/)Partitions\/(.+)$/.exec(normalise);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).toLowerCase(); }
  catch (e) { return null; }
}

module.exports = {
  JOB_STATES, ALLOWED_TRANSITIONS, isValidState, canTransition, nextJobState,
  isZipFilename, isTimestampedZipName, formatTimestamp, buildDeliveryPrompt,
  selectOldestEligibleProfile, CSV_COLUMNS, jobsToCSV, buildJobRecord, nextJobId,
  SERVICE_HOSTS, serviceFromHost, DEFAULT_CONFIG, partitionDepuisStoragePath,
  parseFeaturesMd, isProjectComplete,
  buildProjectRecord, buildTaskRecord, canAssignTaskToAccount,
  // Limiteur de lancement (lot 18/09/2026) — noms principaux + alias du plan
  countRunningJobs, canLaunchJob, isMinDelayRespected, checkJobLaunchEligibility,
  selectNextJobToLaunch,
  // Heures calmes (lot 18/09/2026) — pause 15h-20h30 Paris
  isFrenchQuietHours, quietHoursRemainingMs,
  // Alias correspondant au plan initial pour la documentation
  getRunningJobsCount: countRunningJobs,
  isMaxConcurrentReached: function(jobs, config, now) { return !canLaunchJob(jobs, config, now); },
  selectEligibleJobForLaunch: selectNextJobToLaunch
};
