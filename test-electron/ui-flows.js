'use strict';
// ---------------------------------------------------------------------------
// test-electron/ui-flows.js — harnais d'intégration Electron pour les flux UI
// non couverts par popups-continue.js.
//
// Cibles (issue #5) :
//   C1. Rendu du panneau comptes (renderAccounts) : cartes, boutons, escapeHtml
//   C2. Ajout/suppression de comptes via l'UI (data-action delegation)
//   C3. Bascule de thème (settings) : data-theme sur <html>
//   C4. Explorateur de fichiers : ouverture du panneau + rendu
//   C5. Restauration d'onglets au démarrage (serialize/deserialize)
//
// Usage :
//   xvfb-run -a npx electron --no-sandbox test-electron/ui-flows.js
//
// Mêmes contraintes que popups-continue.js : fixtures locales uniquement,
// aucun accès réseau.
// ---------------------------------------------------------------------------

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const v8cov = require('./v8-coverage');

// Les runners auto-hébergés tournent en conteneur, avec un /dev/shm de 64 Mo
// (valeur par défaut de Docker). Chromium y place la mémoire partagée de ses
// processus de rendu : mesuré en local avec la même limite, le harnais monte
// déjà à 58 Mo sur dev et la dépasse dès que la page s'alourdit (logos de
// #324) ; le renderer s'arrête alors (« crashed », code 133), comme dans les
// crashs intermittents de #283. Option Chromium prévue pour les conteneurs :
// la mémoire partagée passe par le dossier temporaire au lieu de /dev/shm.
app.commandLine.appendSwitch('disable-dev-shm-usage');

// Issue #51, lot 3 : sans demande explicite, l'interface suit la langue du
// système. Les scénarios vérifient les libellés français (langue source) :
// on l'impose, sauf dans C7.2/C7.3 qui changent la langue eux-mêmes.
process.env.IAO_LANG = 'fr';

// Mesure optionnelle (issue #100) : IAO_COVERAGE=1 affiche la couverture V8 de
// assets/app.js. Purement informatif : n'affecte JAMAIS le code de sortie.
const MEASURE_COVERAGE = process.env.IAO_COVERAGE === '1';

// --- Mini framework de test (identique à popups-continue.js) ---------------
let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion échouée');
}

// Issue #283 : un processus de rendu qui plante (vu en CI : « crashed », code
// 133) laissait executeJavaScript sans réponse ; le harnais attendait alors le
// délai global (180 s) sans dire pourquoi. Désormais :
//   - le crash fait échouer IMMÉDIATEMENT le test en cours (raison + code) ;
//   - chaque test a son propre délai (DELAI_PAR_TEST_MS) ;
//   - après un crash, la page est rechargée pour exécuter les tests restants
//     (le job reste en échec : un crash n'est jamais masqué ni rejoué) ;
//   - le délai global et le résumé nomment l'étape en cours.
const DELAI_PAR_TEST_MS = Number(process.env.IAO_UI_DELAI_TEST_MS) || 60000;
let etapeCourante = 'préparation (avant le premier test)';
const crashs = [];              // { etape, raison, code }
let rejeterTestEnCours = null;  // rejette le test en cours (crash du renderer)
let recupererApresCrash = null; // défini par run() : rechargement de la page
let crashARecuperer = false;

function signalerCrash(details) {
  const crash = { etape: etapeCourante, raison: details && details.reason, code: details && details.exitCode };
  crashs.push(crash);
  crashARecuperer = true;
  console.log('CRASH du processus de rendu pendant « ' + crash.etape + ' » : ' + crash.raison + ' (code ' + crash.code + ')');
  if (rejeterTestEnCours) {
    rejeterTestEnCours(new Error('processus de rendu arrêté : ' + crash.raison + ' (code ' + crash.code + ')'));
  }
}

async function recupererSiNecessaire() {
  if (!crashARecuperer || !recupererApresCrash) return;
  crashARecuperer = false;
  try {
    await recupererApresCrash();
    console.log('  (page rechargée après le crash : les tests suivants continuent)');
  } catch (e) {
    console.log('  (rechargement après le crash impossible : ' + (e && e.message ? e.message : e) + ')');
  }
}

async function test(name, fn) {
  // Crash survenu entre deux tests : recharger AVANT d'exécuter celui-ci.
  await recupererSiNecessaire();
  etapeCourante = name;
  let minuteur = null;
  try {
    const corps = simulerSiDemande(name) === 'blocage' ? () => new Promise(() => {}) : fn;
    await Promise.race([
      Promise.resolve().then(corps),
      new Promise((_, rejeter) => {
        rejeterTestEnCours = rejeter;
        minuteur = setTimeout(() => rejeter(new Error('délai du test dépassé (' + (DELAI_PAR_TEST_MS / 1000) + ' s)')), DELAI_PAR_TEST_MS);
      })
    ]);
    passed += 1;
    console.log('ok - ' + name);
  } catch (e) {
    failed += 1;
    // Après un crash, les échecs suivants peuvent n'en être que la conséquence
    // (état de la page perdu) : on le dit, pour ne pas chercher une 2e cause.
    const avant = crashs.filter((c) => c.etape !== name);
    const suffixe = avant.length ? ' [après le crash du renderer pendant « ' + avant[avant.length - 1].etape + ' »]' : '';
    const message = (e && e.message ? e.message : String(e)) + suffixe;
    failures.push({ name: name, error: new Error(message) });
    console.log('NOT OK - ' + name + ' : ' + message);
  } finally {
    clearTimeout(minuteur);
    rejeterTestEnCours = null;
  }
  await recupererSiNecessaire();
}

// Vérification du filet de sécurité lui-même (jamais en CI) :
//   IAO_UI_SIMULER=crash:C8.1   -> plante le renderer au début de ce test
//   IAO_UI_SIMULER=blocage:C8.1 -> fait attendre ce test indéfiniment
let fenetreSimulation = null;
function simulerSiDemande(name) {
  const m = /^(crash|blocage):(.+)$/.exec(process.env.IAO_UI_SIMULER || '');
  if (!m || !name.startsWith(m[2] + ' ')) return;
  if (m[1] === 'crash' && fenetreSimulation) {
    console.log('  (simulation : crash forcé du renderer)');
    fenetreSimulation.webContents.forcefullyCrashRenderer();
  }
  if (m[1] === 'blocage') {
    console.log('  (simulation : blocage du test)');
    return 'blocage';
  }
  return m[1];
}

function resumeInterrompu() {
  return 'pass ' + passed + ' / fail ' + failed + ' avant l\'abandon' +
    (crashs.length ? ' ; crash(s) du renderer : ' + crashs.map((c) => '« ' + c.etape + ' » (' + c.raison + ', code ' + c.code + ')').join(', ') : '');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

app.disableHardwareAcceleration();

// Garde-fou : 180 s (ces tests sont plus simples que popups-continue).
setTimeout(() => {
  console.error('TIMEOUT global du harnais UI (180 s) — abandon pendant « ' + etapeCourante + ' » — ' + resumeInterrompu() + '.');
  process.exit(2);
}, 180000);

async function run() {
  // =========================================================================
  // Préparation : environnement userData ISOLÉ + seed de comptes
  // =========================================================================
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iao-ui-'));
  app.setPath('appData', tmpRoot);
  app.setAppPath(path.join(__dirname, '..'));

  // Seed : 2 comptes dans localStorage (via le renderer au chargement)
  // On seed directement le localStorage en injectant du JS avant initApp.
  // Les comptes doivent être valides (migrateOldAccounts les complète).
  const seedAccounts = [
    {
      id: 'acc_test_1',
      name: 'Compte Test Un',
      email: 'test1@example.com',
      profile: 'profil_1',
      color: '#ffb347',
      services: ['claude', 'chatgpt', 'gemini'],
      cooldowns: { claude: 0, chatgpt: 0, gemini: 0, perplexity: 0, zeta: 0, grok: 0, leonardo: 0, suno: 0, meshy: 0 },
      automation: { enabled: true, lastUsedAt: 0, lastAutomationAt: 0 }
    },
    {
      id: 'acc_test_2',
      name: '<script>alert(1)</script>', // Test escapeHtml
      email: 'test2@example.com',
      profile: 'profil_2',
      color: '#8b5cf6',
      services: ['claude', 'perplexity'],
      cooldowns: { claude: 0, chatgpt: 0, gemini: 0, perplexity: 0, zeta: 0, grok: 0, leonardo: 0, suno: 0, meshy: 0 },
      automation: { enabled: true, lastUsedAt: 0, lastAutomationAt: 0 }
    }
  ];

  // Seed onglets persistés (pour le test de restauration)
  const seedTabs = [
    { accId: 'acc_test_1', svcId: 'claude' },
    { accId: 'acc_test_1', svcId: 'chatgpt' }
  ];

  // Créer un dossier de test pour l'explorateur
  const testDir = path.join(tmpRoot, 'test-folder');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, 'test-file.txt'), 'Hello IAO', 'utf-8');
  fs.mkdirSync(path.join(testDir, 'subfolder'), { recursive: true });
  fs.writeFileSync(path.join(testDir, 'subfolder', 'nested.js'), 'console.log("nested")', 'utf-8');

  // Stub shell.openExternal
  try {
    const shell = require('electron').shell;
    shell.openExternal = function () { return Promise.resolve(); };
  } catch (e) { /* best-effort */ }

  // Aucun accès réseau (issue #54) : ouvrir un service crée une <webview> vers
  // https://claude.ai… — on annule toute requête http(s) dans TOUTES les
  // sessions (défaut + partitions persist:profil_N), la webview reste vide.
  const blockNetwork = (ses) => {
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }));
  };
  app.on('session-created', blockNetwork);

  // Chargement de l'application RÉELLE
  require('../main.js');

  let win = null;
  for (let i = 0; i < 150 && !win; i++) {
    win = BrowserWindow.getAllWindows().find(w => {
      try { return !w.isDestroyed() && w.webContents.getURL().endsWith('index.html'); }
      catch (e) { return false; }
    });
    if (!win) await sleep(100);
  }
  assert(win, 'fenêtre principale jamais créée');
  fenetreSimulation = win;
  win.webContents.on('render-process-gone', (_e, details) => signalerCrash(details));

  const waitLoaded = async () => {
    for (let i = 0; i < 100; i++) {
      if (!win.webContents.isLoading()) break;
      await sleep(100);
    }
    await sleep(800); // initApp + loadSettings (IPC asynchrone)
  };
  recupererApresCrash = async () => {
    win.webContents.reload();
    await sleep(300);
    await waitLoaded();
  };
  await waitLoaded();

  // Utilitaire : exécuter du JS dans le renderer
  const exec = (script) => win.webContents.executeJavaScript(script);

  // Utilitaire : IPC via le pont du preload (issue #4 : plus de module.require
  // dans le renderer, contextIsolation: true).
  const ipc = (channel, ...args) => exec(
    'window.iaoAPI.ipcInvoke(' + JSON.stringify(channel) +
    (args.length ? ', ' + args.map(a => JSON.stringify(a)).join(', ') : '') + ')'
  );

  // Seed : initApp lit ses comptes AU DÉMARRAGE -> on écrit puis on RECHARGE
  // la page (renderAccounts n'est pas exposée globalement, à dessein).
  // Issue #311 : les comptes sont semés dans l'ancien emplacement
  // (localStorage) ; le rechargement les migre dans <userData>/profils.json
  // (vérifié par C8.0).
  // startWithLastSession est activé pour tester la restauration des onglets.
  const saved = await ipc('settings:save', { startWithLastSession: true });
  assert(saved && saved.ok, 'settings:save a échoué : ' + JSON.stringify(saved));
  await exec(`
    localStorage.setItem('ai_accounts', ${JSON.stringify(JSON.stringify(seedAccounts))});
    localStorage.setItem('ai_open_tabs', ${JSON.stringify(JSON.stringify(seedTabs))});
    'injected'
  `);
  if (MEASURE_COVERAGE) {
    try { await v8cov.startCoverage(win.webContents); }
    catch (e) { console.log('COV démarrage impossible : ' + e.message); }
  }
  win.webContents.reload();
  await sleep(300);
  await waitLoaded();

  // =========================================================================
  // C0 — Démarrage sain (issue #52)
  // =========================================================================
  console.log('\n--- C0 : Démarrage ---');

  await test('C0.1 le preload est chargé (window.iaoAPI) et aucun bandeau d\'erreur', async () => {
    assert(await exec('typeof window.iaoAPI === "object"'), 'window.iaoAPI absent : preload non exécuté');
    assert(await exec('document.getElementById("bootError") === null'), 'bandeau d\'erreur de démarrage affiché');
  });

  await test('C0.3 ERR_ABORTED (-3) non rattrapé : pas de bandeau ; une vraie erreur réseau en affiche un (#185)', async () => {
    const r = await exec(`new Promise((resolve) => {
      Promise.reject(new Error("Error invoking remote method 'GUEST_VIEW_MANAGER_CALL': Error: ERR_ABORTED (-3) loading 'https://claude.ai/new'"));
      setTimeout(() => {
        const afterAbort = document.getElementById('bootError') !== null;
        Promise.reject(new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://chat.z.ai/'"));
        setTimeout(() => {
          const banner = document.getElementById('bootError');
          const afterRealError = banner !== null;
          if (banner) banner.remove(); // la suite du harnais attend une page sans bandeau
          resolve({ afterAbort, afterRealError });
        }, 100);
      }, 100);
    })`);
    assert(!r.afterAbort, 'bandeau affiché pour une navigation remplacée (ERR_ABORTED -3)');
    assert(r.afterRealError, 'aucun bandeau pour une vraie erreur réseau (ERR_NAME_NOT_RESOLVED)');
  });

  await test('C0.2 toutes les icônes statiques sont hydratées (SVG)', async () => {
    const r = await exec(`({ total: document.querySelectorAll('span.ic[data-icon]').length,
      done: document.querySelectorAll('span.ic[data-icon] svg').length })`);
    assert(r.total > 0, 'aucune icône dans la page');
    assert(r.done === r.total, 'icônes non hydratées : ' + r.done + '/' + r.total);
  });

  // =========================================================================
  // C1 — Rendu du panneau comptes
  // =========================================================================
  console.log('\n--- C1 : Rendu du panneau comptes ---');

  await test('C1.1 renderAccounts affiche 2 cartes de comptes', async () => {
    const count = await exec('document.querySelectorAll(\'#accountsList .account-card\').length');
    assert(count === 2, 'attendu 2 cartes, trouvé ' + count);
  });

  // Issue #203 : état du dossier de données dans le vrai iao.log.
  await test('C1.1b iao.log contient l\'état du dossier de données (#203)', async () => {
    const journal = path.join(tmpRoot, 'ai-manager', 'logs', 'iao.log');
    const texte = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf-8') : '';
    assert(/\[demarrage\] info Dossier de données .* — Local Storage : .* — partitions : \d+ \(dont \d+ avec un dossier Service Worker\)/.test(texte),
      'ligne du dossier de données absente de ' + journal);
  });

  await test('C1.2 Le nom du compte est échappé (escapeHtml — pas de <script>)', async () => {
    const r = await exec(`(() => {
      const list = document.getElementById('accountsList');
      return { scripts: list.querySelectorAll('script').length,
               escaped: list.textContent.indexOf('<script>alert(1)</script>') !== -1 };
    })()`);
    assert(r.scripts === 0, 'un élément <script> a été injecté dans la liste des comptes');
    assert(r.escaped, 'le nom « <script>… » n\'est pas affiché tel quel (texte échappé)');
  });

  await test('C1.3 Chaque carte a des boutons de service (data-action)', async () => {
    const cards = await exec('document.querySelectorAll(\'#accountsList .account-card\').length');
    assert(cards > 0, 'aucune carte');
    for (let i = 0; i < cards; i++) {
      const btns = await exec(`document.querySelectorAll('#accountsList .account-card')[${i}].querySelectorAll('[data-action="open-service"]').length`);
      assert(btns > 0, 'carte ' + i + ' : aucun bouton open-service');
    }
  });

  await test('C1.4 Le bouton « Ajouter un compte » ouvre la modale', async () => {
    const opened = await exec(`(() => {
      const btn = document.querySelector('[data-action="ui-openModal"]');
      if (!btn) return 'absent';
      btn.click();
      const open = document.getElementById('accountModal').classList.contains('open');
      window.closeModal && window.closeModal();
      return open;
    })()`);
    assert(opened === true, 'modale d\'ajout non ouverte (' + opened + ')');
  });

  await test('C1.5 Les statistiques reflètent les comptes seedés', async () => {
    const txt = await exec('document.querySelector(".dashboard").innerText');
    assert(/COMPTES ACTIFS\s*2/i.test(txt), 'compteur « comptes actifs » ≠ 2 : ' + txt.slice(0, 120));
  });

  // Issue #319 : la sélection « mes IA à portée de main » remplace les services des cartes,
  // sans cumul au redémarrage, et un compte créé ne reçoit qu'elle.
  await test('C1.6 Choix des IA : remplacement immédiat, sans cumul au rechargement, appliqué aux nouveaux comptes (#319)', async () => {
    const lire = () => exec(`(() => {
      const cartes = [...document.querySelectorAll('#accountsList .account-card')];
      return cartes.map(c => [...c.querySelectorAll('[data-action="open-service"]')].map(b => b.dataset.svc).join(','));
    })()`);
    const avant = await lire();
    await exec(`(() => {
      openServicesModal();
      const cb = (id) => document.querySelector('#servicesList [data-svc-id="' + id + '"]');
      const list = document.getElementById('servicesList');
      cb('meshy').checked = false; list.onchange({ target: cb('meshy') });
      cb('deepseek').checked = true; list.onchange({ target: cb('deepseek') });
      saveServicesModal();
      return 'ok';
    })()`);
    const attendu = 'claude,chatgpt,gemini,zeta,perplexity,grok,leonardo,suno,deepseek';
    const apres = await lire();
    win.webContents.reload();
    await sleep(300);
    await waitLoaded();
    const recharge = await lire();
    const nouveau = await exec(`(() => {
      openModal();
      document.getElementById('inputName').value = 'Compte 319';
      document.getElementById('inputEmail').value = 'c319@example.com';
      document.getElementById('inputProfile').value = 'profil_319';
      saveAccount();
      const comptes = JSON.parse(localStorage.getItem('ai_accounts'));
      const c = comptes.find(a => a.profile === 'profil_319');
      const services = c ? c.services.join(',') : null;
      if (c) {
        localStorage.setItem('ai_accounts', JSON.stringify(comptes.filter(a => a.profile !== 'profil_319')));
      }
      localStorage.removeItem('ai_active_services'); // la suite du harnais attend la sélection par défaut
      return services;
    })()`);
    win.webContents.reload();
    await sleep(300);
    await waitLoaded();
    const final = await lire();
    assert(avant.every(l => l.split(',').length === 9 && l.includes('meshy')), 'avant : ' + JSON.stringify(avant));
    assert(apres.length === 2 && apres.every(l => l === attendu), 'après enregistrement : ' + JSON.stringify(apres));
    assert(recharge.every(l => l === attendu), 'au rechargement (anciens + nouveaux ?) : ' + JSON.stringify(recharge));
    assert(nouveau === attendu, 'nouveau compte : ' + nouveau);
    assert(final.length === 2 && final.every(l => l === avant[0]), 'retour à la sélection par défaut : ' + JSON.stringify(final));
  });

  // Issue #319 (suite) : de 1 à n IA, plus de plafond à 9.
  await test('C1.7 Choix des IA : 1 seule, puis toutes (plus de plafond à 9) (#319)', async () => {
    const choisir = (ids) => exec(`(() => {
      openServicesModal();
      const list = document.getElementById('servicesList');
      const voulus = ${JSON.stringify(ids)};
      [...list.querySelectorAll('[data-svc-id]')].forEach((cb) => {
        const coche = voulus === 'tous' || voulus.includes(cb.dataset.svcId);
        if (cb.checked !== coche) { cb.checked = coche; list.onchange({ target: cb }); }
      });
      saveServicesModal();
      const carte = document.querySelector('#accountsList .account-card');
      return { boutons: carte.querySelectorAll('[data-action="open-service"]').length,
        total: list.querySelectorAll('[data-svc-id]').length,
        stocke: JSON.parse(localStorage.getItem('ai_active_services')).length };
    })()`);
    const un = await choisir(['claude']);
    const tous = await choisir('tous');
    await exec(`localStorage.removeItem('ai_active_services'); 'ok'`);
    win.webContents.reload();
    await sleep(300);
    await waitLoaded();
    const defaut = await exec(`document.querySelector('#accountsList .account-card').querySelectorAll('[data-action="open-service"]').length`);
    assert(un.boutons === 1 && un.stocke === 1, 'une seule IA : ' + JSON.stringify(un));
    assert(tous.total > 9 && tous.boutons === tous.total && tous.stocke === tous.total, 'toutes les IA : ' + JSON.stringify(tous));
    assert(defaut === 9, 'retour à la sélection par défaut : ' + defaut);
  });

  // =========================================================================
  // C2 — Réglages et thème
  // =========================================================================
  console.log('\n--- C2 : Réglages et thème ---');

  await test('C2.1 Le thème par défaut est posé sur <html> (data-theme)', async () => {
    const theme = await exec('document.documentElement.getAttribute(\'data-theme\')');
    assert(theme !== null && theme !== '', 'aucun data-theme sur <html>');
  });

  await test('C2.2 Le bouton Réglages ouvre la modale (délégation data-action)', async () => {
    const r = await exec(`(() => {
      const btn = document.querySelector('[data-action="ui-openSettingsModal"]');
      if (!btn) return 'bouton absent';
      btn.click();
      return document.getElementById('settingsModal').classList.contains('open');
    })()`);
    assert(r === true, 'modale de réglages non ouverte (' + r + ')');
    await sleep(300);
    const checked = await exec('document.getElementById("settingsStartWithLastSession").checked');
    assert(checked === true, 'réglage startWithLastSession non reflété dans la modale');
    await exec('window.closeSettingsModal(); "ok"');
  });

  // =========================================================================
  // C3 — Explorateur de fichiers
  // =========================================================================
  console.log('\n--- C3 : Explorateur de fichiers ---');

  await test('C3.1 Le panneau explorateur existe dans le DOM', async () => {
    const explorer = await exec('document.querySelector(\'#fileExplorer\') !== null');
    assert(explorer, 'panneau #fileExplorer absent du DOM');
  });

  await test('C3.2 Le bouton Explorateur bascule le panneau', async () => {
    const before = await exec('document.getElementById("fileExplorer").classList.contains("collapsed")');
    await exec('document.querySelector(\'[data-action="ui-toggleExplorer"]\').click(); "ok"');
    await sleep(200);
    const after = await exec('document.getElementById("fileExplorer").classList.contains("collapsed")');
    assert(before !== after, 'le panneau n\'a pas changé d\'état (collapsed=' + before + ')');
  });

  await test('C3.3 read-directory-recursive liste les fichiers et sous-dossiers', async () => {
    const files = await ipc('read-directory-recursive', testDir);
    const rels = files.map(f => f.relativePath).sort();
    assert(rels.includes('test-file.txt'), 'test-file.txt absent : ' + rels.join(', '));
    assert(rels.includes('subfolder/nested.js'), 'subfolder/nested.js absent : ' + rels.join(', '));
  });

  // Issue #199, lot 1 : l'ancien ordonnanceur (ZIP, jobs, projets) est
  // désactivé ; le panneau l'annonce, le bouton Démarrer est masqué et un
  // démarrage par IPC est refusé (le comportement #181 reste testé par
  // test/scheduler-state-config.test.js avec IAO_ORDONNANCEUR_ANCIEN=1).
  await test('C3.4 Ancien ordonnanceur désactivé : bandeau, pas de démarrage (#199)', async () => {
    const etat0 = await ipc('scheduler:get-state');
    assert(etat0 && etat0.config && etat0.config.enabled === false, 'ordonnanceur actif au démarrage');
    assert(etat0.ancienFlux === false, 'ancien flux actif par défaut');
    await exec('window.openSchedulerModal(); "ok"');
    await sleep(300);
    const visible = (id) => exec('(function(){var e=document.getElementById("' + id + '");' +
      'return !!e && !e.hidden && getComputedStyle(e).display !== "none";})()');
    // Lot 4 : l'interface des tâches programmables remplace le bandeau
    // « en cours de développement » du lot 1 (issue #199).
    assert(await visible('schedTaches'), 'interface des tâches programmables absente');
    assert(!(await visible('schedLegacyOff')), 'bandeau obsolète du lot 1 encore affiché');
    assert(!(await visible('schedLegacy')), 'sections de l\'ancien flux visibles');
    assert(!(await visible('schedRun')), 'bouton Démarrer visible');
    assert(await visible('schedLog'), 'journal d\'activité masqué');
    const cfg = await ipc('scheduler:set-enabled', true);
    assert(cfg && cfg.enabled === false, 'démarrage par IPC accepté');
    await exec('window.closeSchedulerModal(); "ok"');
  });

  // =========================================================================
  // C4 — Restauration et persistance des onglets
  // =========================================================================
  console.log('\n--- C4 : Onglets ---');

  await test('C4.1 serializeOpenTabs/deserializeOpenTabs sont exposés (lib/settings.js)', async () => {
    assert(await exec('typeof window.serializeOpenTabs === \'function\''), 'serializeOpenTabs non exposé sur window');
    assert(await exec('typeof window.deserializeOpenTabs === \'function\''), 'deserializeOpenTabs non exposé sur window');
  });

  await test('C4.2 Les 2 onglets persistés sont restaurés au démarrage (startWithLastSession)', async () => {
    const n = await exec('document.querySelectorAll("#tabsBar .tab").length');
    assert(n === 2, 'attendu 2 onglets restaurés, trouvé ' + n);
  });

  await test('C4.3 Ouvrir un service ajoute un onglet et le persiste', async () => {
    await exec(`document.querySelector('#accountsList [data-action="open-service"][data-acc="acc_test_2"][data-svc="perplexity"]').click(); 'ok'`);
    await sleep(400);
    const n = await exec('document.querySelectorAll("#tabsBar .tab").length');
    assert(n === 3, 'attendu 3 onglets, trouvé ' + n);
    const stored = JSON.parse(await exec('localStorage.getItem("ai_open_tabs")'));
    assert(stored.some(t => t.accId === 'acc_test_2' && t.svcId === 'perplexity'),
      'onglet non persisté : ' + JSON.stringify(stored));
  });

  await test('C4.4 Rouvrir le même couple (compte, service) réutilise l\'onglet', async () => {
    await exec(`document.querySelector('#accountsList [data-action="open-service"][data-acc="acc_test_1"][data-svc="claude"]').click(); 'ok'`);
    await sleep(300);
    const n = await exec('document.querySelectorAll("#tabsBar .tab").length');
    assert(n === 3, 'un doublon d\'onglet a été créé (' + n + ' onglets)');
  });

  // =========================================================================
  // C5 — Barre d'onglets
  // =========================================================================
  console.log('\n--- C5 : Barre d\'onglets ---');

  await test('C5.1 Les onglets utilisent la délégation d\'événements (data-action)', async () => {
    const r = await exec(`({ activate: document.querySelectorAll('#tabsBar [data-action="activate-tab"]').length,
      close: document.querySelectorAll('#tabsBar [data-action="close-tab"]').length })`);
    assert(r.activate === 3 && r.close === 3, 'data-action attendus sur 3 onglets : ' + JSON.stringify(r));
  });

  await test('C5.2 Aucun onclick généré dans la barre d\'onglets ni les cartes (invariant 2)', async () => {
    const n = await exec('document.querySelectorAll("#tabsBar [onclick], #accountsList [onclick]").length');
    assert(n === 0, n + ' attribut(s) onclick généré(s)');
  });

  // Issue #324 : logos officiels devant le nom (boutons, aide, choix des IA),
  // boutons de couleur standard, onglet = logo + nom du compte.
  await test('C5.3 Logos des IA : boutons standard, onglet logo + compte, aide et choix des IA (#324)', async () => {
    const r = await exec(`(() => {
      const boutons = [...document.querySelectorAll('#accountsList .svc-btn')];
      const onglets = [...document.querySelectorAll('#tabsBar .tab')];
      openHelpModal();
      const aide = [...document.querySelectorAll('#helpModal .help-entry__name')];
      const resAide = { n: aide.length, logos: aide.filter(e => e.querySelector('.svc-ic')).length };
      document.getElementById('helpModal').classList.remove('open');
      openServicesModal();
      const choix = [...document.querySelectorAll('#servicesList .service-select-item')];
      const resChoix = { n: choix.length, logos: choix.filter(e => e.querySelector('.svc-ic')).length };
      return {
        boutons: boutons.length,
        avecLogo: boutons.filter(b => b.querySelector('.svc-ic svg, .svc-ic--lettre')).length,
        colores: boutons.filter(b => [...b.classList].some(c => /^svc-(?!btn)/.test(c))).length,
        fondClaude: getComputedStyle(document.querySelector('#accountsList .svc-btn[data-svc="claude"]')).backgroundColor,
        fondGrok: getComputedStyle(document.querySelector('#accountsList .svc-btn[data-svc="grok"]')).backgroundColor,
        onglets: onglets.length,
        ongletsOk: onglets.filter(t => t.querySelector('.svc-ic') && !t.querySelector('.tab__acc') && t.title.includes('—')).length,
        aide: resAide, choix: resChoix
      };
    })()`);
    if (process.env.IAO_CAPTURES_DIR) {
      const dossier = require('./rtl-visuel').dossierCaptures(process.env.IAO_CAPTURES_DIR);
      fs.writeFileSync(path.join(dossier, 'logos-choix.png'), (await win.webContents.capturePage()).toPNG());
      await exec(`closeServicesModal(); openHelpModal(); 'ok'`);
      fs.writeFileSync(path.join(dossier, 'logos-aide.png'), (await win.webContents.capturePage()).toPNG());
      await exec(`document.getElementById('helpModal').classList.remove('open'); 'ok'`);
      fs.writeFileSync(path.join(dossier, 'logos-cartes.png'), (await win.webContents.capturePage()).toPNG());
    }
    await exec(`closeServicesModal(); document.getElementById('helpModal').classList.remove('open'); 'ok'`);
    assert(r.boutons > 0 && r.avecLogo === r.boutons, 'boutons sans logo : ' + JSON.stringify(r));
    assert(r.colores === 0, 'boutons encore colorés par service : ' + r.colores);
    assert(r.fondClaude === r.fondGrok, 'fonds différents : ' + r.fondClaude + ' / ' + r.fondGrok);
    assert(r.onglets > 0 && r.ongletsOk === r.onglets, 'onglets : ' + JSON.stringify(r));
    assert(r.aide.n > 9 && r.aide.logos === r.aide.n, 'aide : ' + JSON.stringify(r.aide));
    assert(r.choix.n > 9 && r.choix.logos === r.choix.n, 'choix des IA : ' + JSON.stringify(r.choix));
  });

  // =========================================================================
  // C6. Issue #149 : menu natif masqué, barre du workspace, bouton Ctrl+K
  // =========================================================================
  await test('C6.1 La barre de menu native est masquée (le menu garde ses raccourcis)', async () => {
    assert(win.isMenuBarVisible() === false, 'barre de menu visible');
    assert(require('electron').Menu.getApplicationMenu() !== null, 'menu applicatif supprimé : raccourcis perdus');
  });

  await test('C6.2 Nom de l\'app, Explorateur, Éditeur et outils de dév. dans la barre du workspace', async () => {
    const r = await exec(`(() => {
      const bar = document.querySelector('.workspace-header');
      return {
        brand: bar.querySelector('.app-brand__title') && bar.querySelector('.app-brand__title').textContent,
        actions: [...bar.querySelectorAll('[data-action]')].map(b => b.getAttribute('data-action')),
        ancien: !!document.querySelector('#dashboard header, .header__brand')
      };
    })()`);
    assert(r.brand === 'IAO', 'nom de l\'app absent de la barre : ' + r.brand);
    const i = r.actions.indexOf('ui-toggleIdePanel');
    assert(r.actions.indexOf('ui-toggleExplorer') >= 0 && i >= 0, 'Explorateur/Éditeur absents : ' + r.actions);
    assert(r.actions[i + 1] === 'ui-toggleDevTools', 'outils de dév. pas à côté de l\'Éditeur : ' + r.actions);
    assert(r.ancien === false, 'ancien en-tête encore présent dans la barre latérale');
  });

  await test('C6.3 Le bouton Ctrl+K, à côté des compteurs, ouvre la palette', async () => {
    const r = await exec(`(() => {
      const stats = document.querySelector('#dashboard .stats');
      const btn = stats.querySelector('#btnOpenPalette');
      if (!btn) return { btn: false };
      btn.click();
      const open = document.getElementById('paletteOverlay').classList.contains('open');
      const focus = document.activeElement && document.activeElement.id;
      document.getElementById('paletteOverlay').classList.remove('open');
      return { btn: true, cartes: stats.querySelectorAll('.stat-card').length, open, focus };
    })()`);
    assert(r.btn, 'bouton Ctrl+K absent de la ligne des compteurs');
    assert(r.cartes === 2 && r.open === true && r.focus === 'paletteInput', JSON.stringify(r));
  });

  await test('C6.4 Le bouton des outils de développement les ouvre puis les referme', async () => {
    const ouvert = await exec('window.toggleDevTools()');
    assert(ouvert === true, 'app:toggle-devtools refusé : ' + ouvert);
    for (let i = 0; i < 30 && !win.webContents.isDevToolsOpened(); i++) await sleep(100);
    assert(win.webContents.isDevToolsOpened(), 'outils de développement non ouverts');
    await exec('window.toggleDevTools()');
    for (let i = 0; i < 30 && win.webContents.isDevToolsOpened(); i++) await sleep(100);
    assert(!win.webContents.isDevToolsOpened(), 'outils de développement non refermés');
  });

  // =========================================================================
  // C7 — Internationalisation (issue #51)
  // =========================================================================
  await test('C6.5 Bouton « Redémarrer en mode debug » présent, câblé et visible hors mode debug (#187)', async () => {
    const r = await exec(`(() => {
      const b = document.getElementById('btnRelaunchDebug');
      return { exists: !!b, action: b && b.getAttribute('data-action'), hidden: b ? b.classList.contains('hidden') : null,
        fn: typeof window.relaunchDebug };
    })()`);
    assert(r.exists, 'bouton absent');
    assert(r.action === 'ui-relaunchDebug', 'data-action : ' + r.action);
    assert(r.hidden === false, 'bouton masqué hors mode debug');
    assert(r.fn === 'function', 'window.relaunchDebug absente');
    // Issue #317 : « Redémarrer IAO » (mode normal), toujours visible.
    const n = await exec(`(() => {
      const b = document.getElementById('btnRelaunch');
      return { exists: !!b, action: b && b.getAttribute('data-action'), hidden: b ? b.classList.contains('hidden') : null,
        fn: typeof window.relaunchNormal };
    })()`);
    assert(n.exists && n.action === 'ui-relaunch' && n.hidden === false, 'bouton Redémarrer IAO : ' + JSON.stringify(n));
    assert(n.fn === 'function', 'window.relaunchNormal absente');
    const logPath = await ipc('app:log-path');
    assert(typeof logPath === 'string' && /logs[\\/]iao\.log$/.test(logPath), 'chemin du journal : ' + logPath);
  });

  console.log('\n--- C7 : Internationalisation ---');

  await test('C7.1 IAO_LANG=fr : interface en français (langue source)', async () => {
    const r = await exec(`({ lang: document.documentElement.lang,
      title: document.querySelector('[data-action="ui-openModal"]').getAttribute('title') })`);
    assert(r.lang === 'fr', 'lang attendu fr, trouvé ' + r.lang);
    assert(r.title === 'Ajouter un compte', 'title inattendu : ' + r.title);
  });

  await test('C7.2 IAO_LANG=en traduit textes, title et placeholder sans casser les icônes', async () => {
    process.env.IAO_LANG = 'en';
    try {
      win.webContents.reload();
      await sleep(300);
      await waitLoaded();
      const r = await exec(`({
        lang: document.documentElement.lang,
        title: document.querySelector('[data-action="ui-openModal"]').getAttribute('title'),
        placeholder: document.getElementById('paletteInput').getAttribute('placeholder'),
        section: document.querySelector('.section-title--accounts span').textContent,
        icons: document.querySelectorAll('span.ic[data-icon]').length,
        svgs: document.querySelectorAll('span.ic[data-icon] svg').length,
        bootError: document.getElementById('bootError') !== null
      })`);
      assert(r.lang === 'en', 'lang attendu en, trouvé ' + r.lang);
      assert(r.title === 'Add an account', 'title non traduit : ' + r.title);
      assert(r.placeholder === 'Search for an account or an AI...', 'placeholder non traduit : ' + r.placeholder);
      assert(r.section === 'Saved accounts', 'texte non traduit : ' + r.section);
      assert(r.svgs === r.icons, 'icônes perdues après traduction : ' + r.svgs + '/' + r.icons);
      assert(!r.bootError, 'bandeau d\'erreur de démarrage affiché');
      // Lot 2 : libellés construits par app.js (toast « champs vides »).
      const toast = await exec(`(() => {
        ['inputName', 'inputEmail', 'inputProfile'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
        window.saveAccount();
        const all = document.querySelectorAll('#toastContainer .toast');
        return all.length ? all[all.length - 1].textContent.trim() : '';
      })()`);
      assert(toast === 'Fill in all the fields', 'toast non traduit : ' + toast);
      // Lot 4 : HTML construit par app.js (cartes de comptes, aide des services).
      const built = await exec(`(() => {
        window.openHelpModal();
        const label = document.querySelector('#helpList .help-entry__label');
        const line = document.querySelector('#helpList .help-entry__line');
        const copy = document.querySelector('.account-email-copy');
        window.closeHelpModal();
        return {
          label: label ? label.textContent : '',
          line: line ? line.textContent : '',
          copy: copy ? copy.getAttribute('title') : ''
        };
      })()`);
      assert(built.label === 'What is it?', 'aide non traduite : ' + built.label);
      assert(!/[éè]/.test(built.line) && built.line.length > 20, 'description non traduite : ' + built.line);
      assert(built.copy === 'Click to copy the email address', 'carte de compte non traduite : ' + built.copy);
    } finally {
      process.env.IAO_LANG = 'fr';
    }
  });

  await test('C7.4 IAO_LANG=ar : mise en page de droite à gauche, éditeur en gauche à droite', async () => {
    process.env.IAO_LANG = 'ar';
    try {
      win.webContents.reload();
      await sleep(300);
      await waitLoaded();
      const r = await exec(`({
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        body: getComputedStyle(document.body).direction,
        editor: getComputedStyle(document.getElementById('monacoContainer')).direction
      })`);
      assert(r.lang === 'ar', 'lang attendu ar, trouvé ' + r.lang);
      assert(r.dir === 'rtl' && r.body === 'rtl', 'sens attendu rtl, trouvé ' + r.dir + '/' + r.body);
      assert(r.editor === 'ltr', 'l\'éditeur doit rester ltr, trouvé ' + r.editor);
      process.env.IAO_LANG = 'en';
      win.webContents.reload();
      await sleep(300);
      await waitLoaded();
      const en = await exec(`document.documentElement.dir`);
      assert(en === 'ltr', 'en anglais, dir attendu ltr, trouvé ' + en);
    } finally {
      process.env.IAO_LANG = 'fr';
    }
  });

  await test('C7.5 Vérification visuelle RTL : miroir de la mise en page, poignées, aucun débordement, captures', async () => {
    const rtl = require('./rtl-visuel');
    const dossier = rtl.dossierCaptures(process.env.IAO_CAPTURES_DIR);
    const mesurer = async (lang) => {
      process.env.IAO_LANG = lang;
      win.webContents.reload();
      await sleep(300);
      await waitLoaded();
      await sleep(400); // icônes, polices et cartes de comptes rendues
      const m = await exec(rtl.SCRIPT_MESURE);
      const img = await win.webContents.capturePage();
      m.glisser = await exec(rtl.SCRIPT_GLISSER);
      fs.writeFileSync(path.join(dossier, 'ui-' + lang + '.png'), img.toPNG());
      m.png = img;
      return m;
    };
    try {
      const fr = await mesurer('fr');
      const ar = await mesurer('ar');
      const ecarts = rtl.comparer(fr, ar);
      fs.writeFileSync(path.join(dossier, 'rtl-rapport.json'),
        JSON.stringify({ fr: rtl.sansImage(fr), ar: rtl.sansImage(ar), ecarts }, null, 2));
      assert(ecarts.length === 0, 'mise en page RTL incorrecte (captures dans ' + dossier + ') :\n  - ' + ecarts.join('\n  - '));
    } finally {
      process.env.IAO_LANG = 'fr';
    }
  });

  await test('C7.3 Sans IAO_LANG ni réglage : langue du système, sélecteur rempli', async () => {
    const i18n = require('../lib/i18n');
    delete process.env.IAO_LANG;
    try {
      win.webContents.reload();
      await sleep(300);
      await waitLoaded();
      await sleep(200);
      const available = i18n.parseLinguas(fs.readFileSync(path.join(__dirname, '..', 'lang', 'LINGUAS'), 'utf8'));
      const sysList = app.getPreferredSystemLanguages();
      const system = sysList.length ? sysList : [app.getLocale()]; // même repli que main.js
      const expected = i18n.negotiateLocale(system, available, 'fr');
      const r = await exec(`({
        lang: document.documentElement.lang || 'fr',
        options: Array.from(document.querySelectorAll('#settingsLanguage option')).map((o) => o.value),
        selected: document.getElementById('settingsLanguage').value
      })`);
      assert(r.lang === expected, 'langue attendue ' + expected + ' (système : ' + system.join(',') + '), trouvée ' + r.lang);
      assert(r.options[0] === 'auto' && r.options.includes('en') && r.options.includes('fr'), 'sélecteur incomplet : ' + r.options.join(','));
      assert(r.selected === 'auto', 'réglage attendu auto, trouvé ' + r.selected);
    } finally {
      process.env.IAO_LANG = 'fr';
      win.webContents.reload();
      await sleep(300);
      await waitLoaded();
    }
  });

  // =========================================================================
  // C8 — Comptes absents au démarrage, restaurés depuis l'instantané (#186)
  // =========================================================================
  console.log('\n--- C8 : Restauration des comptes au démarrage ---');

  const profilsJson = path.join(app.getPath('userData'), 'profils.json');
  await test('C8.0 comptes dans profils.json (#311) : migration unique, localStorage vidé sans effet', async () => {
    assert(fs.existsSync(profilsJson), 'profils.json absent après la migration du seed');
    const fichier = JSON.parse(fs.readFileSync(profilsJson, 'utf-8'));
    assert(JSON.stringify(fichier.map((a) => a.profile)) === JSON.stringify(seedAccounts.map((a) => a.profile)),
      'profils.json : ' + fichier.map((a) => a.profile).join(','));
    const anciennes = await exec(`[localStorage.getItem('ai_accounts'), localStorage.getItem('ai_accounts_backup')]`);
    assert(anciennes[0] === null && anciennes[1] === null, 'anciennes clés de comptes encore dans le localStorage');
    // Perte du localStorage (cas de l'issue #311) : les comptes restent.
    await exec(`localStorage.removeItem('ai_accounts'); localStorage.removeItem('ai_accounts_backup'); localStorage.removeItem('ai_open_tabs'); 'ok'`);
    win.webContents.reload();
    await sleep(300);
    await waitLoaded();
    const cartes = await exec(`document.querySelectorAll('#accountsList .account-card').length`);
    assert(cartes === seedAccounts.length, 'cartes après perte du localStorage : ' + cartes);
    const modale = await exec(`document.getElementById('snapshotRestore') !== null`);
    assert(!modale, 'modale de restauration affichée alors que profils.json est lisible');
  });

  await test('C8.1 profils.json perdu : modale « Comptes retrouvés », restauration sans import', async () => {
    // L'instantané de l'ordonnanceur contient les comptes du seed (synchronisés
    // au démarrage). On simule la perte de profils.json et du localStorage.
    await ipc('scheduler:sync-accounts', seedAccounts);
    fs.rmSync(profilsJson, { force: true });
    fs.rmSync(profilsJson + '.bak', { force: true });
    await exec(`localStorage.removeItem('ai_accounts'); localStorage.removeItem('ai_accounts_backup'); localStorage.removeItem('ai_open_tabs'); 'ok'`);
    win.webContents.reload();
    await sleep(300);
    await waitLoaded();
    await sleep(300);
    const before = await exec(`({
      modal: document.getElementById('snapshotRestore') !== null,
      cards: document.querySelectorAll('#accountsList .account-card').length
    })`);
    assert(before.modal, 'modale de restauration absente');
    assert(before.cards === 0, 'des comptes sont affichés avant la restauration : ' + before.cards);
    const after = await exec(`new Promise((resolve) => {
      document.querySelector('#snapshotRestore [data-role="snapshot-restore"]').click();
      setTimeout(() => resolve({
        modal: document.getElementById('snapshotRestore') !== null,
        cards: document.querySelectorAll('#accountsList .account-card').length,
        stored: (window.iaoAPI.profilsLire().comptes || []).map((a) => a.profile),
        emails: (window.iaoAPI.profilsLire().comptes || []).map((a) => a.email),
        couleurs: (window.iaoAPI.profilsLire().comptes || []).map((a) => a.color),
        noms: (window.iaoAPI.profilsLire().comptes || []).map((a) => a.name),
        lignes: [...document.querySelectorAll('#accountsList .account-email')].map((e) => e.textContent.trim())
      }), 200);
    })`);
    assert(!after.modal, 'modale toujours ouverte après restauration');
    assert(after.cards === seedAccounts.length, 'cartes après restauration : ' + after.cards);
    assert(JSON.stringify(after.stored) === JSON.stringify(seedAccounts.map((a) => a.profile)), 'profils enregistrés : ' + after.stored.join(','));
    // Issue #311 : l'adresse revient avec le compte, à sa place sur la carte.
    assert(JSON.stringify(after.emails) === JSON.stringify(seedAccounts.map((a) => a.email)), 'e-mails restaurés : ' + after.emails.join(','));
    // Issue #311 (suite) : restauration = import de la copie complète, donc
    // nom et couleur reviennent tels qu'à l'export (l'ancien instantané les perdait).
    assert(JSON.stringify(after.noms) === JSON.stringify(seedAccounts.map((a) => a.name)), 'noms restaurés : ' + after.noms.join(','));
    assert(JSON.stringify(after.couleurs) === JSON.stringify(seedAccounts.map((a) => a.color)), 'couleurs restaurées : ' + after.couleurs.join(','));
    // Ordre d'affichage propre à la liste : comparaison sans ordre.
    const attendues = seedAccounts.map((a) => a.email + ' • ' + a.profile).sort();
    assert(JSON.stringify([...after.lignes].sort()) === JSON.stringify(attendues), 'lignes e-mail des cartes : ' + after.lignes.join(' | '));
  });

  await test('C8.2 comptes présents : aucune modale de restauration', async () => {
    win.webContents.reload();
    await sleep(300);
    await waitLoaded();
    await sleep(300);
    assert(await exec(`document.getElementById('snapshotRestore') === null`), 'modale affichée alors que les comptes sont présents');
  });

  await test('C8.3 onglets de la session précédente proposés au démarrage (#317, #318)', async () => {
    // Le harnais démarre avec « Restaurer les onglets » coché : la proposition
    // n'a lieu que décoché. Réglage et onglets mémorisés remis à la fin du test
    // (sinon l'onglet Claude rouvert plus tard perturbe C10 et C12).
    const reglages = await ipc('settings:load');
    const ongletsAvant = await exec(`localStorage.getItem('ai_open_tabs')`);
    try {
      const sansRestauration = await ipc('settings:save', Object.assign({}, reglages, { startWithLastSession: false }));
      assert(sansRestauration && sansRestauration.ok, 'settings:save : ' + JSON.stringify(sansRestauration));
      await exec(`localStorage.setItem('ai_open_tabs', JSON.stringify([{ accId: 'acc_test_1', svcId: 'claude' }, { accId: 'inconnu', svcId: 'claude' }])); 'ok'`);
      win.webContents.reload();
      await sleep(300);
      await waitLoaded();
      await sleep(500);
      const r = await exec(`(() => {
        const m = document.getElementById('confirmModal');
        return { open: m.classList.contains('open'), title: m.querySelector('.confirm-title').textContent,
          msg: m.querySelector('.confirm-msg').textContent };
      })()`);
      assert(r.open, 'proposition de réouverture absente');
      assert(r.title === 'Rouvrir les onglets précédents ?', 'titre : ' + r.title);
      assert(/^Onglets ouverts à la fermeture d'IAO : 1\./.test(r.msg), 'onglet d\'un compte inconnu compté : ' + r.msg);
      // Réglages rouverts : pas de seconde proposition. Refus : rien n'est ouvert.
      const apres = await exec(`(async () => {
        document.getElementById('confirmModalNo').click();
        openSettingsModal();
        await new Promise((r) => setTimeout(r, 300));
        closeSettingsModal();
        return { open: document.getElementById('confirmModal').classList.contains('open'),
          onglets: document.querySelectorAll('#tabsBar .tab').length };
      })()`);
      assert(!apres.open, 'proposition réaffichée à l\'ouverture des réglages');
      assert(apres.onglets === 0, 'refus : aucun onglet attendu, trouvé ' + apres.onglets);
    } finally {
      await ipc('settings:save', reglages);
      await exec(ongletsAvant === null ? `localStorage.removeItem('ai_open_tabs'); 'ok'`
        : `localStorage.setItem('ai_open_tabs', ${JSON.stringify(ongletsAvant)}); 'ok'`);
    }
  });

  // =========================================================================
  // C9 — Issue #201 : comptes en série, mot de passe masqué, webmail
  // =========================================================================
  await test('C9.1 Réglages messagerie enregistrés, création de 2 comptes en série numérotés', async () => {
    const r = await exec(`(async () => {
      openSettingsModal();
      await new Promise(r => setTimeout(r, 200));
      document.getElementById('settingsMailPrefix').value = 'docker';
      document.getElementById('settingsMailDomain').value = 'DMathilde.fr';
      document.getElementById('settingsWebmailUrl').value = 'https://mail.dmathilde.fr';
      await saveSettings();
      openSerieModal();
      const desc = document.getElementById('serieDesc').textContent;
      const avant = window.iaoAPI.profilsLire().comptes.length;
      document.getElementById('serieNombre').value = '2';
      await createSerie();
      const comptes = window.iaoAPI.profilsLire().comptes;
      return { desc, avant, apres: comptes.length, derniers: comptes.slice(-2).map(c => c.name + ' ' + c.email + ' ' + c.profile),
        ouvert: document.getElementById('serieModal').classList.contains('open'),
        webmail: document.querySelectorAll('#accountsList [data-action="open-webmail"]').length };
    })()`);
    assert(/docker\d+@dmathilde\.fr/.test(r.desc), 'description : ' + r.desc);
    assert(r.apres === r.avant + 2, 'attendu 2 comptes de plus : ' + r.avant + ' -> ' + r.apres);
    const n = Number(r.derniers[0].split(' ')[0]);
    assert(r.derniers[0] === n + ' docker' + n + '@dmathilde.fr profil_' + n, 'compte 1 : ' + r.derniers[0]);
    assert(r.derniers[1] === (n + 1) + ' docker' + (n + 1) + '@dmathilde.fr profil_' + (n + 1), 'compte 2 : ' + r.derniers[1]);
    assert(!r.ouvert, 'la fenêtre de création doit se fermer');
    assert(r.webmail === r.apres, 'un bouton webmail par carte attendu : ' + r.webmail);
  });

  await test('C9.2 Mot de passe de messagerie : généré, masqué par défaut, bouton œil', async () => {
    const r = await exec(`(() => {
      const acc = window.iaoAPI.profilsLire().comptes.slice(-1)[0];
      openModal(acc.id);
      const pass = document.getElementById('inputMailPassword');
      const masque = pass.type;
      generateMailPassword();
      const apres = { type: pass.type, longueur: pass.value.length };
      toggleMailPassword();
      const r = { masque, apres, final: pass.type, titre: document.getElementById('btnToggleMailPassword').title };
      closeModal();
      return r;
    })()`);
    assert(r.masque === 'password', 'masqué par défaut attendu, trouvé ' + r.masque);
    assert(r.apres.type === 'text' && r.apres.longueur === 20, 'mot de passe généré visible de 20 caractères : ' + JSON.stringify(r.apres));
    assert(r.final === 'password' && r.titre === 'Afficher le mot de passe', 'bouton œil : ' + JSON.stringify(r));
  });

  await test('C9.3 Code et lien de connexion reçus par mail : bannière de l\'onglet, lien ouvert après 3 s, annulation (#310)', async () => {
    // Un onglet du compte acc_test_1 (ouvert plus haut ou ici).
    const cible = await exec(`new Promise((resolve) => {
      const trouver = () => document.querySelector('#tabsBar .tab[data-acc="acc_test_1"]');
      if (!trouver()) openService('acc_test_1', 'claude');
      setTimeout(() => {
        const t = trouver();
        t.click();
        const wv = document.getElementById(t.dataset.tab).querySelector('webview');
        window.__liens310 = [];
        wv.loadURL = (u) => { window.__liens310.push(u); return Promise.resolve(); };
        const acc = window.iaoAPI.profilsLire().comptes.find(a => a.id === 'acc_test_1');
        resolve({ tab: t.dataset.tab, svc: t.dataset.svc, profil: acc.profile });
      }, 200);
    })`);
    const ev = JSON.stringify({ profil: cible.profil, service: cible.svc, code: '482913', lien: 'https://exemple.invalid/auth/callback?token=482913' });
    const r1 = await exec(`(() => {
      afficherConnexionWebmail(${ev});
      const b = document.querySelector('#${cible.tab} .tab-toolbar .tab-code');
      return b ? { code: b.querySelector('.tab-code__valeur').textContent, etat: b.querySelector('.tab-code__etat').textContent,
        boutons: [...b.querySelectorAll('[data-code-action]')].filter(x => !x.hidden).map(x => x.dataset.codeAction),
        premier: b.parentNode.firstElementChild === b, largeur: b.getBoundingClientRect().width } : null;
    })()`);
    assert(r1 && r1.code === '482913' && r1.premier && r1.largeur > 100, 'bannière : ' + JSON.stringify(r1));
    assert(/3/.test(r1.etat), 'compte à rebours : ' + r1.etat);
    assert(JSON.stringify(r1.boutons) === JSON.stringify(['copier', 'annuler', 'fermer']), 'boutons : ' + r1.boutons);
    if (process.env.IAO_CAPTURES_DIR) {
      await sleep(300);
      const dossier = require('./rtl-visuel').dossierCaptures(process.env.IAO_CAPTURES_DIR);
      fs.writeFileSync(path.join(dossier, 'code-mail-onglet.png'), (await win.webContents.capturePage()).toPNG());
    }
    await sleep(3400);
    const r2 = await exec(`({ liens: window.__liens310, etat: document.querySelector('#${cible.tab} .tab-code__etat').textContent })`);
    assert(r2.liens.length === 1 && r2.liens[0].endsWith('token=482913'), 'lien non ouvert : ' + JSON.stringify(r2));
    // Second mail : « Annuler » arrête l'ouverture, « Ouvrir le lien » la fait à la main.
    const r3 = await exec(`(() => {
      afficherConnexionWebmail(${ev.replace('482913', '135790')});
      document.querySelector('#${cible.tab} [data-code-action="annuler"]').click();
      return document.querySelectorAll('#${cible.tab} .tab-code').length;
    })()`);
    assert(r3 === 1, 'une seule bannière attendue : ' + r3);
    await sleep(3400);
    const r4 = await exec(`(() => {
      const n = window.__liens310.length;
      document.querySelector('#${cible.tab} [data-code-action="ouvrir"]').click();
      const apres = window.__liens310.length;
      document.querySelector('#${cible.tab} [data-code-action="fermer"]').click();
      return { n, apres, reste: document.querySelectorAll('#${cible.tab} .tab-code').length };
    })()`);
    assert(r4.n === 1 && r4.apres === 2 && r4.reste === 0, 'annulation / ouverture / fermeture : ' + JSON.stringify(r4));
    // Compte ou service inconnu, lien non https : rien.
    const r5 = await exec(`(() => {
      afficherConnexionWebmail({ profil: 'inconnu', service: 'claude', code: '111111' });
      afficherConnexionWebmail(null);
      afficherConnexionWebmail(${ev.replace('https://', 'http://').replace('482913', '999999')});
      const b = document.querySelector('#${cible.tab} .tab-code');
      return { bandeau: !!b, lien: !!(b && b.querySelector('[data-code-action="annuler"]')) };
    })()`);
    assert(r5.bandeau && !r5.lien, 'lien non https accepté : ' + JSON.stringify(r5));
    // La doublure de loadURL est retirée : l'onglet resservira (C13).
    await exec(`(() => { document.querySelector('#${cible.tab} [data-code-action="fermer"]').click(); delete document.getElementById('${cible.tab}').querySelector('webview').loadURL; return 'ok'; })()`);
  });

  // =========================================================================
  // C10 — Tâches programmables (issue #199, lot 4)
  // =========================================================================
  console.log('\n--- C10 : Tâches programmables (lot 4, issue #199) ---');

  // Dates futures calculées à l'exécution : une date fixe deviendrait passée
  // et la minuterie pourrait lancer les tâches PENDANT les scénarios (garde
  // occupée, exécutions concurrentes). +2 jours garantit « pas encore due ».
  const dansDeuxJoursLocal = () => {
    const d = new Date(Date.now() + 2 * 86400000);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  const dansDeuxJoursISO = () => new Date(Date.now() + 2 * 86400000).toISOString();


  await test('C10.1 modale ordonnanceur : interface des tâches visible, liste vide', async () => {
    await exec('window.openSchedulerModal()');
    await sleep(800);
    const visible = await exec('!document.getElementById("schedTaches").hidden');
    assert(visible, '#schedTaches devrait être visible (flux nouveau par défaut)');
    const offCache = await exec('document.getElementById("schedLegacyOff").hidden');
    assert(offCache === true, 'le bandeau « en cours de développement » doit être masqué');
    const vide = await exec('document.getElementById("tachesList").textContent');
    assert(/Nouvelle tâche/.test(vide) || /Aucune tâche programmée/.test(vide), 'état vide attendu : ' + vide);
  });

  await test('C10.2 création via formulaire : carte présente, nom HTML échappé', async () => {
    await exec('document.getElementById("tacheNewBtn").click()');
    await sleep(100);
    const formVisible = await exec('!document.getElementById("tacheForm").hidden');
    assert(formVisible, 'le formulaire devrait être ouvert');
    await exec(`
      document.getElementById('tacheFormNom').value = '<b>Nom & test</b><script>alert(1)<\/script>';
      const sel = document.getElementById('tacheFormComptesMode');
      sel.value = 'liste'; sel.dispatchEvent(new Event('change'));
      document.querySelector('#tacheFormComptesChoix input[data-profile="profil_1"]').checked = true;
      document.getElementById('tacheFormPrompt').value = 'Dis bonjour';
      document.getElementById('tacheFormProgDepuis').value = '${dansDeuxJoursLocal()}';
      document.getElementById('tacheFormProgTous').value = '2';
      document.getElementById('tacheFormProgUnite').value = 'heure';
      document.getElementById('tacheFormActive').checked = true;
      'rempli'
    `);
    await exec('document.getElementById("tacheFormEnregistrer").click()');
    await sleep(800);
    const nbCartes = await exec('document.querySelectorAll("#tachesList .tache-card").length');
    assert(nbCartes === 1, 'une carte de tâche attendue, trouvé ' + nbCartes);
    // Échappement : le nom s'affiche comme TEXTE (pas d'élément <script> ni
    // <b> injecté dans la carte) — textContent contient le nom brut, c'est
    // le rendu HTML qui doit l'échapper.
    const pasDeScript = await exec('document.querySelectorAll("#tachesList .tache-card script, #tachesList .tache-card b").length');
    assert(pasDeScript === 0, 'aucun élément HTML ne doit être injecté à partir du nom');
    const titre = await exec('document.querySelector("#tachesList .tache-card .sched-job__title").textContent');
    assert(titre.indexOf('Nom & test') !== -1, 'le nom doit être affiché : ' + titre);
    const dotDanger = await exec('(function(){var d=document.querySelector("#tachesList .tache-card .sched-job__dot");return d?d.getAttribute("data-dot-color"):null;})()');
    assert(dotDanger === 'var(--accent)', 'la tâche active doit avoir le point accent : ' + dotDanger);
  });

  await test('C10.3 le rafraîchissement (polling 4 s) ne détruit pas la saisie en cours', async () => {
    await exec('document.querySelector("#tachesList [data-action=tache-edit]").click()');
    await sleep(100);
    await exec(`document.getElementById('tacheFormNom').value = 'Saisie en cours non perdue'`);
    await sleep(4500); // au moins un passage du polling de la modale
    const valeur = await exec('document.getElementById("tacheFormNom").value');
    assert(valeur === 'Saisie en cours non perdue',
      'la saisie doit survivre au rafraîchissement, trouvé : ' + valeur);
    const encoreOuvert = await exec('!document.getElementById("tacheForm").hidden');
    assert(encoreOuvert, 'le formulaire doit rester ouvert');
    await exec('document.getElementById("tacheFormEnregistrer").click()');
    await sleep(800);
  });

  await test('C10.4 édition : le nom modifié apparaît', async () => {
    await exec('document.querySelector("#tachesList [data-action=tache-edit]").click()');
    await sleep(100);
    await exec(`document.getElementById('tacheFormNom').value = 'Tâche renommée'`);
    await exec('document.getElementById("tacheFormEnregistrer").click()');
    await sleep(800);
    const titre = await exec('document.querySelector("#tachesList .tache-card .sched-job__title").textContent');
    assert(titre.indexOf('Tâche renommée') !== -1, 'nom renommé attendu : ' + titre);
  });

  await test('C10.5 bascule d\'activation : désactiver puis réactiver', async () => {
    // La tâche est active depuis sa création (C10.2) : un clic la désactive.
    await exec('document.querySelector("#tachesList [data-action=tache-toggle]").click()');
    await sleep(800);
    let bouton = await exec('document.querySelector("#tachesList [data-action=tache-toggle]").textContent');
    assert(/Activer/.test(bouton), 'le bouton doit proposer « Activer » une fois inactive : ' + bouton);
    // Un second clic la réactive.
    await exec('document.querySelector("#tachesList [data-action=tache-toggle]").click()');
    await sleep(800);
    bouton = await exec('document.querySelector("#tachesList [data-action=tache-toggle]").textContent');
    assert(/Désactiver/.test(bouton), 'le bouton doit proposer « Désactiver » une fois active : ' + bouton);
    const meta = await exec('document.querySelector("#tachesList .tache-card .sched-job__meta").textContent');
    assert(/toutes les 2 heures/.test(meta), 'la périodicité doit être décrite : ' + meta);
    // Pluriel gettext (issue #51) : « 1 compte sélectionné », plus « compte(s) ».
    assert(/1 compte sélectionné/.test(meta), 'le compte sélectionné doit être décrit : ' + meta);
  });

  await test('C10.6 « Exécuter maintenant » : envoi réel simulé, résultat dans l\'historique', async () => {
    // Le réseau est coupé dans le harnais : le canal d'envoi
    // (scheduler:run-claude-job) est remplacé côté processus principal par
    // une réponse réussie. Tout le reste est RÉEL : la garde du moteur avant
    // l'appel au service, le plan du service, l'ouverture de l'onglet,
    // l'envoi, le compte rendu (taches:report) et l'historique.
    const { ipcMain } = require('electron');
    // (removeHandler au singulier : version d'Electron du dépôt.)
    ipcMain.removeHandler('scheduler:run-claude-job');
    const envoisSimules = [];
    ipcMain.handle('scheduler:run-claude-job', async (evenement, profil, prompt) => {
      envoisSimules.push({ profil, prompt });
      return { ok: true, sent: true };
    });
    // Tâche sur un compte éligible (profil_1 a le service Claude) —
    // échéance future calculée (jamais due pendant le scénario).
    const cree = await ipc('taches:save', {
      nom: 'Avec compte', fournisseur: 'claude',
      comptes: { mode: 'liste', profils: ['profil_1'] },
      repartition: { mode: 'rotation', espacementMs: 0 },
      nouvelleSession: true, prompt: 'prompt manuel C10.6',
      programmation: { type: 'periodique', tous: 1, unite: 'jour', depuis: dansDeuxJoursISO() },
      active: true
    });
    assert(cree && cree.ok, 'création IPC échouée : ' + JSON.stringify(cree));
    const idAvecCompte = cree.tache.id;
    await sleep(4500); // laisser le polling rafraîchir la liste
    const cliquable = await exec(`
      (function(){
        const cartes = [...document.querySelectorAll('#tachesList .tache-card')];
        const cible = cartes.find(c => c.textContent.indexOf('Avec compte') !== -1);
        if (!cible) return 'absente';
        cible.querySelector('[data-action=tache-run]').click();
        return 'cliqué';
      })()
    `);
    assert(cliquable === 'cliqué', 'bouton Exécuter maintenant introuvable : ' + cliquable);
    await sleep(1500);
    // Un seul envoi, sur le bon compte, avec le bon prompt.
    assert(envoisSimules.length === 1,
      'un seul envoi attendu, reçu : ' + JSON.stringify(envoisSimules));
    assert(envoisSimules[0] && envoisSimules[0].profil === 'profil_1', 'profil reçu inattendu');
    assert(envoisSimules[0] && envoisSimules[0].prompt === 'prompt manuel C10.6', 'prompt reçu inattendu');
    // L'événement « envoyée » doit être rattaché à CETTE tâche (id), pas
    // seulement exister quelque part dans l'historique.
    const evenements = await ipc('taches:history', 50);
    const envoye = evenements.filter(e => e && e.resultat === 'envoye'
      && e.tache === idAvecCompte && e.profil === 'profil_1');
    assert(envoye.length === 1,
      'un événement envoye attendu pour la tâche ' + idAvecCompte + ' / profil_1 : ' +
      JSON.stringify(evenements.slice(0, 6)));
    const lancee = evenements.filter(e => e && e.resultat === 'lancee' && e.tache === idAvecCompte);
    assert(lancee.length === 1, 'un événement lancee attendu pour la tâche ' + idAvecCompte);
  });

  await test('C10.7 suppression : confirmation puis disparition', async () => {
    const cliquable = await exec(`
      (function(){
        const cartes = [...document.querySelectorAll('#tachesList .tache-card')];
        const cible = cartes.find(c => c.textContent.indexOf('Avec compte') !== -1);
        if (!cible) return 'absente';
        cible.querySelector('[data-action=tache-delete]').click();
        return 'cliqué';
      })()
    `);
    assert(cliquable === 'cliqué', 'bouton Supprimer introuvable');
    await sleep(200);
    const confirmOuvert = await exec('document.getElementById("confirmModal").classList.contains("open")');
    assert(confirmOuvert, 'la modale de confirmation devrait être ouverte');
    await exec('document.getElementById("confirmModalYes").click()');
    await sleep(800);
    const restant = await exec('document.querySelectorAll("#tachesList .tache-card").length');
    assert(restant === 1, 'une seule carte doit rester, trouvé ' + restant);
    const titre = await exec('document.querySelector("#tachesList .tache-card .sched-job__title").textContent');
    assert(titre.indexOf('Tâche renommée') !== -1, 'la bonne tâche a été supprimée : ' + titre);
  });

  await test('C10.8 erreurs affichées dans le formulaire (prévalidation et service)', async () => {
    // Prévalidation locale : date vide.
    await exec('document.getElementById("tacheNewBtn").click()');
    await sleep(100);
    await exec(`
      document.getElementById('tacheFormNom').value = 'Invalide';
      document.getElementById('tacheFormComptesMode').value = 'liste';
      document.getElementById('tacheFormPrompt').value = 'p';
      document.getElementById('tacheFormProgDepuis').value = ''; // date vide -> erreur locale
      document.getElementById('tacheFormProgTous').value = '2';
      document.getElementById('tacheFormProgUnite').value = 'heure';
      'rempli'
    `);
    await exec('document.getElementById("tacheFormEnregistrer").click()');
    await sleep(400);
    let visible = await exec('!document.getElementById("tacheFormErreurs").hidden');
    assert(visible, 'la zone d\'erreurs devrait être affichée');
    let contenu = await exec('document.getElementById("tacheFormErreurs").textContent');
    assert(/date/i.test(contenu), 'l\'erreur de date devrait être mentionnée : ' + contenu);
    let formOuvert = await exec('!document.getElementById("tacheForm").hidden');
    assert(formOuvert, 'le formulaire doit rester ouvert après erreur');
    // Erreur du SERVICE : récurrence d'une minute — le formulaire l'accepte,
    // le service refuse (intervalle minimal 5 minutes, scheduler/taches.js).
    await exec(`
      document.getElementById('tacheFormNom').value = 'Trop fréquente';
      document.getElementById('tacheFormComptesMode').value = 'tous';
      document.getElementById('tacheFormComptesMode').dispatchEvent(new Event('change'));
      document.getElementById('tacheFormPrompt').value = 'p';
      document.getElementById('tacheFormProgDepuis').value = '${dansDeuxJoursLocal()}';
      document.getElementById('tacheFormProgTous').value = '1';
      document.getElementById('tacheFormProgUnite').value = 'minute';
      'rempli'
    `);
    await exec('document.getElementById("tacheFormEnregistrer").click()');
    await sleep(600);
    contenu = await exec('document.getElementById("tacheFormErreurs").textContent');
    assert(/intervalle|5 minutes|minute/i.test(contenu),
      'le refus du service (intervalle minimal) devrait être affiché : ' + contenu);
    formOuvert = await exec('!document.getElementById("tacheForm").hidden');
    assert(formOuvert, 'le formulaire doit rester ouvert après erreur du service');
    await exec('document.getElementById("tacheFormAnnuler").click()');
  });

  await test('C10.9 édition : compte sélectionné devenu indisponible préservé', async () => {
    // Scénario : la tâche référence profil_1 ET profil_fantome (compte
    // supprimé). L'édition du seul nom ne doit PAS retirer silencieusement
    // le profil indisponible de la liste des comptes.
    const cree = await ipc('taches:save', {
      nom: 'Deux comptes', fournisseur: 'claude',
      comptes: { mode: 'liste', profils: ['profil_1', 'profil_fantome'] },
      repartition: { mode: 'rotation', espacementMs: 0 },
      nouvelleSession: true, prompt: 'p',
      programmation: { type: 'periodique', tous: 1, unite: 'jour', depuis: dansDeuxJoursISO() },
      active: true
    });
    assert(cree && cree.ok, 'création IPC échouée : ' + JSON.stringify(cree));
    const idDeux = cree.tache.id;
    await sleep(4500); // laisser le polling rafraîchir la liste
    // Ouvrir le formulaire d'édition de cette tâche.
    const cliquable = await exec(`
      (function(){
        const cartes = [...document.querySelectorAll('#tachesList .tache-card')];
        const cible = cartes.find(c => c.textContent.indexOf('Deux comptes') !== -1);
        if (!cible) return 'absente';
        cible.querySelector('[data-action=tache-edit]').click();
        return 'cliqué';
      })()
    `);
    assert(cliquable === 'cliqué', 'bouton Modifier introuvable : ' + cliquable);
    await sleep(200);
    // Le profil indisponible apparaît : coché, désactivé, signalé.
    const etat = await exec(`
      (function(){
        const cb = document.querySelector('#tacheFormComptesChoix input[data-profile="profil_fantome"]');
        if (!cb) return 'absent';
        return JSON.stringify({ coche: cb.checked, desactive: cb.disabled,
          libelle: cb.closest('label').textContent.trim().slice(0, 60) });
      })()
    `);
    assert(etat !== 'absent', 'le profil_fantome devrait être affiché (coché, désactivé)');
    assert(/coche":true/.test(etat) && /desactive":true/.test(etat), 'état inattendu : ' + etat);
    assert(/compte supprimé/.test(etat), 'signal attendu : ' + etat);
    // Modifier seulement le nom et enregistrer.
    await exec("document.getElementById('tacheFormNom').value = 'Deux comptes renommée'");
    await exec('document.getElementById("tacheFormEnregistrer").click()');
    await sleep(800);
    // La tâche garde TOUJOURS les deux profils.
    const apres = await ipc('taches:list');
    const t = (apres || []).find(x => x.id === idDeux);
    assert(t, 'tâche ' + idDeux + ' introuvable après édition');
    const profils = (t.comptes.profils || []).slice().sort();
    assert(profils.length === 2 && profils[0] === 'profil_1' && profils[1] === 'profil_fantome',
      'les deux profils doivent être préservés : ' + JSON.stringify(t.comptes));
    assert(t.nom === 'Deux comptes renommée', 'nom attendu : ' + t.nom);
  });

  await exec('window.closeSchedulerModal()');

  // =========================================================================
  // C11 — Statistiques d'utilisation (issue #206, lot 1)
  // =========================================================================
  console.log('\n--- C11 : Statistiques d\'utilisation ---');
  const statsDir = path.join(app.getPath('userData'), 'stats');

  await test('C11.1 Fermer un onglet enregistre sa session (sessions.jsonl) et l\'instantané des autres', async () => {
    // Un onglet qui reste ouvert (profil_1) et un qu'on ferme (profil_2).
    await exec(`document.querySelector('#accountsList [data-action="open-service"][data-acc="acc_test_1"][data-svc="claude"]').click(); 'ok'`);
    await sleep(300);
    await exec(`document.querySelector('#accountsList [data-action="open-service"][data-acc="acc_test_2"][data-svc="claude"]').click(); 'ok'`);
    await sleep(1500); // laisser la <webview> s'attacher avant de fermer l'onglet
    await exec(`(() => {
      const t = [...document.querySelectorAll('#tabsBar .tab')].find(x => x.dataset.acc === 'acc_test_2' && x.dataset.svc === 'claude');
      closeTab(t.dataset.tab);
      const oui = document.getElementById('confirmModalYes');
      if (oui && oui.offsetParent !== null) oui.click();
      return 'ok';
    })()`);
    let lignes = [];
    for (let i = 0; i < 30 && !lignes.length; i++) {
      await sleep(100);
      try { lignes = fs.readFileSync(path.join(statsDir, 'sessions.jsonl'), 'utf-8').split('\n').filter(Boolean); } catch (e) { /* pas encore écrit */ }
    }
    const s = JSON.parse(lignes[lignes.length - 1]);
    assert(s.profil === 'profil_2' && s.service === 'claude', 'session inattendue : ' + lignes[0]);
    assert(s.fin >= s.debut && s.actifMs <= s.fin - s.debut, 'durées incohérentes : ' + lignes[0]);
    const enCours = JSON.parse(fs.readFileSync(path.join(statsDir, 'en-cours.json'), 'utf-8'));
    assert(enCours.some(x => x.profil === 'profil_1' && x.service === 'claude'),
      'instantané des onglets ouverts attendu : ' + JSON.stringify(enCours));
  });

  await test('C11.2 La page Statistiques affiche totaux et tableaux, noms échappés, périodes', async () => {
    const r = await exec(`(async () => {
      document.querySelector('[data-action="ui-openStatsModal"]').click();
      await new Promise(res => setTimeout(res, 500));
      const modal = document.getElementById('statsModal');
      const body = document.getElementById('statsBody');
      document.querySelector('#statsPeriodes [data-periode="tout"]').click();
      const r = {
        ouvert: modal.classList.contains('open'),
        cartes: body.querySelectorAll('.stats-carte').length,
        tables: body.querySelectorAll('.stats-table').length,
        script: body.querySelectorAll('script').length,
        texte: body.textContent,
        active: document.querySelector('#statsPeriodes .stats-periode--active').dataset.periode,
        icone: !!document.querySelector('[data-action="ui-openStatsModal"] svg'),
        deborde: body.scrollWidth > body.clientWidth + 1
      };
      document.querySelector('#statsModal [data-action="ui-closeStatsModal"]').click();
      r.ferme = !modal.classList.contains('open');
      return r;
    })()`);
    assert(r.ouvert && r.ferme, 'ouverture/fermeture : ' + JSON.stringify(r));
    // 6 cartes (série, lot 2 ; réponses et médiane, lot 4) ; tableaux compte + service (+ tâches, C11.3).
    assert(r.cartes === 6 && r.tables >= 2, 'attendu 6 cartes et au moins 2 tableaux : ' + JSON.stringify(r));
    assert(r.script === 0 && r.texte.includes('<script>alert(1)</script>'), 'nom de compte non échappé');
    assert(r.texte.includes('Compte Test Un') && r.texte.includes('Claude'), 'comptes/services absents : ' + r.texte);
    assert(r.active === 'tout', 'période active : ' + r.active);
    assert(r.icone, 'icône chart-simple non hydratée');
    assert(!r.deborde, 'débordement horizontal du contenu');
  });

  await test('C11.3 Statistiques lot 2 : heures de pointe, tâches par compte, tri par colonne, inutilisés (#206)', async () => {
    const r = await exec(`(async () => {
      document.querySelector('[data-action="ui-openStatsModal"]').click();
      await new Promise(res => setTimeout(res, 500));
      document.querySelector('#statsPeriodes [data-periode="tout"]').click();
      const body = document.getElementById('statsBody');
      const chaleur = document.getElementById('statsChaleur');
      const taches = document.getElementById('statsTaches');
      const r = {
        lignesChaleur: chaleur ? chaleur.querySelectorAll('tbody tr').length : 0,
        casesChaleur: chaleur ? chaleur.querySelectorAll('.stats-chaleur__case').length : 0,
        casesAllumees: chaleur ? [...chaleur.querySelectorAll('.stats-chaleur__case')].filter(c => parseFloat(c.style.getPropertyValue('--niveau')) > 0).length : 0,
        tachesTexte: taches ? taches.textContent : '',
        serie: body.textContent.includes('Série en cours'),
        inutilises: [...document.querySelectorAll('#statsInutilises li')].map(li => li.textContent)
      };
      // Tri : premier clic = décroissant, second = croissant, aria-sort à jour.
      const th = () => body.querySelector('[data-stats-tri="compte"][data-col="cle"]');
      th().click();
      r.tri1 = th().getAttribute('aria-sort');
      th().click();
      r.tri2 = th().getAttribute('aria-sort');
      const noms = () => [...body.querySelectorAll('.stats-table')][0].querySelectorAll('tbody tr').length;
      r.lignesCompte = noms();
      r.deborde = body.scrollWidth > body.clientWidth + 1;
      document.querySelector('#statsModal [data-action="ui-closeStatsModal"]').click();
      return r;
    })()`);
    assert(r.lignesChaleur === 7 && r.casesChaleur === 7 * 24, 'carte de chaleur 7 × 24 attendue : ' + JSON.stringify(r));
    assert(r.casesAllumees >= 1, 'au moins une case de temps actif attendue : ' + JSON.stringify(r));
    // C10.6 a produit un envoi pour profil_1 : la ligne du compte apparaît.
    assert(r.tachesTexte.includes('Compte Test Un'), 'tâches par compte absentes : ' + JSON.stringify(r));
    assert(r.serie, 'carte de série absente');
    assert(r.tri1 === 'descending' && r.tri2 === 'ascending', 'tri par colonne : ' + JSON.stringify(r));
    assert(r.lignesCompte >= 2, 'lignes de compte perdues au tri');
    assert(r.inutilises.every(t => !t.includes('Compte Test Un')), 'compte utilisé listé comme inutilisé : ' + JSON.stringify(r.inutilises));
    assert(!r.deborde, 'débordement horizontal du contenu');
  });

  await test('C11.4 Statistiques lot 3 : évolution SVG, export CSV/JSON, remise à zéro confirmée (#206)', async () => {
    const { dialog } = require('electron');
    const origine = dialog.showSaveDialog;
    const csv = path.join(statsDir, '..', 'export-c11.csv');
    const json = path.join(statsDir, '..', 'export-c11.json');
    let cible = csv;
    const demandes = [];
    dialog.showSaveDialog = async (_w, opts) => { demandes.push(opts); return { canceled: false, filePath: cible }; };
    try {
      const r = await exec(`(async () => {
        document.querySelector('[data-action="ui-openStatsModal"]').click();
        await new Promise(res => setTimeout(res, 500));
        document.querySelector('#statsPeriodes [data-periode="tout"]').click();
        const evo = document.getElementById('statsEvolution');
        return {
          barres: evo ? evo.querySelectorAll('rect').length : 0,
          hautes: evo ? [...evo.querySelectorAll('rect')].filter(x => parseFloat(x.getAttribute('height')) > 0).length : 0,
          titre: evo ? evo.querySelector('rect title').textContent : ''
        };
      })()`);
      assert(r.barres === 90 && r.hautes >= 1, 'histogramme 90 jours attendu : ' + JSON.stringify(r));
      await exec(`document.getElementById('statsExportCsv').click(); 'ok'`);
      for (let i = 0; i < 30 && !fs.existsSync(csv); i++) await sleep(100);
      const contenu = fs.readFileSync(csv, 'utf-8');
      assert(contenu.startsWith('\ufeffid;compte;profil;service;debut;fin;duree_s;actif_s'), 'en-tête CSV : ' + contenu.slice(0, 80));
      assert(contenu.includes(';Compte Test Un;profil_1;claude;'), 'session de profil_1 (onglet ouvert) absente du CSV');
      assert(/\.csv$/.test(demandes[0].defaultPath), 'nom proposé : ' + demandes[0].defaultPath);
      cible = json;
      await exec(`document.getElementById('statsExportJson').click(); 'ok'`);
      for (let i = 0; i < 30 && !fs.existsSync(json); i++) await sleep(100);
      const j = JSON.parse(fs.readFileSync(json, 'utf-8'));
      assert(j.format === 'iao-stats-1' && j.sessions.length >= 2, 'export JSON : ' + JSON.stringify(j).slice(0, 200));
      // Remise à zéro : la confirmation passe AU-DESSUS de la page Statistiques.
      const conf = await exec(`(async () => {
        document.getElementById('statsReset').click();
        await new Promise(res => setTimeout(res, 200));
        const oui = document.getElementById('confirmModalYes');
        const b = oui.getBoundingClientRect();
        const dessus = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === oui;
        oui.click();
        await new Promise(res => setTimeout(res, 600));
        const table = document.querySelector('#statsBody .stats-table');
        const lignes = table ? [...table.querySelectorAll('tbody tr')].map(tr => tr.textContent) : [];
        const inutilises = [...document.querySelectorAll('#statsInutilises li')].map(li => li.textContent);
        document.querySelector('#statsModal [data-action="ui-closeStatsModal"]').click();
        return { dessus, lignes, inutilises };
      })()`);
      assert(conf.dessus, 'confirmation masquée par la page Statistiques');
      assert(fs.readFileSync(path.join(statsDir, 'sessions.jsonl'), 'utf-8') === '', 'historique non vidé');
      // Seul l'onglet resté ouvert (profil_1) repart ; le compte fermé passe en « inutilisés ».
      assert(conf.lignes.length === 1 && conf.lignes[0].includes('Compte Test Un'),
        'par compte après remise à zéro : ' + JSON.stringify(conf.lignes));
      assert(conf.inutilises.some(t => t.includes('<script>alert(1)</script>')),
        'compte fermé attendu dans les inutilisés : ' + JSON.stringify(conf.inutilises));
    } finally {
      dialog.showSaveDialog = origine;
    }
  });

  await test('C11.5 Statistiques lot 2b : temps de réponse et quotas atteints par compte (#206)', async () => {
    const t0 = Date.now() - 3600 * 1000;
    const rep = [
      { profil: 'profil_1', service: 'claude', debut: t0, fin: t0 + 4000 },
      { profil: 'profil_1', service: 'claude', debut: t0 + 10000, fin: t0 + 16000 },
      { profil: 'profil_1', service: 'claude', debut: t0 + 20000, fin: t0 + 110000 },
      { profil: 'profil_<b>x</b>', service: 'chatgpt', debut: t0, fin: t0 + 2000 }
    ];
    fs.writeFileSync(path.join(statsDir, 'reponses.jsonl'), rep.map((r, i) => JSON.stringify(Object.assign({ id: 'c115-r' + i }, r))).join('\n') + '\n');
    const hq = new Date(Date.now() - 24 * 3600 * 1000); hq.setHours(14, 10, 0, 0);
    fs.writeFileSync(path.join(statsDir, 'quotas.jsonl'),
      [hq.getTime(), hq.getTime() + 60000].map((d, i) => JSON.stringify({ id: 'c115-q' + i, profil: 'profil_2', service: 'claude', date: d })).join('\n') + '\n');
    const r = await exec(`(async () => {
      const ouvert = document.getElementById('statsModal').classList.contains('open');
      if (!ouvert) document.querySelector('[data-action="ui-openStatsModal"]').click();
      else await openStatsModal();
      await new Promise(res => setTimeout(res, 500));
      document.querySelector('#statsPeriodes [data-periode="tout"]').click();
      const lignes = (id) => [...document.querySelectorAll('#' + id + ' tbody tr')].map(tr => [...tr.cells].map(c => c.textContent.trim()));
      const avant = lignes('statsReponses');
      document.querySelector('#statsReponses [data-col="nombre"]').click();
      const tri = document.querySelector('#statsReponses [data-col="nombre"]').getAttribute('aria-sort');
      const res = { reponses: avant, quotas: lignes('statsQuotas'), tri, html: document.getElementById('statsReponses').innerHTML.includes('<b>') };
      document.querySelector('#statsModal [data-action="ui-closeStatsModal"]').click();
      return res;
    })()`);
    const claude = r.reponses.find(l => l[1] === 'Claude');
    assert(claude, 'ligne Claude absente : ' + JSON.stringify(r.reponses));
    assert(claude[2] === '3' && claude[3] === '6 s' && claude[4] === '4 s' && claude[5] === '1 min',
      'médiane / plus rapide / plus lente inattendues : ' + JSON.stringify(claude));
    assert(r.reponses.some(l => l[0] === 'profil_<b>x</b>'), 'profil sans compte affiché tel quel, échappé');
    assert(!r.html, 'nom de profil non échappé');
    assert(r.tri === 'descending', 'tri par nombre attendu : ' + r.tri);
    assert(r.quotas.length === 1 && r.quotas[0][2] === '2' && r.quotas[0][3] === '14 h',
      'quotas inattendus : ' + JSON.stringify(r.quotas));
  });

  await test('C11.6 Statistiques lot 4 : cartes réponses, évolution du temps de réponse, comptes surchargés (#206)', async () => {
    const t0 = Date.now() - 3600 * 1000;
    fs.writeFileSync(path.join(statsDir, 'reponses.jsonl'), [4000, 6000, 8000]
      .map((d, i) => JSON.stringify({ id: 'c116-r' + i, profil: 'profil_1', service: 'claude', debut: t0 + i * 60000, fin: t0 + i * 60000 + d })).join('\n') + '\n');
    fs.writeFileSync(path.join(statsDir, 'quotas.jsonl'), [0, 1, 2]
      .map(i => JSON.stringify({ id: 'c116-q' + i, profil: 'profil_2', service: 'claude', date: t0 + i * 60000 })).join('\n') + '\n');
    const r = await exec(`(async () => {
      if (!document.getElementById('statsModal').classList.contains('open')) document.querySelector('[data-action="ui-openStatsModal"]').click();
      else await openStatsModal();
      await new Promise(res => setTimeout(res, 500));
      document.querySelector('#statsPeriodes [data-periode="tout"]').click();
      const cartes = [...document.querySelectorAll('#statsBody .stats-carte')].map(c => [c.querySelector('.stats-carte__libelle').textContent, c.querySelector('.stats-carte__valeur').textContent]);
      const evo = document.getElementById('statsEvolutionReponses');
      const titres = evo ? [...evo.querySelectorAll('rect title')].map(x => x.textContent).filter(x => /réponses?$/.test(x) && !/ 0 réponse/.test(x)) : [];
      const sur = document.getElementById('statsSurcharges');
      const res = {
        cartes, barres: evo ? evo.querySelectorAll('rect').length : 0, titres,
        surcharges: sur ? [...sur.querySelectorAll('li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim()) : null,
        relais: sur ? (sur.nextElementSibling && sur.nextElementSibling.textContent) : null
      };
      return res;
    })()`);
    if (process.env.IAO_CAPTURES_DIR) {
      // Capture de contrôle visuel (lot 4) : haut de la page, puis bas.
      const dossier = require('./rtl-visuel').dossierCaptures(process.env.IAO_CAPTURES_DIR);
      fs.writeFileSync(path.join(dossier, 'stats-lot4-haut.png'), (await win.webContents.capturePage()).toPNG());
      await exec(`(() => { document.getElementById('statsSurcharges').scrollIntoView({ block: 'center' }); return 'ok'; })()`);
      await sleep(200);
      fs.writeFileSync(path.join(dossier, 'stats-lot4-bas.png'), (await win.webContents.capturePage()).toPNG());
    }
    await exec(`document.querySelector('#statsModal [data-action="ui-closeStatsModal"]').click(); 'ok'`);
    const carte = (l) => (r.cartes.find(c => c[0] === l) || [])[1];
    assert(carte('Réponses') === '3', 'carte Réponses : ' + JSON.stringify(r.cartes));
    assert(carte('Temps de réponse médian') === '6 s', 'carte médiane : ' + JSON.stringify(r.cartes));
    assert(r.barres === 90, 'histogramme de 90 jours attendu : ' + r.barres);
    assert(r.titres.length === 1 && /médiane 6 s, 3 réponses/.test(r.titres[0]), 'infobulle : ' + JSON.stringify(r.titres));
    assert(r.surcharges && r.surcharges.length === 1 && /3 quotas atteints/.test(r.surcharges[0]), 'surchargés : ' + JSON.stringify(r.surcharges));
    assert(r.relais && /Comptes à privilégier/.test(r.relais), 'relais : ' + r.relais);
  });

  // =========================================================================
  // C12 — Fermer un onglet chargé n'interrompt pas l'interface
  // (Electron < 43.7.4 : « Invalid guestInstanceId » à la suppression d'une
  // <webview> chargée, electron/electron#54089 ; bandeau rouge de boot-guard)
  // =========================================================================
  await test('C12.1 Fermer un onglet chargé : aucun bandeau d\'erreur', async () => {
    await exec(`document.querySelector('#accountsList [data-action="open-service"][data-acc="acc_test_2"][data-svc="gemini"]').click(); 'ok'`);
    await sleep(1500); // <webview> attachée et chargée
    await exec(`(() => {
      const t = [...document.querySelectorAll('#tabsBar .tab')].find(x => x.dataset.acc === 'acc_test_2' && x.dataset.svc === 'gemini');
      closeTab(t.dataset.tab);
      const oui = document.getElementById('confirmModalYes');
      if (oui && oui.offsetParent !== null) oui.click();
      return 'ok';
    })()`);
    await sleep(800);
    const texte = await exec(`document.body.innerText`);
    assert(!texte.includes('guestInstanceId') && !texte.includes('IAO a rencontré un problème'),
      'bandeau d\'erreur affiché après fermeture : ' + (texte.match(/Invalid[^\n]*/) || [''])[0]);
  });

  // =========================================================================
  // C13 — Temps de réponse des messages envoyés à la main (issue #206)
  // Le réseau est coupé : la webview Claude charge une page locale qui imite
  // le compositeur (textarea) et l'indicateur data-is-streaming de Claude.ai.
  // =========================================================================
  console.log('\n--- C13 : temps de réponse des envois manuels ---');
  await test('C13.1 Claude : script injecté, Entrée puis génération simulée -> reponses.jsonl', async () => {
    await exec(`document.querySelector('#accountsList [data-action="open-service"][data-acc="acc_test_1"][data-svc="claude"]').click(); 'ok'`);
    await sleep(800);
    await exec(`(() => {
      const t = [...document.querySelectorAll('#tabsBar .tab')].find(x => x.dataset.acc === 'acc_test_1' && x.dataset.svc === 'claude');
      window.__c13 = document.querySelector('#' + t.dataset.tab + ' webview');
      window.__c13.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<textarea id="q">question secrète</textarea>'));
      return 'ok';
    })()`);
    let pret = false;
    for (let i = 0; i < 40 && !pret; i++) {
      await sleep(150);
      pret = await exec(`window.__c13.executeJavaScript('window.__iaoMesureReponse === true && !!document.getElementById("q")').catch(() => false)`);
    }
    assert(pret, 'script de mesure non injecté après le chargement de la page');
    // La mesure ne compte que si elle est NOUVELLE : C11.5 a déjà semé des
    // réponses profil_1/claude dans reponses.jsonl. Chercher une ligne
    // enregistrée APRÈS cet instant (fin >= envoi13) — sinon le test
    // passerait sans que la mesure ait été livrée (le renderer vide la file
    // de la page toutes les 3 s, et la webview ralentie en arrière-plan
    // retarde encore la détection de fin) et C14.4 pourrait purger avant
    // l'arrivée de la ligne.
    const envoi13 = Date.now();
    await exec(`window.__c13.executeJavaScript(\`(function () {
      var q = document.getElementById('q'); q.focus();
      q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      setTimeout(function () {
        var d = document.createElement('div'); d.setAttribute('data-is-streaming', 'true');
        d.textContent = 'réponse secrète'; document.body.appendChild(d);
        setTimeout(function () { d.setAttribute('data-is-streaming', 'false'); }, 1500);
      }, 300);
      return 'ok';
    })()\`)`);
    const fichier = path.join(statsDir, 'reponses.jsonl');
    let ligne = null;
    for (let i = 0; i < 60 && !ligne; i++) {
      await sleep(200);
      try {
        ligne = fs.readFileSync(fichier, 'utf-8').split('\n').filter(Boolean)
          .map(l => JSON.parse(l)).find(r => r.profil === 'profil_1' && r.service === 'claude' && r.fin >= envoi13) || null;
      } catch (e) { /* pas encore écrit */ }
    }
    assert(ligne, 'aucune mesure enregistrée dans reponses.jsonl après l\'envoi');
    const duree = ligne.fin - ligne.debut;
    assert(duree >= 1500 && duree < 5000, 'durée incohérente : ' + duree + ' ms');
    const brut = fs.readFileSync(fichier, 'utf-8');
    assert(!brut.includes('secrète'), 'aucun texte de question ni de réponse ne doit sortir de la page');
  });

  // =========================================================================
  // C14 — Statistiques avec un vrai historique (issue #206)
  // =========================================================================
  // Demande de #206 : « vérifier la page Statistiques avec un vrai
  // historique ». C11 couvre les lots 1 à 4 avec quelques sessions créées
  // par le harnais ; ici on sème 60 jours d'historique réaliste (sessions,
  // temps de réponse, quotas) dans <userData>/stats/ avant d'ouvrir la
  // modale, puis on vérifie que totaux, tableaux, cartes, histogrammes et
  // export rendent exactement ces données.
  // profil_3 et profil_4 n'ont AUCUNE session créée par les tests précédents
  // (qui n'utilisent que profil_1/profil_2) : leurs valeurs attendues sont
  // donc exactes, calculées depuis le jeu de données semé.
  console.log('\n--- C14 : Statistiques avec un vrai historique (#206) ---');

  // PRNG déterministe (mulberry32) : le jeu de données est reproductible.
  function prng14(graine) {
    let a = graine >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const JOUR_MS = 24 * 60 * 60 * 1000;
  const maintenant14 = Date.now();
  const alea14 = prng14(206);
  const sessions14 = []; // { id, profil, service, debut, fin, actifMs }
  const reponses14 = []; // { id, profil, service, debut, fin }
  const quotas14 = [];  // { id, profil, service, date }
  let seq14 = 0;
  const id14 = (p) => p + '-' + (++seq14);
  const debutJour14 = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

  // 60 jours : profil_1 gros utilisateur (5 services), profil_3 régulier,
  // profil_4 rare ; profil_2 (compte existant) volontairement absent →
  // « comptes inutilisés ». Aujourd'hui et hier : sessions garanties
  // (série en cours ≥ 2), la dernière à 45 min de maintenant.
  const plans14 = [
    { profil: 'profil_1', services: ['claude', 'chatgpt', 'gemini', 'perplexity', 'grok'], min: 3, max: 7 },
    { profil: 'profil_3', services: ['claude', 'chatgpt'], min: 1, max: 3 },
    { profil: 'profil_4', services: ['suno'], min: 0, max: 1 }
  ];
  for (let jours = 59; jours >= 0; jours--) {
    const base = debutJour14(maintenant14 - jours * JOUR_MS);
    for (const plan of plans14) {
      const n = plan.min + Math.floor(alea14() * (plan.max - plan.min + 1));
      for (let k = 0; k < n; k++) {
        const service = plan.services[Math.floor(alea14() * plan.services.length)];
        const heureMax = jours === 0 ? new Date(maintenant14).getHours() : 22;
        const debut = base + Math.floor(alea14() * (heureMax + 1)) * 3600000;
        const duree = (5 + Math.floor(alea14() * 115)) * 60000; // 5 min - 2 h
        const actif = Math.round(duree * (0.3 + alea14() * 0.5));
        sessions14.push({ id: id14('s'), profil: plan.profil, service, debut, fin: debut + duree, actifMs: actif });
      }
    }
  }
  // Sessions garanties aujourd'hui et hier (série en cours), peu importe
  // l'heure d'exécution du harnais.
  sessions14.push({ id: id14('s'), profil: 'profil_1', service: 'claude',
    debut: maintenant14 - 45 * 60000, fin: maintenant14 - 10 * 60000, actifMs: 20 * 60000 });
  sessions14.push({ id: id14('s'), profil: 'profil_3', service: 'claude',
    debut: debutJour14(maintenant14 - JOUR_MS) + 10 * 3600000,
    fin: debutJour14(maintenant14 - JOUR_MS) + 11 * 3600000, actifMs: 40 * 60000 });

  // Temps de réponse : 3 à 6 par jour pour profil_1 (claude, chatgpt),
  // 8 s à 4 min — réaliste pour une génération d'IA.
  for (let jours = 59; jours >= 0; jours--) {
    const base = debutJour14(maintenant14 - jours * JOUR_MS);
    for (const service of ['claude', 'chatgpt']) {
      const n = 3 + Math.floor(alea14() * 4);
      for (let k = 0; k < n; k++) {
        const heureMax = jours === 0 ? new Date(maintenant14).getHours() : 22;
        const debut = base + Math.floor(alea14() * (heureMax + 1)) * 3600000;
        const duree = (8 + Math.floor(alea14() * 232)) * 1000;
        reponses14.push({ id: id14('r'), profil: 'profil_1', service, debut, fin: debut + duree });
      }
    }
  }

  // Quotas atteints : profil_1+claude un jour sur deux (~30 sur la période,
  // très au-dessus du seuil « surchargé » de 3), profil_3+claude tous les
  // 10 jours. Fenêtre de déduplication d'une heure : espacés de jours.
  for (let jours = 58; jours >= 0; jours -= 2) {
    quotas14.push({ id: id14('q'), profil: 'profil_1', service: 'claude',
      date: debutJour14(maintenant14 - jours * JOUR_MS) + (2 + Math.floor(alea14() * 18)) * 3600000 });
  }
  for (let jours = 50; jours >= 0; jours -= 10) {
    quotas14.push({ id: id14('q'), profil: 'profil_3', service: 'claude',
      date: maintenant14 - jours * JOUR_MS - Math.floor(alea14() * 12) * 3600000 });
  }

  // Semis dans <userData>/stats/ : AJOUT aux fichiers existants (les tests
  // précédents y ont écrit des sessions/réponses, on ne les écrase pas).
  fs.mkdirSync(statsDir, { recursive: true });
  const ajouterJsonl = (fichier, lignes) => {
    let existant = '';
    try { existant = fs.readFileSync(fichier, 'utf-8'); } catch (e) { /* absent */ }
    const contenu = (existant && !existant.endsWith('\n') ? existant + '\n' : existant)
      + lignes.map(l => JSON.stringify(l)).join('\n') + '\n';
    fs.writeFileSync(fichier, contenu, 'utf-8');
    return contenu.split('\n').filter(Boolean).length; // lignes totales après ajout
  };
  const fichierSessions14 = path.join(statsDir, 'sessions.jsonl');
  const fichierReponses14 = path.join(statsDir, 'reponses.jsonl');
  const fichierQuotas14 = path.join(statsDir, 'quotas.jsonl');
  const lignesSessions14 = ajouterJsonl(fichierSessions14, sessions14);
  const lignesReponses14 = ajouterJsonl(fichierReponses14, reponses14);
  const lignesQuotas14 = ajouterJsonl(fichierQuotas14, quotas14);

  // Valeurs attendues, calculées depuis les fichiers (vérité terrain) : les
  // tests précédents n'ont PAS de session profil_3/profil_4 → leurs comptes
  // exacts viennent du semis seul.
  const attenduSesProfil3 = sessions14.filter(s => s.profil === 'profil_3').length;
  const attenduSesProfil4 = sessions14.filter(s => s.profil === 'profil_4').length;
  const attenduSesSuno = sessions14.filter(s => s.service === 'suno').length;
  const attenduSesSemaine = sessions14.filter(s => s.fin >= maintenant14 - 7 * JOUR_MS).length;
  const ongletsOuverts = await exec('document.querySelectorAll(\'#tabsBar .tab\').length');

  await test('C14.1 La page Statistiques rend un historique de 60 jours : totaux, tableaux, cartes (#206)', async () => {
    const r = await exec(`(async () => {
      document.querySelector('[data-action="ui-openStatsModal"]').click();
      await new Promise(res => setTimeout(res, 500));
      document.querySelector('#statsPeriodes [data-periode="tout"]').click();
      await new Promise(res => setTimeout(res, 300));
      const body = document.getElementById('statsBody');
      const cartes = [...body.querySelectorAll('.stats-carte')];
      const valeur = (libelle) => {
        const c = cartes.find(x => x.querySelector('.stats-carte__libelle').textContent.includes(libelle));
        return c ? c.querySelector('.stats-carte__valeur').textContent.trim() : null;
      };
      // Tableau « Par compte » : lignes de cellules { texte, titre }.
      // Le titre de la première cellule est la clé (profil) : le NOM affiché
      // peut être celui d'un compte créé par C9.1 (« 3 », « 4 »).
      const cellule = (td) => ({
        texte: td.textContent.trim(),
        titre: td.querySelector('.stats-nom span') ? td.querySelector('.stats-nom span').getAttribute('title') : null
      });
      const tableCompte = [...body.querySelectorAll('.stats-table')][0];
      const lignesCompte = [...tableCompte.querySelectorAll('tbody tr')].map(tr =>
        [...tr.querySelectorAll('td')].map(cellule));
      const tableService = [...body.querySelectorAll('.stats-table')][1];
      const lignesService = [...tableService.querySelectorAll('tbody tr')].map(tr =>
        [...tr.querySelectorAll('td')].map(cellule));
      return {
        sessions: valeur('Sessions'),
        reponses: valeur('Réponses'),
        mediane: valeur('Temps de réponse médian'),
        serie: valeur('Série en cours'),
        cartes: cartes.length,
        lignesCompte,
        lignesService,
        chaleur: body.querySelectorAll('.stats-chaleur__case').length,
        chaleurAllumees: [...body.querySelectorAll('.stats-chaleur__case')].filter(c => parseFloat(c.style.getPropertyValue('--niveau')) > 0).length,
        barres: body.querySelectorAll('#statsEvolution rect.stats-evolution__barre').length,
        barresReponses: body.querySelectorAll('#statsEvolutionReponses rect.stats-evolution__barre').length,
        inutilises: [...document.querySelectorAll('#statsInutilises li')].map(li => ({
          texte: li.textContent, titre: li.querySelector('span') ? li.querySelector('span').getAttribute('title') : null
        })),
        surcharges: [...document.querySelectorAll('#statsSurcharges li')].map(li => ({
          texte: li.textContent, titre: li.querySelector('span') ? li.querySelector('span').getAttribute('title') : null
        })),
        deborde: body.scrollWidth > body.clientWidth + 1,
        scripts: body.querySelectorAll('script').length
      };
    })()`);
    // Totaux : historique du fichier + onglets ouverts (instantané du suivi).
    assert(r.sessions === String(lignesSessions14 + ongletsOuverts),
      'total sessions attendu ' + (lignesSessions14 + ongletsOuverts) + ' (fichier + onglets ouverts), obtenu ' + r.sessions);
    assert(r.reponses === String(lignesReponses14),
      'total réponses attendu ' + lignesReponses14 + ', obtenu ' + r.reponses);
    assert(r.mediane && r.mediane !== '—', 'temps de réponse médian vide : ' + JSON.stringify(r.mediane));
    assert(r.serie && /[0-9]/.test(r.serie) && !r.serie.startsWith('0'), 'série en cours nulle : ' + JSON.stringify(r.serie));
    assert(r.cartes === 6, '6 cartes attendues : ' + r.cartes);
    // Tableaux : profil_3 et profil_4 ne viennent que du semis → valeurs exactes.
    // La clé (titre de la cellule) est le profil ; le nom affiché peut être
    // « 3 »/« 4 » (comptes créés en série par C9.1, profils profil_3/profil_4).
    // Colonnes : nom | temps actif | durée ouverte | sessions | dernier.
    const ligneP3 = r.lignesCompte.find(l => l[0].titre === 'profil_3');
    const ligneP4 = r.lignesCompte.find(l => l[0].titre === 'profil_4');
    assert(ligneP3 && ligneP3[3].texte === String(attenduSesProfil3),
      'profil_3 : ' + attenduSesProfil3 + ' sessions attendues : ' + JSON.stringify(ligneP3));
    assert(ligneP4 && ligneP4[3].texte === String(attenduSesProfil4),
      'profil_4 : ' + attenduSesProfil4 + ' sessions attendues : ' + JSON.stringify(ligneP4));
    const ligneSuno = r.lignesService.find(l => l[0].texte === 'Suno' || l[0].titre === 'suno');
    assert(ligneSuno && ligneSuno[3].texte === String(attenduSesSuno),
      'suno : ' + attenduSesSuno + ' sessions attendues : ' + JSON.stringify(ligneSuno));
    // Cartes de chaleur et histogrammes : 60 jours de données réparties sur
    // les heures de la journée → nombreuses cases et barres allumées.
    assert(r.chaleur === 7 * 24 && r.chaleurAllumees >= 50,
      'carte de chaleur : ' + r.chaleurAllumees + ' cases allumées sur ' + r.chaleur);
    assert(r.barres >= 30, 'évolution du temps actif : ' + r.barres + ' barres');
    assert(r.barresReponses >= 30, 'évolution du temps de réponse : ' + r.barresReponses + ' barres');
    // Comptes inutilisés : aucun — les 4 comptes du harnais ont tous des
    // sessions (profil_2 : onglet fermé en C11.1 ; profil_3/profil_4 : semis).
    // La liste ne doit donc rien afficher, et surtout aucun profil servi.
    assert(r.inutilises.length === 0,
      'aucun compte inutilisé attendu (tous ont servi) : ' + JSON.stringify(r.inutilises));
    // Comptes surchargés : profil_1 dépasse largement le seuil (3 quotas).
    assert(r.surcharges.length >= 1 && r.surcharges.some(t => t.titre === 'profil_1'),
      'profil_1 attendu dans les surchargés : ' + JSON.stringify(r.surcharges));
    assert(!r.deborde, 'débordement horizontal du contenu');
    assert(r.scripts === 0, 'aucun <script> injecté');
  });

  await test('C14.2 Période « semaine » : seules les sessions des 7 derniers jours comptent (#206)', async () => {
    const r = await exec(`(async () => {
      document.querySelector('[data-action="ui-openStatsModal"]').click();
      await new Promise(res => setTimeout(res, 300));
      document.querySelector('#statsPeriodes [data-periode="semaine"]').click();
      await new Promise(res => setTimeout(res, 300));
      const body = document.getElementById('statsBody');
      const cartes = [...body.querySelectorAll('.stats-carte')];
      const c = cartes.find(x => x.querySelector('.stats-carte__libelle').textContent.includes('Sessions'));
      return { sessions: c.querySelector('.stats-carte__valeur').textContent.trim(),
        active: document.querySelector('#statsPeriodes .stats-periode--active').dataset.periode };
    })()`);
    // Le semis est volontairement dense sur la période : le total « semaine »
    // est au moins les sessions semées sur 7 jours (les onglets ouverts et
    // les sessions des tests précédents, tous récents, s'y ajoutent).
    assert(Number(r.sessions) >= attenduSesSemaine,
      'sessions « semaine » ≥ ' + attenduSesSemaine + ' attendues, obtenu ' + r.sessions);
    assert(r.active === 'semaine', 'période active : ' + r.active);
    assert(Number(r.sessions) < lignesSessions14 + ongletsOuverts,
      'la période « semaine » doit exclure l\'historique ancien');
  });

  await test('C14.3 Export JSON avec un vrai historique : contenu complet et cohérent (#206)', async () => {
    const { dialog } = require('electron');
    const origine = dialog.showSaveDialog;
    const cible = path.join(statsDir, '..', 'export-c14.json');
    dialog.showSaveDialog = async (_w, opts) => { return { canceled: false, filePath: cible }; };
    try {
      await exec(`window.exportStatsJson(); 'ok'`);
      let brut = null;
      for (let i = 0; i < 30 && brut === null; i++) {
        await sleep(200);
        try { brut = fs.readFileSync(cible, 'utf-8'); } catch (e) { /* pas encore écrit */ }
      }
      assert(brut, 'fichier exporté absent');
      const j = JSON.parse(brut);
      assert(j.format === 'iao-stats-1', 'format : ' + j.format);
      assert(Array.isArray(j.sessions) && j.sessions.length === lignesSessions14 + ongletsOuverts,
        'export : ' + (lignesSessions14 + ongletsOuverts) + ' sessions attendues, obtenu ' + (j.sessions && j.sessions.length));
      assert(Array.isArray(j.reponses) && j.reponses.length === lignesReponses14,
        'export : ' + lignesReponses14 + ' réponses attendues, obtenu ' + (j.reponses && j.reponses.length));
      // Le nom de compte est joint (pas le brut du profil).
      assert(j.sessions.some(s => s.compte === 'Compte Test Un'),
        'nom de compte joint aux sessions : ' + JSON.stringify(j.sessions[0]));
    } finally {
      dialog.showSaveDialog = origine;
    }
  });

  await test('C14.4 Remise à zéro efface le vrai historique puis la page se reconstruit (#206)', async () => {
    // La remise à zéro est couverte par C11.4 sur un petit historique ; ici
    // on vérifie qu'elle vide bien ~600 sessions et ~400 réponses. Les
    // onglets restés ouverts repartent de maintenant : la carte « Sessions »
    // retombe exactement sur leur nombre.
    // Stabilisation avant la purge : le renderer vide la file de mesures de
    // chaque page toutes les 3 s (lib/mesure-reponse.js) — attendre un
    // cycle complet pour qu'aucune mesure en retard (webview ralentie en
    // arrière-plan) ne soit écrite APRÈS la remise à zéro, ce qui ferait
    // échouer l'assertion « reponses.jsonl doit être vidé » (course
    // observée une fois en CI : « 102 caractères » = une ligne livrée tard).
    await sleep(3500);
    const r = await exec(`(async () => {
      window.resetStats();
      await new Promise(res => setTimeout(res, 300));
      const oui = document.getElementById('confirmModalYes');
      if (oui && oui.offsetParent !== null) oui.click();
      await new Promise(res => setTimeout(res, 800));
      const body = document.getElementById('statsBody');
      const cartes = [...body.querySelectorAll('.stats-carte')];
      const c = cartes.find(x => x.querySelector('.stats-carte__libelle').textContent.includes('Sessions'));
      return { sessions: c ? c.querySelector('.stats-carte__valeur').textContent.trim() : null,
        cartes: cartes.length };
    })()`);
    assert(r.sessions === String(ongletsOuverts),
      'après remise à zéro, seuls les ' + ongletsOuverts + ' onglets ouverts comptent : ' + r.sessions);
    const apres = fs.readFileSync(fichierSessions14, 'utf-8');
    assert(apres.trim() === '', 'sessions.jsonl doit être vidé : ' + apres.length + ' caractères');
    const apresRep = fs.readFileSync(fichierReponses14, 'utf-8');
    assert(apresRep.trim() === '', 'reponses.jsonl doit être vidé : ' + apresRep.length + ' caractères');
    const apresQuo = fs.readFileSync(fichierQuotas14, 'utf-8');
    assert(apresQuo.trim() === '', 'quotas.jsonl doit être vidé : ' + apresQuo.length + ' caractères');
  });

  // =========================================================================
  // Nettoyage
  // =========================================================================
  etapeCourante = 'résumé et nettoyage';
  console.log('\n--- Résumé ---');
  console.log('tests: ' + (passed + failed) + ', pass: ' + passed + ', fail: ' + failed);
  for (const c of crashs) {
    console.log('Processus de rendu arrêté pendant « ' + c.etape + ' » : ' + c.raison + ' (code ' + c.code + ')' +
      ' — les tests suivants ont tourné sur une page rechargée.');
    if (process.env.GITHUB_ACTIONS) {
      console.log('::error title=Harnais UI::Processus de rendu arrêté pendant « ' + c.etape + ' » : ' + c.raison + ' (code ' + c.code + ')');
    }
  }
  if (failures.length > 0) {
    console.log('\nÉchecs :');
    for (const f of failures) {
      console.log('  ' + f.name + ' : ' + (f.error && f.error.message ? f.error.message : f.error));
    }
  }

  if (MEASURE_COVERAGE) {
    try {
      const text = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf-8');
      const r = await v8cov.takeCoverage(win.webContents, 'assets/app.js', text);
      if (!r) {
        console.log('COV assets/app.js : script non chargé, aucune mesure');
      } else {
        console.log('COV assets/app.js : lignes ' + r.lines.covered + '/' + r.lines.total +
          ' (' + r.lines.pct.toFixed(1) + ' %), fonctions ' + r.functions.called + '/' + r.functions.total +
          ' (' + r.functions.pct.toFixed(1) + ' %) — informatif, non bloquant');
        if (process.env.IAO_COVERAGE_OUT) {
          fs.writeFileSync(process.env.IAO_COVERAGE_OUT, JSON.stringify(r, null, 2), 'utf-8');
        }
      }
    } catch (e) { console.log('COV mesure impossible : ' + e.message); }
  }

  try { win.destroy(); } catch (e) { /* ignore */ }
  app.exit(failed > 0 ? 1 : 0);
}

app.whenReady().then(run).catch((e) => {
  console.error('Erreur fatale du harnais UI :', e);
  app.exit(1);
});
