// assets/app.js — ancien <script> inline de fin d'index.html (lot CSP, 18/09/2026).
// Extrait tel quel : voir index.html pour le HTML, lib/*.js pour les modules purs.
// Comportement identique au script inline d'origine (même portée globale).

// Issue #4 : contextIsolation: true — le renderer n'a plus accès à Node.
// Les APIs nécessaires sont exposées par preload.js via window.iaoAPI.
// L'ancien mécanisme de sauvegarde du require Electron est supprimé.

  // escapeHtml() vient désormais de lib/escape-html.js (chantier F, chargé en
  // <script src> plus haut) — comportement identique, désormais testé par
  // `node --test` (test/pure.test.js).

  // Filet de sécurité (chantier audit 3.6) : si assets/icons.js n'a pas pu se
  // charger, `hydrateIcons` serait absente et le 1er appel dans initApp() ferait
  // planter TOUTE l'app. On garantit une fonction no-op -> au pire, pas d'icônes,
  // mais l'app reste utilisable.
  if (typeof window.hydrateIcons !== 'function') window.hydrateIcons = function () {};

  // === Démarrage ===
  // L'application démarre IMMÉDIATEMENT et NE DÉPEND PAS de Monaco.
  // Monaco (l'éditeur de code) est chargé EN LOCAL depuis node_modules et reste
  // OPTIONNEL : s'il n'arrive pas à s'initialiser (fichier manquant, erreur),
  // tout le reste de l'application continue de fonctionner normalement.
  // Chargement PARESSEUX (audit perf) : ~8 Mo de JS Monaco ne sont plus parsés
  // au démarrage mais au premier clic sur l'éditeur (qui démarre replié).
  var monacoRequested = false;
  function ensureMonacoLoaded() {
    if (monacoRequested) return;
    monacoRequested = true;
    // Placeholder le temps du chargement (~centaines de ms) ; remplacé par
    // Monaco (__initMonacoEditor vide le conteneur) ou par l'éditeur de secours.
    const c = document.getElementById('monacoContainer');
    if (c) c.innerHTML = '<div class="monaco-loading">Chargement de l\'éditeur…</div>';
    loadMonaco();
  }
  initApp();

  function loadMonaco() {
    // Si le loader.js n'a pas pu se charger, window.require reste le require
    // d'Electron (qui n'a pas de .config) : on bascule sur le mode dégradé.
    if (window.__monacoLoadFailed || typeof window.require === 'undefined' || typeof window.require.config !== 'function') {
      console.warn('[editor] loader.js indisponible (__monacoLoadFailed=' + window.__monacoLoadFailed + ', require=' + typeof window.require + ')');
      onMonacoUnavailable();
      return;
    }
    try {
      // Issue #4 : le chemin absolu de Monaco est calculé par preload.js
      // (window.iaoAPI.resolveMonacoBase) car le renderer n'a plus accès à
      // Node's url/path modules.
      let vsBase = 'node_modules/monaco-editor/min/vs';
      try {
        const resolved = window.iaoAPI.resolveMonacoBase();
        if (resolved) vsBase = resolved;
      } catch (e) { console.warn('[editor] chemin absolu Monaco indisponible, repli relatif'); }
      window.require.config({ paths: { vs: vsBase } });
      window.require(
        ['vs/editor/editor.main'],
        function () {
          console.log('[editor] Monaco chargé OK');
          if (window.__initMonacoEditor) window.__initMonacoEditor();
        },
        function (err) {
          // Échec du chargement du module Monaco.
          console.error('[editor] échec require(editor.main):', err && (err.message || err));
          onMonacoUnavailable();
        }
      );
    } catch (e) {
      console.error('[editor] exception loadMonaco:', e && (e.message || e));
      onMonacoUnavailable();
    }
  }

  function onMonacoUnavailable() {
    // Monaco indisponible : on bascule sur l'éditeur de secours (textarea).
    if (window.__initFallbackEditor) window.__initFallbackEditor();
  }

  function initApp() {
    // Issue #4 : ipcRenderer n'est plus accessible directement (contextIsolation).
    // window.iaoAPI.ipcInvoke est exposé par preload.js.
    // Issue #52 : si le preload n'a pas pu s'exécuter, on le dit clairement
    // (bandeau + journal) au lieu de planter sur « Cannot read properties of
    // undefined (reading 'ipcInvoke') » avec une interface vide.
    if (!window.iaoAPI || typeof window.iaoAPI.ipcInvoke !== 'function') {
      if (typeof window.__iaoReportStartupProblem === 'function') {
        window.__iaoReportStartupProblem('preload', 'window.iaoAPI indisponible : preload.js ne s\'est pas exécuté');
      }
      hydrateIcons(document);
      return;
    }
    const ipcRenderer = { invoke: window.iaoAPI.ipcInvoke };

    // Issue #331 : préférences de l'interface dans <userData>/preferences.json
    // (lib/magasin-preferences.js), même interface que localStorage. Les
    // onglets ouverts restent dans le localStorage.
    const prefStore = window.creerMagasinPreferences({
      lire: () => window.iaoAPI.preferencesLire(),
      ecrire: (prefs) => window.iaoAPI.preferencesEcrire(prefs)
    }, localStorage, console);

    // Issue #162 : mode debug (--iao-debug ou IAO_DEBUG=1, décidé par main.js).
    // dbg() écrit en console.debug : main.js ne recopie ce niveau dans
    // iao.log qu'en mode debug, et dbg() se tait hors de ce mode.
    let debugMode = false;
    function dbg(scope, ...args) {
      if (debugMode) console.debug('[' + scope + ']', ...args);
    }
    ipcRenderer.invoke('app:is-debug').then((on) => {
      debugMode = on === true;
      if (!debugMode) return;
      const badge = document.getElementById('debugBadge');
      if (badge) badge.classList.remove('hidden');
      const relaunch = document.getElementById('btnRelaunchDebug');
      if (relaunch) relaunch.classList.add('hidden'); // #187 : déjà en mode debug
      document.body.classList.add('iao-debug'); // #320 : outils de dev des onglets IA
      dbg('demarrage', 'mode debug actif dans l\'interface');
    }).catch(() => { /* canal absent (ancienne version de main.js) : mode normal */ });

    // Issue #51 : internationalisation. main.js renvoie le catalogue de la
    // langue demandée (--iao-lang=xx / IAO_LANG) ; en français (langue
    // source) il est vide et rien n'est touché. Lot 1 : interface statique
    // d'index.html (textes, title, placeholder...) ; les libellés construits
    // par ce fichier passeront par window.iaoT() dans les lots suivants.
    const I18N = window.IAO_I18N;
    window.iaoT = (msgid) => msgid;
    // Pluriels (ngettext) : règle du français tant que le catalogue n'est pas
    // chargé (0 et 1 au singulier), puis Plural-Forms de la langue.
    window.iaoN = (msgid, msgidPlural, n) => (Math.abs(Number(n) || 0) > 1 ? msgidPlural : msgid);
    // Libellé traduisible construit en JavaScript (repéré par xgettext, mot-clé
    // « _ ») : window.iaoT est relu à chaque appel, il devient le traducteur
    // une fois le catalogue chargé ; params remplit les marqueurs {nom}.
    const _ = (msgid, params) => {
      const s = window.iaoT(msgid);
      return I18N ? I18N.formatMessage(s, params) : s;
    };
    // Marque un libellé à extraire sans le traduire tout de suite (tables
    // construites avant le chargement du catalogue) : _() au moment du rendu.
    const N_ = (msgid) => msgid;
    // Libellé avec compteur (mot-clé xgettext « _n:1,2 ») : la forme dépend
    // de n selon la langue (russe : 1 / 2-4 / 5+, arabe : 6 formes…).
    // params remplit les marqueurs ; {n} n'est pas implicite.
    const _n = (msgid, msgidPlural, n, params) => {
      const s = window.iaoN(msgid, msgidPlural, n);
      return I18N ? I18N.formatMessage(s, params) : s;
    };
    function applyTranslations(root, tr) {
      const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'WEBVIEW']);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const texts = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
      for (const node of texts) {
        const parent = node.parentElement;
        if (!parent || SKIP.has(parent.tagName) || parent.closest('#monacoContainer')) continue;
        const next = I18N.translateText(node.nodeValue, tr);
        if (next !== node.nodeValue) node.nodeValue = next;
      }
      for (const attr of I18N.TRANSLATED_ATTRIBUTES) {
        root.querySelectorAll('[' + attr + ']').forEach((el) => {
          const value = el.getAttribute(attr);
          const next = I18N.translateText(value, tr);
          if (next !== value) el.setAttribute(attr, next);
        });
      }
    }
    // Lot 3 : liste du réglage « Langue », nom de chaque langue dans sa propre
    // langue (« English », « Deutsch »...), d'après les catalogues livrés.
    function fillLanguageSelect(available, current) {
      const select = document.getElementById('settingsLanguage');
      if (!select || !Array.isArray(available)) return;
      for (const code of available) {
        if (select.querySelector('option[value="' + code + '"]')) continue;
        const opt = document.createElement('option');
        opt.value = code;
        let label = code;
        try { label = new Intl.DisplayNames([code.replace('_', '-')], { type: 'language' }).of(code.replace('_', '-')) || code; }
        catch (_) { /* code inconnu d'Intl : on garde le code */ }
        opt.textContent = label.charAt(0).toUpperCase() + label.slice(1) + ' (' + code + ')';
        select.appendChild(opt);
      }
      if (current) select.value = current;
    }
    if (I18N) {
      ipcRenderer.invoke('i18n:catalog').then((catalog) => {
        if (!catalog) return;
        fillLanguageSelect(catalog.available, catalog.setting);
        if (catalog.locale === I18N.SOURCE_LOCALE) return;
        const tr = I18N.createTranslator(catalog);
        window.iaoT = tr.gettext;
        window.iaoN = tr.ngettext;
        document.documentElement.lang = catalog.locale;
        // Arabe, hébreu, persan… : mise en page de droite à gauche (issue #51).
        document.documentElement.dir = I18N.textDirection(catalog.locale);
        applyTranslations(document.body, tr);
        dbg('i18n', 'interface traduite : ' + catalog.locale);
      }).catch((e) => { console.warn('[i18n] catalogue indisponible, interface en français :', e && e.message); });
    }

    const SERVICES = [
      { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', cssClass: 'svc-claude' },
      { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', cssClass: 'svc-chatgpt' },
      { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', cssClass: 'svc-gemini' },
      { id: 'zeta', name: 'Z.ai', url: 'https://chat.z.ai/', cssClass: 'svc-zeta' },
      { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', cssClass: 'svc-perplexity' },
      { id: 'grok', name: 'Grok', url: 'https://grok.com/', cssClass: 'svc-grok' },
      { id: 'leonardo', name: 'Leonardo AI', url: 'https://app.leonardo.ai/', cssClass: 'svc-leonardo' },
      { id: 'suno', name: 'Suno', url: 'https://suno.com/create', cssClass: 'svc-suno' },
      { id: 'meshy', name: 'Meshy AI', url: 'https://www.meshy.ai/workspace', cssClass: 'svc-meshy' },
      // Issue #42 : services additionnels (sélectionnables via le menu)
      { id: 'mistral', name: 'Mistral', url: 'https://chat.mistral.ai/', cssClass: 'svc-mistral' },
      { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', cssClass: 'svc-deepseek' },
      { id: 'copilot', name: 'GitHub Copilot', url: 'https://github.com/features/copilot', cssClass: 'svc-copilot' },
      { id: 'elicit', name: 'Elicit', url: 'https://elicit.com/', cssClass: 'svc-elicit' },
      { id: 'notebooklm', name: 'NotebookLM', url: 'https://notebooklm.google.com/', cssClass: 'svc-notebooklm' },
      { id: 'wolfram', name: 'Wolfram Alpha', url: 'https://www.wolframalpha.com/', cssClass: 'svc-wolfram' },
      { id: 'deepl', name: 'DeepL', url: 'https://www.deepl.com/translator', cssClass: 'svc-deepl' },
      { id: 'ideogram', name: 'Ideogram', url: 'https://ideogram.ai/', cssClass: 'svc-ideogram' },
      { id: 'kling', name: 'Kling', url: 'https://klingai.com/', cssClass: 'svc-kling' },
      { id: 'runway', name: 'Runway', url: 'https://runwayml.com/', cssClass: 'svc-runway' },
      { id: 'pika', name: 'Pika', url: 'https://pika.art/', cssClass: 'svc-pika' },
      { id: 'qwen', name: 'Qwen', url: 'https://chat.qwen.ai/', cssClass: 'svc-qwen' }
    ];

    // Issue #42 : liste des services "à portée de main" (9 par défaut).
    // Stockée dans localStorage, modifiable via le menu de sélection.
    // Issue #319 : de 1 à tous les services (plus de plafond à 9).
    const ACTIVE_SERVICES_KEY = 'ai_active_services';
    const DEFAULT_ACTIVE_SERVICES = ['claude','chatgpt','gemini','zeta','perplexity','grok','leonardo','suno','meshy'];

    function getActiveServices() {
      try {
        const raw = prefStore.getItem(ACTIVE_SERVICES_KEY);
        if (!raw) return DEFAULT_ACTIVE_SERVICES.slice();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return DEFAULT_ACTIVE_SERVICES.slice();
        // Filtrer les IDs invalides et les doublons
        const valid = parsed.filter((id, i) => SERVICES.some(s => s.id === id) && parsed.indexOf(id) === i);
        if (valid.length === 0) return DEFAULT_ACTIVE_SERVICES.slice();
        return valid;
      } catch (e) { return DEFAULT_ACTIVE_SERVICES.slice(); }
    }

    function saveActiveServices(ids) {
      try { prefStore.setItem(ACTIVE_SERVICES_KEY, JSON.stringify(ids)); }
      catch (e) { /* non bloquant */ }
    }

    // Issue #324 : logo officiel du service (lib/service-icons.js), initiale à défaut.
    function svcIcon(svc) {
      return window.iaoServiceIcons.iconeService(svc.id, svc.name);
    }

    // Retourne les services actifs (objets complets), dans l'ordre de sélection.
    function activeServices() {
      const ids = getActiveServices();
      return ids.map(id => SERVICES.find(s => s.id === id)).filter(Boolean);
    }

    const COLORS = ['#8b5cf6','#f230aa','#c4b5fd','#a855f7','#5865f2','#ec4899','#38bdf8','#f97316'];

    // Contenu de la modale d'aide, indexé par id de service (même philosophie
    // data-driven que SERVICES : ajouter un service = ajouter son entrée ici).
    // Texte statique embarqué (aucun fetch réseau), rédigé neutre / grand public.
    const SERVICE_INFO = {
      claude: {
        what: N_("L'assistant conversationnel d'Anthropic. Il excelle en rédaction, en analyse de longs documents, en programmation et dans les raisonnements qui demandent plusieurs étapes."),
        when: N_("Plutôt pour du code, des textes longs et soignés, ou des questions complexes qui demandent de la rigueur.")
      },
      chatgpt: {
        what: N_("L'assistant généraliste d'OpenAI, le plus connu du grand public. Il discute, rédige, résume, génère des images, analyse des fichiers et peut chercher sur le web."),
        when: N_("Le couteau suisse du quotidien : brainstorming, questions générales, petites tâches variées.")
      },
      gemini: {
        what: N_("L'assistant IA de Google. Multimodal (texte, images, audio, vidéo), il s'appuie sur la recherche Google et s'intègre aux outils Google (Docs, Gmail, Drive…)."),
        when: N_("Plutôt pour analyser des images ou vidéos, ou si vous travaillez déjà dans l'écosystème Google.")
      },
      zeta: {
        what: N_("Le chat de Z.ai, propulsé par les modèles GLM. Gratuit pour l'essentiel, avec un mode agent capable de chercher sur le web et de produire des fichiers (docx, pdf, xlsx)."),
        when: N_("Une alternative gratuite solide pour le chat et le code, quand les quotas des autres sont épuisés.")
      },
      perplexity: {
        what: N_("Un « moteur de réponse » : il cherche sur le web en direct, synthétise plusieurs sources et cite ses références pour chaque affirmation."),
        when: N_("Plutôt pour la recherche d'informations à jour, la veille et la vérification de faits avec sources.")
      },
      grok: {
        what: N_("L'assistant de xAI (Elon Musk), connecté au réseau X (ex-Twitter). Ton direct, accès au temps réel de X, génération d'images incluse."),
        when: N_("Plutôt pour suivre l'actualité chaude et les tendances via X, ou pour un ton moins formel.")
      },
      leonardo: {
        what: N_("Une plateforme de génération d'images orientée création : illustrations, concept art, assets de jeu vidéo, avec des contrôles fins (styles, modèles, retouche)."),
        when: N_("Plutôt pour produire des visuels et illustrations de qualité avec un contrôle précis du style.")
      },
      suno: {
        what: N_("Un générateur de musique : il compose des chansons complètes (instruments, voix, paroles) à partir d'une simple description texte, dans à peu près tous les genres."),
        when: N_("Plutôt pour créer une musique, un jingle ou une chanson à partir d'un texte ou d'une idée.")
      },
      meshy: {
        what: N_("Un générateur de modèles 3D : il transforme un texte ou une image en objet 3D texturé, avec rigging/animation automatique et export vers les formats standards (GLB, FBX, STL…)."),
        when: N_("Plutôt pour créer des assets 3D (jeux, impression 3D, animation) sans savoir modéliser.")
      },
      // Issue #42 : fiches des services additionnels
      mistral: {
        what: N_("Le Chat de Mistral AI, éditeur européen (français). Modèles open-weights performants, chat, code et analyse de documents."),
        when: N_("Alternative européenne solide pour le chat et le code, avec une bonne maîtrise du français.")
      },
      deepseek: {
        what: N_("DeepSeek : assistant IA chinois spécialisé en raisonnement et programmation, particulièrement performant en Python."),
        when: N_("Pour du code Python, du raisonnement étape par étape, ou une alternative gratuite à ChatGPT.")
      },
      copilot: {
        what: N_("GitHub Copilot : assistant IA intégré dans VS Code et GitHub. Autocomplétion, chat, génération de tests, explication de code."),
        when: N_("Pour programmer plus vite dans VS Code ou sur GitHub, avec un modèle IA qui connaît votre codebase.")
      },
      elicit: {
        what: N_("Elicit : assistant de recherche scientifique. Trouve des articles, extrait des données, synthétise des études."),
        when: N_("Pour la recherche académique, la revue de littérature et l'extraction de données d'articles scientifiques.")
      },
      notebooklm: {
        what: N_("NotebookLM de Google : interagissez avec vos propres documents (PDF, texte, audio). Résumés, questions, génération de notes."),
        when: N_("Pour interroger vos documents personnels ou professionnels avec une IA qui cite ses sources.")
      },
      wolfram: {
        what: N_("Wolfram Alpha : moteur de calcul symbolique. Mathématiques, physique, chimie, données factuelles, conversions."),
        when: N_("Pour des calculs exacts (mathématiques symboliques), des données chiffrées ou des conversions d'unités.")
      },
      deepl: {
        what: N_("DeepL : traduction automatique de haute qualité, plus naturelle que Google Traduction. Texte et documents entiers."),
        when: N_("Pour traduire du texte ou des documents avec un rendu naturel et cohérent.")
      },
      ideogram: {
        what: N_("Ideogram : génération d'images orientée design. Logos, typographies, affiches, avec un excellent rendu du texte."),
        when: N_("Pour créer des visuels avec du texte lisible (logos, affiches, bannières) ou du design graphique.")
      },
      kling: {
        what: N_("Kling : générateur de vidéos courtes à partir de texte ou d'images. Animations réalistes, crédits gratuits disponibles."),
        when: N_("Pour créer des clips vidéo animés à partir d'une description ou d'une image fixe.")
      },
      runway: {
        what: N_("Runway : suite d'outils IA pour la vidéo. Génération, édition, effets spéciaux, inpainting vidéo."),
        when: N_("Pour le montage et la création vidéo avancée avec des outils IA intégrés.")
      },
      pika: {
        what: N_("Pika : générateur de vidéos courtes et créatives. Animation d'images, effets, transformation de styles."),
        when: N_("Pour animer des images ou créer des vidéos courtes originales avec des effets IA.")
      },
      qwen: {
        what: N_("Qwen : assistant IA d'Alibaba. Multimodal (texte, images, code), open-source, disponible en plusieurs tailles."),
        when: N_("Alternative gratuite pour le chat, le code et l'analyse d'images, avec un bon support multilingue.")
      }
    };

    // Icônes statiques du HTML (chantier D) : on remplit les <span class="ic">.
    hydrateIcons(document);

    // === Stockage résilient des comptes (chantier C, puis issue #311) ===
    // Issue #311 : les comptes vivent dans <userData>/profils.json (process
    // principal, lib/profils.js : écriture atomique, version précédente dans
    // profils.json.bak). Le localStorage ne garde que l'état de l'interface
    // (onglets, étoiles, ordre, repli). Les deux clés ci-dessous ne sont plus
    // que LUES, une fois, pour migrer une installation antérieure.
    const STORE_KEY = 'ai_accounts';
    const BACKUP_KEY = 'ai_accounts_backup';
    const TABS_KEY = 'ai_open_tabs'; // lot 18/09/2026 : restauration des onglets au démarrage
    const STARRED_KEY = 'ai_starred_tabs'; // issue #154 : onglets étoilés (persistants)
    const ORDER_KEY = 'ai_account_order'; // issue #6 : ordre personnalisé des comptes (drag-and-drop)

    // Issue #154 : Gestion des onglets étoilés (star). Un onglet étoilé est
    // identifié par la paire (accId, svcId) — stable même si l'onglet est fermé
    // puis rouvert. La liste persiste dans localStorage et survit aux redémarrages.
    // Les fonctions pures (tabStarKey, isTabStarred, toggleTabStar, serialize,
    // deserialize) viennent de lib/starred-tabs.js — testables par `node --test`.
    let starredTabs = new Set();
    function loadStarredTabs() {
      try {
        var raw = prefStore.getItem(STARRED_KEY);
        starredTabs = deserializeStarredTabs(raw);
      } catch (e) { /* non bloquant */ }
    }
    function saveStarredTabs() {
      try { prefStore.setItem(STARRED_KEY, serializeStarredTabs(starredTabs)); } catch (e) { /* non bloquant */ }
    }
    function isTabStarredById(accId, svcId) { return isTabStarred(starredTabs, accId, svcId); }
    function toggleTabStarById(accId, svcId) {
      starredTabs = toggleTabStar(starredTabs, accId, svcId);
      saveStarredTabs();
    }

    // Lecture JSON sûre : ne throw JAMAIS. Renvoie un statut pour distinguer
    // « vide » (première utilisation), « corrompu » (backup à proposer) et
    // « erreur » (accès au stockage impossible — issues #52/#186 : le renderer
    // continue, l'ordonnanceur proposera la restauration depuis son instantané).
    // La logique vient de lib/local-storage-json.js (testée par `node --test`).
    function readJSON(key) {
      const r = lireStockageJSON(localStorage, key);
      if (r.status === 'corrupt' || r.status === 'erreur') {
        console.error('[storage] ' + (r.status === 'corrupt' ? 'JSON corrompu' : 'accès impossible') +
          ' pour « ' + key + ' » :', r.error);
      }
      return r;
    }

    // Issue #311 : écriture synchrone de profils.json par le process principal
    // (profils:ecrire). La version précédente lisible passe dans
    // profils.json.bak ; un fichier illisible est mis de côté, jamais écrasé
    // sans copie. Renvoie { ok, nombre } ou { ok: false, erreur }.
    function ecrireProfils(list) {
      try {
        return window.iaoAPI.profilsEcrire(list) || { ok: false, erreur: 'pas de réponse' };
      } catch (e) {
        return { ok: false, erreur: (e && e.message) || String(e) };
      }
    }

    // Sauvegarde la liste de comptes dans profils.json (issue #311).
    function saveAccounts(list) {
      dbg('comptes', 'enregistrement de ' + list.length + ' compte(s)');
      try {
        const r = ecrireProfils(list);
        if (!r.ok) throw new Error(r.erreur);
        // Ordonnanceur (chantier E) : on pousse un instantané des comptes
        // (profil + état d'automatisation) au process principal, seul capable
        // de choisir un profil "le plus ancien" indépendamment des fenêtres
        // ouvertes. Best-effort : un échec ici ne doit jamais empêcher
        // l'enregistrement des comptes eux-mêmes.
        try { ipcRenderer.invoke('scheduler:sync-accounts', list).catch(() => {}); } catch (_) { /* ignore */ }
        return true;
      } catch (e) {
        console.error('[storage] échec écriture des comptes (profils.json) :', e);
        showToast(_('Impossible d\'enregistrer les comptes (stockage plein ?)'), 'error');
        return false;
      }
    }

    // Sauvegarde la liste des onglets ouverts (accId + svcId) pour restauration
    // au démarrage si « startWithLastSession » est activé (lot 18/09/2026).
    function saveOpenTabs() {
      try {
        localStorage.setItem(TABS_KEY, serializeOpenTabs(tabs));
      } catch (e) { /* non bloquant */ }
    }

    // Restaure les onglets sauvegardés (lot 18/09/2026). Issue #318 : seuls les
    // onglets d'un compte encore présent sont repris.
    function savedOpenTabs() {
      return deserializeOpenTabs(localStorage.getItem(TABS_KEY) || '')
        .filter(function(tab) { return accounts.some(function(a) { return a.id === tab.accId; }); });
    }
    function restoreOpenTabs() {
      savedOpenTabs().forEach(function(tab) {
        openService(tab.accId, tab.svcId);
      });
    }

    // Issues #317/#318 : au démarrage (relance comprise), les onglets de la
    // session précédente sont rouverts directement si « Restaurer les onglets
    // ouverts au démarrage » est coché, sinon proposés. Une seule fois : les
    // réglages sont relus à chaque ouverture de leur fenêtre.
    let startupTabsHandled = false;
    function handleStartupTabs(startWithLastSession) {
      if (startupTabsHandled) return;
      startupTabsHandled = true;
      if (startWithLastSession) { restoreOpenTabs(); return; }
      const n = savedOpenTabs().length;
      if (n === 0) return;
      showConfirmDialog(_('Rouvrir les onglets précédents ?'),
        _('Onglets ouverts à la fermeture d\'IAO : {n}. Les rouvrir ?', { n: n }),
        restoreOpenTabs);
    }

    // Fondation réutilisable pour une future fonctionnalité d'export/import JSON
    // (ne pas coder le backup « en dur » : ces deux fonctions serviront à l'UI).
    function exportAccountsJSON() { return JSON.stringify(accounts, null, 2); }
    function importAccountsJSON(text) {
      const parsed = JSON.parse(text); // peut throw : l'appelant (UI) gère l'erreur
      if (!Array.isArray(parsed)) throw new Error('Format invalide : un tableau de comptes est attendu.');
      accounts = parsed;
      migrateOldAccounts();  // complète/répare les comptes importés
      saveAccounts(accounts);
      renderAccounts();
      return accounts.length;
    }

    // Chargement initial tolérant : l'app ne plante JAMAIS au démarrage, même si
    // profils.json est illisible (le cas échéant on propose la restauration plus bas).
    let dataCorrupt = false;
    let accounts = [];
    let accountsLoadStatus = 'empty'; // issue #186 : signalé à main.js pour iao.log
    let profilsSauvegarde = null;     // issue #311 : profils.json.bak si profils.json est illisible
    (function loadAccounts() {
      let p;
      try { p = window.iaoAPI.profilsLire() || { status: 'erreur', erreur: 'pas de réponse' }; }
      catch (e) { p = { status: 'erreur', erreur: (e && e.message) || String(e) }; }
      if (p.status === 'ok') { accounts = p.comptes; accountsLoadStatus = 'ok'; return; }
      if (p.status !== 'absent') {
        console.error('[storage] profils.json illisible (' + p.status + ') :', p.erreur);
        dataCorrupt = true;
        profilsSauvegarde = Array.isArray(p.sauvegarde) ? p.sauvegarde : null;
        accountsLoadStatus = p.status === 'corrompu' ? 'corrupt' : 'erreur';
        return;
      }
      // profils.json absent : premier démarrage, ou installation antérieure
      // à #311 dont les comptes sont encore dans le localStorage. Migration
      // unique : les comptes lus y sont recopiés dans profils.json.
      const r = readJSON(STORE_KEY);
      accountsLoadStatus = r.status;
      if (r.status === 'ok' && Array.isArray(r.data)) {
        accounts = r.data;
        if (accounts.length > 0) {
          const w = ecrireProfils(accounts);
          if (w.ok) {
            // Les anciennes clés sont retirées : sinon, profils.json supprimé à
            // la main, des comptes périmés reviendraient au démarrage suivant.
            try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(BACKUP_KEY); }
            catch (e) { console.warn('[storage] anciennes clés de comptes non retirées :', e); }
            dbg('comptes', 'migration : ' + accounts.length + ' compte(s) du localStorage recopié(s) dans profils.json');
          } else console.error('[storage] migration des comptes vers profils.json impossible :', w.erreur);
        }
      } else if (r.status === 'corrupt') dataCorrupt = true;
      // 'empty' ou JSON valide non-tableau -> accounts reste []
    })();

    // Issue #154 : charger les onglets étoilés au démarrage.
    loadStarredTabs();

    // Vue compacte : ids des comptes dont la grille de services est repliée.
    // Persisté dans localStorage (clé dédiée, même modèle défensif que ide_w :
    // une valeur absente/illisible retombe sur le défaut = tout déplié).
    const COLLAPSED_KEY = 'collapsed_accounts';
    let collapsedAccounts = new Set();
    try {
      const saved = JSON.parse(prefStore.getItem(COLLAPSED_KEY) || '[]');
      if (Array.isArray(saved)) collapsedAccounts = new Set(saved.filter(x => typeof x === 'string'));
    } catch (e) { console.warn('[storage] états de repli ignorés :', e); }

    // Écrit l'état de repli en purgeant les ids de comptes supprimés
    // (la clé ne grossit pas indéfiniment au fil des suppressions).
    function saveCollapsed() {
      collapsedAccounts = new Set([...collapsedAccounts].filter(id => accounts.some(a => a.id === id)));
      try { prefStore.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedAccounts])); } catch (e) {}
    }

    window.toggleCardCollapse = function(accId) {
      if (!accounts.some(a => a.id === accId)) return; // garde : id obsolète
      if (collapsedAccounts.has(accId)) collapsedAccounts.delete(accId);
      else collapsedAccounts.add(accId);
      saveCollapsed();
      renderAccounts();
    }

    // Bascule globale : s'il reste au moins une carte dépliée on replie tout,
    // sinon on déplie tout. Idempotent sur les cartes déjà dans l'état cible.
    window.toggleAllCards = function() {
      if (accounts.length === 0) return;
      const anyExpanded = accounts.some(a => !collapsedAccounts.has(a.id));
      if (anyExpanded) accounts.forEach(a => collapsedAccounts.add(a.id));
      else collapsedAccounts.clear();
      saveCollapsed();
      renderAccounts();
    }

    let activeAccountId = null;
    // Onglets IA : chaque service ouvert (compte + service) vit dans son propre
    // onglet, avec sa <webview> dédiée. tabs[] est l'unique source de vérité ;
    // le DOM (barre d'onglets + panneaux) est entièrement redérivé de ce tableau.
    let tabs = [];          // { id, accId, svcId, paneEl }
    let activeTabId = null;
    let tabSeq = 0;

    // Issue #206 (lot 1) : statistiques d'utilisation, mesurées localement.
    // Une session = vie d'un onglet (compte, service) ; temps actif = onglet au
    // premier plan ET fenêtre IAO au focus. Les sessions terminées et
    // l'instantané des sessions ouvertes partent par stats:sync (fermeture
    // d'onglet + toutes les minutes) : un arrêt brutal perd au plus 1 min.
    const suiviStats = window.iaoStats.creerSuivi({ focus: document.hasFocus() });
    function synchroniserStats(terminees) {
      ipcRenderer.invoke('stats:sync', terminees || [], suiviStats.instantane())
        .then((r) => { if (r && r.error) dbg('stats', 'sync en échec', r.error); })
        .catch((e) => dbg('stats', 'sync en échec', e && e.message));
    }
    window.addEventListener('focus', () => suiviStats.focus(true));
    window.addEventListener('blur', () => suiviStats.focus(false));
    setInterval(() => { if (suiviStats.taille()) synchroniserStats([]); }, window.iaoStats.SYNC_INTERVALLE_MS);
    let monacoEditor = null;
    let fallbackTextarea = null;
    let editorMode = 'none'; // 'monaco' | 'textarea' | 'none'
    let currentOpenFilePath = null;

    // Migration : convertit les anciens comptes et aligne leurs services sur
    // la sélection « mes IA à portée de main » (issue #42), un cooldown pour chacun.
    // Issue #319 : la liste d'un compte EST la sélection active (aucun écran ne
    // la choisit compte par compte). Avant, les services actifs étaient ajoutés
    // à ceux du compte : après un changement de sélection, on retrouvait au
    // redémarrage les 9 anciens plus les nouveaux.
    function migrateOldAccounts() {
      let needsUpdate = false;
      const ALL_SERVICES = getActiveServices();
      accounts.forEach(acc => {
        if (acc.quotas && !acc.cooldowns) { delete acc.quotas; needsUpdate = true; }
        if (window.iaoServicesActifs.alignerServices(acc, ALL_SERVICES)) needsUpdate = true;
        // Ordonnanceur (chantier E, proposition externe intégrée au backlog) :
        // chaque compte porte désormais son état d'automatisation, indépendant
        // des cooldowns par service. lastUsedAt = dernière ouverture manuelle ;
        // lastAutomationAt = dernier job d'ordonnanceur exécuté sur ce profil
        // (sert à choisir le profil "le plus ancien" avant d'en relancer un).
        // Issue #333 : compte importé sans profil -> profil tiré de son nom.
        if (!acc.profile || typeof acc.profile !== 'string') {
          acc.profile = window.iaoProfilCompte.profilDepuisNom(acc.name, accounts.map(a => a.profile).filter(Boolean));
          needsUpdate = true;
        }
        if (!acc.automation || typeof acc.automation !== 'object') {
          acc.automation = { enabled: true, lastUsedAt: 0, lastAutomationAt: 0 };
          needsUpdate = true;
        }
      });
      if (needsUpdate) saveAccounts(accounts);
    }
    migrateOldAccounts();

    // Éditeur Monaco — créé UNIQUEMENT si Monaco a pu se charger (optionnel).
    // Appelé par loadMonaco() une fois le CDN chargé. Si Monaco échoue, cette
    // fonction n'est jamais appelée et l'app fonctionne sans éditeur.
    window.__initMonacoEditor = function() {
      if (typeof monaco === 'undefined' || monacoEditor) return;
      const container = document.getElementById('monacoContainer');
      container.innerHTML = ''; // retire le placeholder « Chargement de l'éditeur… »
      monacoEditor = monaco.editor.create(container, {
        value: '// ' + _('Sélectionnez un fichier pour l\'éditer ici.') + '\n// ' + _('Ctrl+S pour sauvegarder.'),
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true
      });
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
        saveCurrentFile();
      });
      editorMode = 'monaco';
    };

    // Éditeur de SECOURS (textarea) — utilisé si Monaco n'a pas pu se charger.
    // Toujours fonctionnel : ouverture, édition et sauvegarde (Ctrl+S).
    window.__initFallbackEditor = function() {
      if (editorMode === 'monaco') return; // Monaco a réussi, on ne fait rien
      const c = document.getElementById('monacoContainer');
      if (!c) return;
      c.innerHTML = `
        <div class="fallback-editor">
          <div class="fallback-editor__warning">
            <span class="ic" data-icon="triangle-exclamation"></span> ${escapeHtml(_('Éditeur simplifié (Monaco indisponible) — Ctrl+S pour sauvegarder'))}
          </div>
          <textarea id="fallbackEditor" spellcheck="false" disabled
            class="fallback-editor__textarea"
            placeholder="${escapeHtml(_('Sélectionnez un fichier pour l\'éditer ici.'))}"></textarea>
        </div>`;
      hydrateIcons(c); // remplit l'icône SVG du bandeau
      fallbackTextarea = document.getElementById('fallbackEditor');
      fallbackTextarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveCurrentFile(); }
        if (e.key === 'Tab') {
          e.preventDefault();
          const s = fallbackTextarea.selectionStart, en = fallbackTextarea.selectionEnd;
          fallbackTextarea.value = fallbackTextarea.value.slice(0, s) + '  ' + fallbackTextarea.value.slice(en);
          fallbackTextarea.selectionStart = fallbackTextarea.selectionEnd = s + 2;
        }
      });
      editorMode = 'textarea';
    };

    // Accès unifié à l'éditeur (Monaco OU textarea de secours).
    function getEditorValue() {
      if (editorMode === 'monaco' && monacoEditor) return monacoEditor.getValue();
      if (editorMode === 'textarea' && fallbackTextarea) return fallbackTextarea.value;
      return null;
    }
    function setEditorContent(content, lang) {
      if (editorMode === 'monaco' && monacoEditor) {
        monaco.editor.setModelLanguage(monacoEditor.getModel(), lang);
        monacoEditor.setValue(content);
      } else if (editorMode === 'textarea' && fallbackTextarea) {
        fallbackTextarea.disabled = false;
        fallbackTextarea.value = content;
      }
    }

    async function saveCurrentFile() {
      if (!currentOpenFilePath || editorMode === 'none') return;
      const content = getEditorValue();
      if (content === null) return;
      const success = await ipcRenderer.invoke('save-file', currentOpenFilePath, content);
      if (success) showToast(_('Fichier enregistré !'));
      else showToast(_('Erreur d\'enregistrement.'), 'error');
    }

    // Rendu
    // --- Issue #6 : ordre personnalisé des comptes (drag-and-drop) ------------
    // L'ordre est stocké comme un tableau d'IDs dans ai_account_order.
    // Les comptes sans ordre explicite sont triés alphabétiquement (fallback).
    function getAccountOrder() {
      try {
        const raw = prefStore.getItem(ORDER_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed.filter(id => typeof id === 'string');
      } catch (e) { return null; }
    }

    function saveAccountOrder(orderList) {
      try { prefStore.setItem(ORDER_KEY, JSON.stringify(orderList)); }
      catch (e) { /* non bloquant */ }
    }

    // Trie les comptes : ordre personnalisé d'abord, puis alphabétique pour
    // les comptes sans ordre explicite (nouveaux comptes, comptes importés).
    function sortAccountsByOrder(list) {
      const order = getAccountOrder();
      if (!order || order.length === 0) {
        return [...list].sort((a, b) => compareAccountNames(a.name, b.name));
      }
      const orderMap = new Map();
      order.forEach((id, idx) => orderMap.set(id, idx));
      const fallback = list.length + 1000;
      return [...list].sort((a, b) => {
        const ia = orderMap.has(a.id) ? orderMap.get(a.id) : fallback;
        const ib = orderMap.has(b.id) ? orderMap.get(b.id) : fallback;
        if (ia !== ib) return ia - ib;
        return compareAccountNames(a.name, b.name);
      });
    }

    // Nettoie l'ordre : supprime les IDs de comptes supprimés.
    function pruneAccountOrder(currentAccounts) {
      const order = getAccountOrder();
      if (!order) return;
      const validIds = new Set(currentAccounts.map(a => a.id));
      const pruned = order.filter(id => validIds.has(id));
      // Ajoute les nouveaux comptes à la fin
      currentAccounts.forEach(a => { if (!pruned.includes(a.id)) pruned.push(a.id); });
      saveAccountOrder(pruned);
    }

    function renderAccounts() {
      const container = document.getElementById('accountsList');
      if (accounts.length === 0) {
        // État vide : appel à l'action pour créer un premier compte. Le bouton
        // porte data-action="add" -> géré par la délégation (aucun onclick, aucune
        // donnée utilisateur ici de toute façon).
        container.innerHTML = `
          <div class="tabs-empty--full">
            <div>${escapeHtml(_('Aucun compte pour l\'instant.'))}</div>
            <button class="btn btn--primary" data-action="add"><span class="ic" data-icon="plus"></span> ${escapeHtml(_('Créer mon premier compte'))}</button>
          </div>`;
        hydrateIcons(container);
        updateStats(); // remet les stats à 0 (ex. après suppression du dernier compte)
        return;
      }

      // Issue #6 : ordre personnalisé (drag-and-drop) d'abord, fallback
      // alphabétique pour les comptes sans ordre explicite. accounts[] lui-même
      // garde son ordre de stockage -> aucun impact sur saveAccounts()/raccourcis.
      const sortedAccounts = sortAccountsByOrder(accounts);
      container.innerHTML = sortedAccounts.map((acc, idx) => {
        // Toute donnée issue du compte (nom, email, profil, couleur) est saisie
        // par l'utilisateur -> échappée avant injection (chantier A).
        const id = escapeHtml(acc.id);
        const isActive = acc.id === activeAccountId;
        const isCollapsed = collapsedAccounts.has(acc.id);
        // Puces de statut (lot 16/09/2026, déplacées par l'issue #137) : une
        // par bouton d'IA, calculée par couple (compte, service) avec les mêmes
        // règles bleu/rouge/vert — voir getServiceActivityStatus().
        const lastUsedBySvc = acc.automation ? acc.automation.lastUsedBySvc : null;
        // Résumé « N/7 » de la carte repliée : même test de disponibilité que
        // updateStats -> reste synchro avec le tick des cooldowns (re-render 1×/min).
        const availCount = acc.services.filter(sid => !acc.cooldowns[sid] || acc.cooldowns[sid] <= Date.now()).length;

        const servicesHtml = acc.services.map(sid => {
          const svc = SERVICES.find(s => s.id === sid);
          if (!svc) return '';
          const cdTime = acc.cooldowns[sid] || 0;
          const isOnCooldown = cdTime > Date.now();
          // Issue #324 : bouton de couleur standard (plus de fond par service),
          // logo officiel devant le nom.
          const btnClass = isOnCooldown ? 'cooldown-active' : '';
          // svc.id vient de SERVICES (valeurs sûres codées en dur). Les actions
          // passent par des data-* lus par la délégation d'événements (chantier A) :
          // plus aucune donnée n'est injectée dans un attribut onclick.
          return `
            <div class="service-column">
              <button class="svc-btn ${btnClass}" data-action="open-service" data-acc="${id}" data-svc="${svc.id}">${svcIcon(svc)}<span class="svc-btn__nom">${escapeHtml(svc.name)}</span>${svcStatusDot(acc, svc.id, lastUsedBySvc)}${isTabStarredById(acc.id, svc.id) ? '<span class="svc-btn__star"><span class="ic" data-icon="star"></span></span>' : ''}</button>
            </div>
          `;
        }).join('');

        // Le header entier bascule le repli (data-action="toggle-collapse") :
        // les boutons éditer/supprimer imbriqués portent leur propre data-action,
        // que closest() résout en priorité -> aucun conflit de clic.
        return `
          <div class="account-card ${isActive ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}" draggable="true" data-acc="${id}">
            <div class="account-header" data-action="toggle-collapse" data-acc="${id}">
              <div class="account-info">
                <div class="account-name">${escapeHtml(acc.name)} ${isActive ? '<span class="active-dot"></span>' : ''}</div>
                <div class="account-email">${acc.email ? `<span class="account-email-copy" data-action="copy-email" data-acc="${id}" title="${escapeHtml(_('Cliquer pour copier l\'e-mail'))}">${escapeHtml(acc.email)}</span>` : ''}</div>
              </div>
              <div class="account-actions">
                ${currentSettings && currentSettings.webmailUrl ? `<button class="btn btn--icon" data-action="open-webmail" data-acc="${id}" title="${escapeHtml(_('Ouvrir le webmail (adresse copiée)'))}"><span class="ic" data-icon="envelope"></span></button>` : ''}
                <button class="btn btn--icon" data-action="edit" data-acc="${id}" title="${escapeHtml(_('Modifier le compte'))}"><span class="ic" data-icon="pen"></span></button>
                <button class="btn btn--icon" data-action="delete" data-acc="${id}" title="${escapeHtml(_('Supprimer le compte'))}"><span class="ic icon-danger" data-icon="trash"></span></button>
              </div>
              <span class="svc-summary ${availCount < acc.services.length ? 'has-cd' : ''}" title="${escapeHtml(_n('{available} service hors cooldown sur {total}', '{available} services hors cooldown sur {total}', availCount, { available: availCount, total: acc.services.length }))}">${availCount}/${acc.services.length}</span>
              <span class="ic collapse-chevron" data-icon="chevron-down" title="${escapeHtml(_('Replier / déplier'))}"></span>
            </div>
            <div class="services-wrap"><div class="services-inner">
              <div class="services-grid">${servicesHtml}</div>
            </div></div>
          </div>
        `;
      }).join('');
      applyDataColors(container); // lot 9 : couleurs dynamiques (avatars)
      hydrateIcons(container); // remplit les icônes SVG des boutons éditer/supprimer
      updateStats();
    }

    // Issue #137 : puce de statut d'un bouton d'IA (compte, service).
    function svcStatusDot(acc, svcId, lastUsedBySvc, now) {
      const status = getServiceActivityStatus({ tabs, accId: acc.id, svcId, lastUsedBySvc, now });
      return `<span class="status-dot status-dot--${status}" title="${activityStatusTitle(status)}"></span>`;
    }

    function updateStats() {
      let activeAccounts = 0, availableIAs = 0;
      accounts.forEach(acc => {
        let hasAvailable = false;
        acc.services.forEach(sid => {
          if (!acc.cooldowns[sid] || acc.cooldowns[sid] <= Date.now()) { availableIAs++; hasAvailable = true; }
        });
        if (hasAvailable) activeAccounts++;
      });
      document.getElementById('statActive').textContent = activeAccounts;
      document.getElementById('statAvailable').textContent = availableIAs;
      // Oriente le chevron du bouton « Tout replier / déplier » selon l'état
      // global (appelé dans les deux branches de renderAccounts, y c. liste vide).
      const allBtn = document.getElementById('btnToggleAllCards');
      if (allBtn) allBtn.classList.toggle('all-collapsed', accounts.length > 0 && accounts.every(a => collapsedAccounts.has(a.id)));
    }

    window.toggleDashboard = function() {
      const dash = document.getElementById('dashboard');
      const btnShow = document.getElementById('btnShowDashboard');
      const btnHide = document.getElementById('btnHideDashboard');
      dash.classList.toggle('collapsed');
      const collapsed = dash.classList.contains('collapsed');
      btnShow.style.display = collapsed ? 'flex' : 'none';
      btnHide.style.display = collapsed ? 'none' : 'flex';
    }

    // Issue #149 : palette ouverte au clavier (Ctrl+K) ou par le bouton à côté
    // des compteurs.
    window.openPalette = function() {
      document.getElementById('paletteOverlay').classList.add('open');
      document.getElementById('paletteInput').focus();
      filterPalette();
    }

    // Issue #149 : les outils de développement quittent le menu natif (masqué)
    // pour un bouton de la barre du workspace. Le main process ne les ouvre que
    // pour la fenêtre principale (canal app:toggle-devtools).
    window.toggleDevTools = function() {
      return window.iaoAPI.ipcInvoke('app:toggle-devtools').catch(() => false);
    }

    // Issue #187 : redémarre IAO avec --iao-debug (canal app:relaunch-debug).
    window.relaunchDebug = function() {
      return window.iaoAPI.ipcInvoke('app:relaunch-debug').catch(() => false);
    }

    // Issue #317 : redémarre IAO en mode normal (canal app:relaunch).
    window.relaunchNormal = function() {
      return window.iaoAPI.ipcInvoke('app:relaunch').catch(() => false);
    }

    window.toggleExplorer = function() { document.getElementById('fileExplorer').classList.toggle('collapsed'); }
    window.toggleIdePanel = function() {
      const p = document.getElementById('idePanel');
      p.classList.toggle('collapsed');
      // Monaco paresseux : chargé à la 1re OUVERTURE du panneau éditeur.
      if (!p.classList.contains('collapsed')) ensureMonacoLoaded();
    }

    // Ouvre un service pour un compte donné : réutilise l'onglet existant s'il
    // y en a déjà un pour ce couple (compte, service), sinon en crée un nouveau.
    // Issue #199, lot 3 : tâches programmables. Ouvre (ou réutilise) l'onglet
    // (compte, service) ; `url` : nouvelle session dans un onglet déjà ouvert.
    function ouvrirOngletTache(profil, svcId, url) {
      const acc = accounts.find(a => a.profile === profil);
      if (!acc || !SERVICES.find(s => s.id === svcId)) return false;
      const avant = tabs.find(t => t.accId === acc.id && t.svcId === svcId);
      openService(acc.id, svcId);
      const wv = avant && url && avant.paneEl ? avant.paneEl.querySelector('webview') : null;
      if (wv) {
        // loadURL renvoie une promesse : un échec de chargement (réseau coupé,
        // navigation remplacée) était un rejet non géré -> bandeau d'erreur.
        Promise.resolve().then(() => wv.loadURL(url))
          .catch((e) => dbg('taches', 'nouvelle session impossible', e && e.message));
      }
      return !!tabs.find(t => t.accId === acc.id && t.svcId === svcId);
    }
    // Issue #199, lot 4 : le moteur est partagé entre la minuterie et
    // « Exécuter maintenant » (même chemin d'exécution, même garde — jamais
    // deux plans en même temps, lib/taches-runner.js creerMoteur).
    var moteurTaches = null;
    (function demarrerTachesProgrammables() {
      moteurTaches = window.iaoTachesRunner.creerMoteur({
        invoke: (...args) => ipcRenderer.invoke(...args),
        comptes: () => accounts.map(a => ({ profile: a.profile, services: Array.isArray(a.services) ? a.services : [] })),
        ouvrirOnglet: ouvrirOngletTache,
        attendre: (ms) => new Promise(resolve => setTimeout(resolve, ms))
      });
      setInterval(() => {
        moteurTaches.passage().catch(e => console.warn('[taches] passage en échec :', e && e.message));
      }, window.iaoTachesRunner.INTERVALLE_MS);
    })();

    window.openService = function(accId, svcId) {
      const acc = accounts.find(a => a.id === accId);
      const svc = SERVICES.find(s => s.id === svcId);
      if (!acc || !svc) return;

      activeAccountId = accId;
      // Ordonnanceur (chantier E) : trace l'ouverture manuelle du profil, pour
      // distinguer lastUsedAt (usage manuel) de lastAutomationAt (usage par
      // l'ordonnanceur) — voir migrateOldAccounts().
      if (!acc.automation) acc.automation = { enabled: true, lastUsedAt: 0, lastAutomationAt: 0 };
      acc.automation.lastUsedAt = Date.now();
      // Issue #137 : horodatage par service pour la puce du bouton d'IA.
      if (!acc.automation.lastUsedBySvc || typeof acc.automation.lastUsedBySvc !== 'object') acc.automation.lastUsedBySvc = {};
      acc.automation.lastUsedBySvc[svcId] = acc.automation.lastUsedAt;
      saveAccounts(accounts);
      // Ouvrir un service (carte OU palette Ctrl+K) déplie la carte concernée :
      // confirmation visuelle du compte utilisé même si elle était repliée.
      if (collapsedAccounts.has(accId)) { collapsedAccounts.delete(accId); saveCollapsed(); }
      renderAccounts();

      // Un onglet existe déjà pour ce compte + service : on l'active simplement,
      // pas de nouvelle webview (pas de rechargement, pas de RAM en plus).
      const existing = tabs.find(t => t.accId === accId && t.svcId === svcId);
      if (existing) {
        activateTab(existing.id);
        showToast(_('{service} — {account} déjà ouvert', { service: svc.name, account: acc.name }));
        return;
      }

      const tabId = 'tab_' + (++tabSeq);
      const pane = document.createElement('div');
      pane.className = 'tab-pane';
      pane.id = tabId;
      document.getElementById('tabsContent').appendChild(pane);

      // Barre d'actions de l'onglet (lot 17/09/2026, FEATURES.md P1) :
      // recharger / accueil du service / déconnexion du profil. Délégation
      // d'événements sur #tabsContent (voir plus bas) : data-tab porte l'id
      // interne de l'onglet (généré ci-dessus, jamais une donnée utilisateur),
      // pas besoin d'escapeHtml() dessus — seul le title="" ci-dessous
      // interpole des données de compte/service, donc échappé.
      const toolbar = document.createElement('div');
      toolbar.className = 'tab-toolbar';
      toolbar.innerHTML = `
        <button type="button" class="tab-toolbar__btn" data-action="tab-reload" data-tab="${tabId}" title="${escapeHtml(_('Recharger l\'onglet'))}"><span class="ic" data-icon="arrow-rotate-right"></span></button>
        <button type="button" class="tab-toolbar__btn" data-action="tab-home" data-tab="${tabId}" title="${escapeHtml(_('Revenir à l\'accueil de {service}', { service: svc.name }))}"><span class="ic" data-icon="house"></span></button>
        <button type="button" class="tab-toolbar__btn tab-toolbar__btn--debug" data-action="tab-devtools" data-tab="${tabId}" title="${escapeHtml(_('Outils de développement de l\'onglet (mode debug)'))}"><span class="ic" data-icon="bug"></span></button>
        <button type="button" class="tab-toolbar__btn tab-toolbar__btn--danger" data-action="tab-disconnect" data-tab="${tabId}" title="${escapeHtml(_('Se déconnecter du profil « {profile} »', { profile: acc.name }))}"><span class="ic" data-icon="right-from-bracket"></span></button>
      `;
      pane.appendChild(toolbar);
      hydrateIcons(toolbar);

      // Feedback de chargement : spinner + nom du service/compte le temps que la
      // page charge (avant : panneau noir muet pendant plusieurs secondes).
      // L'animation CSS ne vit que tant que l'overlay existe -> coût nul ensuite.
      const loading = document.createElement('div');
      loading.className = 'tab-loading';
      loading.innerHTML = `<div class="tab-spinner"></div><span>Connexion à ${escapeHtml(svc.name)} — ${escapeHtml(acc.name)}…</span>`;
      pane.appendChild(loading);

      const webview = document.createElement('webview');
      webview.setAttribute('partition', `persist:${acc.profile}`);
      webview.setAttribute('src', svc.url);
      webview.setAttribute('allowpopups', '');
      webview.style.width = '100%';
      webview.style.height = '100%';
      pane.appendChild(webview);

      // Retiré au 1er rendu du service ; filet de 10 s si l'événement ne vient
      // jamais (webview morte) pour ne jamais masquer l'onglet.
      const clearLoading = () => loading.remove();
      webview.addEventListener('dom-ready', clearLoading, { once: true });
      setTimeout(clearLoading, 10000);

      // lastFocusAt initialisé ici (puis maintenu par activateTab) : lot
      // 16/09/2026, rappel visuel « onglet inactif depuis 5 min ».
      tabs.push({ id: tabId, accId, svcId, paneEl: pane, lastFocusAt: Date.now() });
      suiviStats.ouvrir(tabId, acc.profile, svcId); // issue #206
      dbg('onglets', 'ouverture', tabId, 'service=' + svcId, 'compte=' + accId);
      webview.addEventListener('did-fail-load', (ev) => {
        if (ev.isMainFrame) dbg('onglets', 'échec de chargement', tabId, ev.errorCode, ev.errorDescription);
      });
      brancherMesureReponse(webview, tabId, acc.profile, svcId);
      saveOpenTabs(); // lot 18/09/2026 : persistance pour startWithLastSession
      renderTabsBar();
      activateTab(tabId);
      showToast(_('{service} ouvert avec {account}', { service: svc.name, account: acc.name }));
      // Le renderAccounts() plus haut (avant la création de l'onglet) ne
      // voyait pas encore ce nouvel onglet : on re-rend pour que le badge de
      // statut du compte passe bleu « ouvert » immédiatement (lot 16/09/2026).
      renderAccounts();
    }

    // Issue #206 : temps de réponse des messages envoyés à la main. Le script
    // de lib/mesure-reponse.js est injecté à chaque chargement de page (il
    // survit aux navigations internes des applications monopages) ; il range
    // deux horodatages par réponse dans une file de la page, vidée ici toutes
    // les 3 s. Jamais de texte de question ni de réponse.
    function brancherMesureReponse(webview, tabId, profil, svcId) {
      const M = window.iaoMesureReponse;
      if (!M || !M.estMesurable(svcId)) return;
      let pret = false;
      let derniere = 0;
      webview.addEventListener('dom-ready', () => {
        webview.executeJavaScript(M.scriptMesure(svcId)).then((etat) => {
          pret = true;
          dbg('stats', 'mesure des réponses', tabId, svcId, etat);
        }).catch((e) => dbg('stats', 'mesure des réponses indisponible', tabId, e && e.message));
      });
      const minuterie = setInterval(() => {
        if (!webview.isConnected) { clearInterval(minuterie); return; } // onglet fermé
        if (!pret) return;
        webview.executeJavaScript(M.SCRIPT_LECTURE).then((json) => {
          for (const m of M.lireMesures(json, Date.now())) {
            if (m.fin <= derniere) continue; // jamais deux fois la même réponse
            derniere = m.fin;
            dbg('stats', 'réponse mesurée', tabId, svcId, (m.fin - m.debut) + ' ms');
            ipcRenderer.invoke('stats:noter-reponse', { profil, service: svcId, debut: m.debut, fin: m.fin })
              .catch((e) => dbg('stats', 'enregistrement de la réponse refusé', e && e.message));
          }
        }).catch(() => { pret = false; }); // page en cours de rechargement : réinjection au dom-ready
      }, M.INTERVALLE_LECTURE_MS);
    }

    // Issue #338 : premier onglet immuable, hors de tabs[] (ni fermeture, ni
    // déplacement, ni étoile, ni statistiques de compte). Session propre
    // (persist:onglet-fixe) ; main.js bloque toute sortie du site.
    const OF = window.iaoOngletFixe;
    let ongletFixe = null; // { url, paneEl, webview }

    function htmlOngletFixe() {
      if (!ongletFixe) return '';
      const cls = 'tab tab--fixe' + (activeTabId === OF.ID_ONGLET ? ' active' : '');
      return `
          <div class="${cls}" draggable="false" data-action="activate-tab" data-tab="${OF.ID_ONGLET}" title="${escapeHtml(ongletFixe.url)}">
            <span class="ic" data-icon="house"></span>
            <span class="tab__text">
              <span class="tab__label">${escapeHtml(OF.libelle(ongletFixe.url))}</span>
            </span>
          </div>
        `;
    }

    function chargerOngletFixe(url) {
      try {
        ongletFixe.webview.loadURL(url).catch((e) => dbg('onglets', 'onglet fixe : chargement refusé', e && e.message));
      } catch (e) {
        // webview pas encore prête (avant dom-ready) : l'attribut suffit.
        dbg('onglets', 'onglet fixe : chargement par attribut', e && e.message);
        ongletFixe.webview.setAttribute('src', url);
      }
    }

    // Crée, met à jour ou retire l'onglet selon les réglages.
    function appliquerOngletFixe(reglages) {
      const conf = OF.configuration(reglages);
      if (!conf.actif) {
        if (!ongletFixe) return;
        ongletFixe.paneEl.remove();
        ongletFixe = null;
        dbg('onglets', 'onglet fixe retiré');
        if (activeTabId === OF.ID_ONGLET) activateTab(tabs.length ? tabs[0].id : null);
        else renderTabsBar();
        return;
      }
      if (ongletFixe) {
        if (ongletFixe.url !== conf.url) {
          ongletFixe.url = conf.url;
          chargerOngletFixe(conf.url);
          dbg('onglets', 'onglet fixe : nouvelle adresse', OF.libelle(conf.url));
        }
        renderTabsBar();
        return;
      }
      const pane = document.createElement('div');
      pane.className = 'tab-pane';
      pane.id = OF.ID_ONGLET;
      const webview = document.createElement('webview');
      webview.setAttribute('partition', OF.PARTITION);
      webview.setAttribute('src', conf.url);
      webview.setAttribute('allowpopups', ''); // popups jugées par main.js (même site -> dans l'onglet)
      webview.style.width = '100%';
      webview.style.height = '100%';
      webview.addEventListener('did-fail-load', (ev) => {
        if (ev.isMainFrame) dbg('onglets', 'onglet fixe : échec de chargement', ev.errorCode, ev.errorDescription);
      });
      pane.appendChild(webview);
      document.getElementById('tabsContent').appendChild(pane);
      ongletFixe = { url: conf.url, paneEl: pane, webview };
      dbg('onglets', 'onglet fixe ouvert', OF.libelle(conf.url));
      if (!activeTabId) activateTab(OF.ID_ONGLET);
      else renderTabsBar();
    }

    // Clic sur l'onglet : l'affiche et revient à l'adresse définie.
    function revenirOngletFixe() {
      activateTab(OF.ID_ONGLET);
      let actuelle = '';
      try {
        actuelle = ongletFixe.webview.getURL();
      } catch (e) {
        dbg('onglets', 'onglet fixe : adresse courante illisible', e && e.message);
      }
      if (actuelle !== ongletFixe.url) chargerOngletFixe(ongletFixe.url);
    }

    // Réaffiche la barre d'onglets à partir de tabs[] (source de vérité unique).
    // Délégation d'événements (chantier A) : aucun onclick avec donnée interpolée.
    // Issue #324 : logo du service + nom du compte (service en infobulle) ;
    // reflet visuel « inactif
    // depuis 5 min » via isTabIdle(t.lastFocusAt) (lib/activity-status.js).
    function renderTabsBar() {
      // Issue #339 : l'onglet fixe est épinglé dans #tabsBarFixe (hors de la
      // zone défilante : il ne bouge jamais au défilement), les onglets de
      // comptes vivent dans la zone défilante #tabsScrollZone.
      const conteneurFixe = document.getElementById('tabsBarFixe');
      const zone = document.getElementById('tabsScrollZone');
      const now = Date.now();
      conteneurFixe.innerHTML = htmlOngletFixe();
      conteneurFixe.hidden = !ongletFixe;
      zone.innerHTML = tabs.map(t => {
        const acc = accounts.find(a => a.id === t.accId);
        const svc = SERVICES.find(s => s.id === t.svcId);
        if (!acc || !svc) return '';
        const isActive = t.id === activeTabId;
        const isIdle = isTabIdle(t.lastFocusAt, now, 5);
        const starred = isTabStarredById(t.accId, t.svcId);
        const cls = ['tab', isActive ? 'active' : '', isIdle ? 'tab--idle' : '', starred ? 'tab--starred' : ''].filter(Boolean).join(' ');
        const starHtml = starred ? '<span class="tab__star"><span class="ic" data-icon="star"></span></span>' : '';
        return `
          <div class="${cls}" draggable="true" data-action="activate-tab" data-tab="${t.id}" data-acc="${t.accId}" data-svc="${t.svcId}" title="${escapeHtml(acc.name)} — ${escapeHtml(svc.name)}">
            ${svcIcon(svc)}
            ${starHtml}
            <span class="tab__text">
              <span class="tab__label">${escapeHtml(acc.name)}</span>
            </span>
            <span class="tab__close" data-action="close-tab" data-tab="${t.id}" title="Fermer l'onglet"><span class="ic" data-icon="times-circle"></span></span>
          </div>
        `;
      }).join('');
      hydrateIcons(conteneurFixe);
      hydrateIcons(zone);
      majDefilementOnglets();
    }

    // Issue #339 : affiche ou masque les flèches de défilement selon le
    // débordement de la zone. Helpers purs dans lib/defilement-onglets.js ;
    // appelée après chaque rendu, au défilement (écouteur passif ci-dessous)
    // et au redimensionnement de la fenêtre.
    const DO = window.iaoDefilementOnglets;
    function majDefilementOnglets() {
      const zone = document.getElementById('tabsScrollZone');
      const flecheGauche = document.getElementById('tabsArrowLeft');
      const flecheDroite = document.getElementById('tabsArrowRight');
      if (!zone || !flecheGauche || !flecheDroite) return;
      const rtl = getComputedStyle(zone).direction === 'rtl';
      const etat = DO.etatDefilement(zone.scrollLeft, zone.scrollWidth, zone.clientWidth, rtl);
      // La paire de flèches est affichée ensemble dès que la zone déborde
      // (layout stable : la zone garde la même largeur) ; chaque flèche est
      // désactivée à son extrême. En RTL le contenu commence à droite : la
      // flèche gauche mène vers la fin (apres), la droite vers le début.
      flecheGauche.hidden = !etat.debordant;
      flecheDroite.hidden = !etat.debordant;
      flecheGauche.disabled = !(rtl ? etat.apres : etat.avant);
      flecheDroite.disabled = !(rtl ? etat.avant : etat.apres);
    }

    // Affiche l'onglet demandé (et masque les autres) ; les webviews inactives
    // restent en mémoire (juste cachées), comme un navigateur classique — pour
    // libérer la RAM d'un onglet précis, utiliser la fermeture (×).
    // lastFocusAt (lot 16/09/2026) : horodatage LOCAL du dernier passage au
    // premier plan, pour le rappel visuel « inactif depuis 5 min » — ne lit
    // jamais le contenu de la <webview>.
    function activateTab(tabId) {
      dbg('onglets', 'activation', tabId);
      activeTabId = tabId;
      suiviStats.activer(tabId); // issue #206 : temps actif
      const tab = tabs.find(t => t.id === tabId);
      if (tab) tab.lastFocusAt = Date.now();
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
      document.getElementById('tabsEmpty').style.display = tabId ? 'none' : 'flex';
      renderTabsBar();
      // Issue #339 : barre pleine — l'onglet activé (clic, ouverture de
      // compte, fermeture du voisin) est amené dans la partie visible de la
      // zone défilante. L'onglet fixe, épinglé hors de la zone, n'y passe pas.
      const actif = document.querySelector('#tabsScrollZone .tab.active');
      if (actif) actif.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }

    // Ferme un onglet : détruit sa <webview> (le process invité Chromium est
    // libéré, même mécanique que l'ancien « Fermer le panneau 2 »), retire
    // l'onglet de tabs[] et bascule sur un onglet voisin s'il en reste un.
    window.closeTab = function(tabId) {
      const idx = tabs.findIndex(t => t.id === tabId);
      if (idx === -1) return;

      // Confirmation avant fermeture si le réglage est activé (lot 18/09/2026)
      if (currentSettings && currentSettings.confirmTabClose) {
        const tab = tabs[idx];
        const acc = accounts.find(a => a.id === tab.accId);
        const svc = SERVICES.find(s => s.id === tab.svcId);
        const label = (acc ? escapeHtml(acc.name) : '?') + ' — ' + (svc ? escapeHtml(svc.name) : '?');
        showConfirmDialog(
          _('Fermer l\'onglet'),
          _('Fermer l\'onglet « {tab} » ? La session web sera libérée.', { tab: label }),
          function() { _doCloseTab(tabId); }
        );
      } else {
        _doCloseTab(tabId);
      }
    }

    function _doCloseTab(tabId) {
      const idx = tabs.findIndex(t => t.id === tabId);
      if (idx === -1) return;
      const [tab] = tabs.splice(idx, 1);
      dbg('onglets', 'fermeture', tabId, 'restants=' + tabs.length);
      const sessionStats = suiviStats.fermer(tabId); // issue #206
      synchroniserStats(sessionStats ? [sessionStats] : []);
      tab.paneEl.remove(); // innerHTML/remove détruit la <webview> -> libère la mémoire

      if (activeTabId === tabId) {
        const next = tabs[idx] || tabs[idx - 1] || null;
        activateTab(next ? next.id : (ongletFixe ? OF.ID_ONGLET : null)); // #338
      } else {
        renderTabsBar();
      }
      // Le badge de statut du compte (bleu « ouvert ») dépend de tabs[] —
      // re-rendu ici pour repasser rouge/vert dès la fermeture (lot 16/09/2026).
      renderAccounts();
      saveOpenTabs(); // lot 18/09/2026 : persistance pour startWithLastSession
      showToast(_('Onglet fermé (mémoire libérée)'));
    }

    document.getElementById('tabsBar').addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      // Issue #339 : flèche de défilement de la zone d'onglets. data-dir
      // vaut -1 (gauche) ou 1 (droite) — jamais une donnée utilisateur.
      if (el.getAttribute('data-action') === 'tabs-scroll') {
        defilerZoneOnglets(Number(el.getAttribute('data-dir')) || 1);
        return;
      }
      const tabId = el.getAttribute('data-tab');
      if (el.getAttribute('data-action') === 'close-tab') closeTab(tabId);
      else if (ongletFixe && tabId === OF.ID_ONGLET) revenirOngletFixe(); // #338
      else activateTab(tabId);
    });

    // Issue #339 : défilement d'un clic sur une flèche (lissé ; l'état des
    // flèches est rafraîchi par l'événement scroll ci-dessous) et écouteurs
    // qui rafraîchissent les flèches pendant le défilement et au
    // redimensionnement de la fenêtre.
    function defilerZoneOnglets(direction) {
      const zone = document.getElementById('tabsScrollZone');
      if (!zone) return;
      // Direction physique (-1 vers la gauche, +1 vers la droite), identique
      // en LTR et RTL : Chromium y rend scrollLeft négatif vers la fin du
      // contenu, scrollBy(-pas) décale la zone vers la gauche dans les deux cas.
      zone.scrollBy({ left: direction * DO.pasDefilement(zone.clientWidth), behavior: 'smooth' });
    }
    document.getElementById('tabsScrollZone').addEventListener('scroll', () => majDefilementOnglets(), { passive: true });
    // La largeur de la zone change aussi par les séparateurs de l'explorateur
    // et de l'éditeur (et par la fenêtre) : ResizeObserver couvre tous les cas,
    // le repli sur « resize » reste pour un Chromium sans ResizeObserver.
    // Issue #349 : la mise à jour passe par requestAnimationFrame — écrire le
    // DOM (affichage des flèches) dans la boucle de notification de
    // l'observer déclenche l'avertissement Chromium « ResizeObserver loop
    // completed with undelivered notifications », remonté en bandeau par le
    // garde de démarrage. Hors de la frame d'observation, plus de boucle.
    if (typeof ResizeObserver === 'function') {
      let majEnAttente = false;
      new ResizeObserver(() => {
        if (majEnAttente) return;
        majEnAttente = true;
        requestAnimationFrame(() => { majEnAttente = false; majDefilementOnglets(); });
      }).observe(document.getElementById('tabsScrollZone'));
    } else {
      window.addEventListener('resize', () => majDefilementOnglets());
    }

    // Issue #154 : Menu contextuel (clic droit) sur les onglets.
    // Permet d'étoiler / désétoiler un onglet pour le mettre en valeur.
    let ctxMenuEl = null;
    function closeContextMenu() {
      if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; }
    }
    document.addEventListener('click', closeContextMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });

    document.getElementById('tabsBar').addEventListener('contextmenu', (e) => {
      const tabEl = e.target.closest('.tab');
      if (!tabEl) return;
      e.preventDefault();
      closeContextMenu();

      const tabId = tabEl.getAttribute('data-tab');
      const accId = tabEl.getAttribute('data-acc');
      const svcId = tabEl.getAttribute('data-svc');
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;
      const acc = accounts.find(a => a.id === accId);
      const svc = SERVICES.find(s => s.id === svcId);
      if (!acc || !svc) return;
      const starred = isTabStarredById(accId, svcId);

      ctxMenuEl = document.createElement('div');
      ctxMenuEl.className = 'ctx-menu';
      ctxMenuEl.innerHTML = `
        <div class="ctx-menu__item" data-ctx-action="toggle-star">
          <span class="ic" data-icon="star"></span>
          <span>${escapeHtml(starred ? _('Retirer l\'étoile') : _('Étoiler cet onglet'))}</span>
        </div>
        <div class="ctx-menu__sep"></div>
        <div class="ctx-menu__item" data-ctx-action="close-tab">
          <span class="ic" data-icon="times-circle"></span>
          <span>Fermer l'onglet</span>
        </div>
      `;
      document.body.appendChild(ctxMenuEl);
      hydrateIcons(ctxMenuEl);

      // Positionner le menu près du curseur, sans déborder de la fenêtre.
      const rect = ctxMenuEl.getBoundingClientRect();
      let x = e.clientX, y = e.clientY;
      if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
      if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
      ctxMenuEl.style.left = x + 'px';
      ctxMenuEl.style.top = y + 'px';

      ctxMenuEl.addEventListener('click', (ev) => {
        const item = ev.target.closest('[data-ctx-action]');
        if (!item) return;
        const action = item.getAttribute('data-ctx-action');
        closeContextMenu();
        if (action === 'toggle-star') {
          toggleTabStarById(accId, svcId);
          renderTabsBar();
          renderAccounts();
          showToast(isTabStarredById(accId, svcId) ? _('Onglet étoilé') : _('Étoile retirée'));
        } else if (action === 'close-tab') {
          closeTab(tabId);
        }
      });
    });

    // Réorganisation des onglets par glisser-déposer (lot 16/09/2026). HTML5
    // Drag and Drop natif — aucune dépendance ajoutée (invariant 7) — délégué
    // sur #tabsBar comme le clic ci-dessus, pas de listener par onglet à
    // ré-attacher à chaque renderTabsBar(). Ne déplace que des entrées de
    // tabs[] ; aucune interaction avec le contenu des <webview>.
    let dragTabId = null;
    document.getElementById('tabsBar').addEventListener('dragstart', (e) => {
      const el = e.target.closest('.tab');
      if (!el) return;
      dragTabId = el.getAttribute('data-tab');
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('tab--dragging');
    });
    document.getElementById('tabsBar').addEventListener('dragend', (e) => {
      const el = e.target.closest('.tab');
      if (el) el.classList.remove('tab--dragging');
      dragTabId = null;
    });
    document.getElementById('tabsBar').addEventListener('dragover', (e) => {
      if (!dragTabId) return;
      e.preventDefault(); // requis par le navigateur pour autoriser le drop
      e.dataTransfer.dropEffect = 'move';
    });
    document.getElementById('tabsBar').addEventListener('drop', (e) => {
      e.preventDefault();
      const targetEl = e.target.closest('.tab');
      if (!dragTabId || !targetEl) return;
      const targetTabId = targetEl.getAttribute('data-tab');
      if (targetTabId === dragTabId) return;
      const fromIdx = tabs.findIndex(t => t.id === dragTabId);
      const toIdx = tabs.findIndex(t => t.id === targetTabId);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = tabs.splice(fromIdx, 1);
      tabs.splice(toIdx, 0, moved);
      renderTabsBar();
    });

    // Actions sur un onglet ouvert (lot 17/09/2026, FEATURES.md P1) : recharger,
    // revenir à l'accueil du service, se déconnecter du profil. Un seul
    // listener délégué sur #tabsContent (conteneur stable, comme #tabsBar
    // plus haut) plutôt qu'un par bouton de barre d'outils — pas de
    // ré-attachement à chaque ouverture d'onglet.
    function reloadTab(tabId) {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;
      const webview = tab.paneEl.querySelector('webview');
      if (webview) webview.reload();
    }

    // Issue #320 : en mode debug, outils de développement de la page de l'IA
    // (champ qui a le focus, sélecteurs) ; ceux de la fenêtre principale
    // n'inspectent pas l'intérieur des <webview>.
    function toggleTabDevTools(tabId) {
      if (!debugMode) return false;
      return basculerDevToolsOnglet(tabId);
    }

    // Issue #320 (relecture) : outils de développement de la page de l'IA,
    // sans exiger le mode debug (comme ceux de la fenêtre IAO).
    function basculerDevToolsOnglet(tabId) {
      const tab = tabs.find(t => t.id === tabId);
      const webview = tab && tab.paneEl.querySelector('webview');
      if (!webview) return false;
      try {
        if (webview.isDevToolsOpened()) webview.closeDevTools();
        else webview.openDevTools();
        dbg('onglet', 'outils de développement basculés', tab.accId, tab.svcId);
        return true;
      } catch (e) {
        console.warn('[onglet] outils de développement indisponibles :', e.message);
        return false;
      }
    }

    // Issue #320 (relecture) : le bouton « outils de développement » de la barre
    // du haut ouvre un second menu quand un onglet d'IA est actif : la fenêtre
    // IAO ou la page de l'IA (pour voir quel champ a le focus). Sans onglet
    // actif, il bascule directement ceux de la fenêtre IAO, comme avant.
    window.openDevToolsMenu = function() {
      const tab = tabs.find(t => t.id === activeTabId);
      if (!tab || !tab.paneEl.querySelector('webview')) return window.toggleDevTools();
      const svc = SERVICES.find(s => s.id === tab.svcId);
      const acc = accounts.find(a => a.id === tab.accId);
      closeContextMenu();
      ctxMenuEl = document.createElement('div');
      ctxMenuEl.className = 'ctx-menu';
      ctxMenuEl.id = 'devtoolsMenu';
      ctxMenuEl.innerHTML = `
        <div class="ctx-menu__item" data-ctx-action="devtools-iao">
          <span class="ic" data-icon="bug"></span>
          <span>${escapeHtml(_('Fenêtre IAO'))}</span>
        </div>
        <div class="ctx-menu__item" data-ctx-action="devtools-onglet">
          <span class="ic" data-icon="bug"></span>
          <span>${escapeHtml(_('Page de l\'IA : {service} — {compte}', { service: svc ? svc.name : tab.svcId, compte: acc ? acc.name : '' }))}</span>
        </div>
      `;
      document.body.appendChild(ctxMenuEl);
      hydrateIcons(ctxMenuEl);
      const btn = document.querySelector('[data-action="ui-openDevToolsMenu"]');
      const ancre = btn ? btn.getBoundingClientRect() : { left: 0, bottom: 0 };
      const rect = ctxMenuEl.getBoundingClientRect();
      ctxMenuEl.style.left = Math.max(4, Math.min(ancre.left, window.innerWidth - rect.width - 4)) + 'px';
      ctxMenuEl.style.top = (ancre.bottom + 4) + 'px';
      const tabId = tab.id;
      ctxMenuEl.addEventListener('click', (ev) => {
        const item = ev.target.closest('[data-ctx-action]');
        if (!item) return;
        const action = item.getAttribute('data-ctx-action');
        closeContextMenu();
        dbg('onglet', 'menu des outils de développement :', action);
        if (action === 'devtools-iao') window.toggleDevTools();
        else basculerDevToolsOnglet(tabId);
      });
      return 'menu';
    };

    function tabGoHome(tabId) {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;
      const svc = SERVICES.find(s => s.id === tab.svcId);
      const webview = tab.paneEl.querySelector('webview');
      // Issue #185 : loadURL() rejette sa promesse sur ERR_ABORTED (-3) quand le
      // site redirige (page de connexion) ; ce n'est pas une erreur.
      if (webview && svc) {
        webview.loadURL(svc.url).catch((e) => dbg('onglets', 'retour à l\'accueil interrompu', tabId, e && e.message));
      }
    }

    // Déconnexion : purge la partition Electron du compte (cookies + stockage
    // web) -> TOUS les onglets ouverts de ce compte sont concernés, pas
    // seulement celui d'où l'action a été lancée (voir tabsForAccount,
    // lib/tab-actions.js). Destructif : confirmation obligatoire.
    let pendingDisconnectAccId = null;
    window.openDisconnectModal = function(tabId) {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;
      const acc = accounts.find(a => a.id === tab.accId);
      if (!acc) return;
      pendingDisconnectAccId = acc.id;
      const affected = tabsForAccount(tabs, acc.id);
      document.getElementById('disconnectDesc').textContent = buildDisconnectWarning({
        accountName: acc.name,
        profile: acc.profile,
        affectedTabsCount: affected.length
      });
      document.getElementById('disconnectModal').classList.add('open');
    }
    window.closeDisconnectModal = function() {
      pendingDisconnectAccId = null;
      document.getElementById('disconnectModal').classList.remove('open');
    }
    window.confirmDisconnect = async function() {
      const accId = pendingDisconnectAccId;
      closeDisconnectModal();
      const acc = accounts.find(a => a.id === accId);
      if (!acc) return;
      const res = await ipcRenderer.invoke('accounts:disconnect-profile', acc.profile);
      if (!res || !res.ok) { showToast(_('Échec de la déconnexion du profil')); return; }
      // Toutes les webviews de ce compte doivent recharger pour repartir sur
      // une session vierge (les cookies qu'elles avaient en mémoire ne sont
      // pas invalidés tant qu'elles ne rechargent pas).
      tabsForAccount(tabs, acc.id).forEach(t => {
        const webview = t.paneEl.querySelector('webview');
        if (webview) webview.reload();
      });
      showToast(_('Profil « {profile} » déconnecté — session effacée', { profile: acc.name }));
    }
    document.getElementById('tabsContent').addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const tabId = el.getAttribute('data-tab');
      const action = el.getAttribute('data-action');
      if (action === 'tab-reload') reloadTab(tabId);
      else if (action === 'tab-home') tabGoHome(tabId);
      else if (action === 'tab-devtools') toggleTabDevTools(tabId);
      else if (action === 'tab-disconnect') openDisconnectModal(tabId);
    });

    // Fichiers
    // Lot 18/09/2026 : lecture récursive (sous-dossiers) + recherche par nom.
    // La liste plate est conservée dans currentFileList pour le filtrage
    // ultérieur sans re-lire le disque.
    let currentFileList = [];

    window.selectLocalFolder = async function() {
      const folderPath = await ipcRenderer.invoke('select-folder');
      if (!folderPath) return;
      const files = await ipcRenderer.invoke('read-directory-recursive', folderPath);
      currentFileList = files;
      // Affiche le champ de recherche (lot 18/09/2026)
      const searchInput = document.getElementById('fileSearchInput');
      searchInput.style.display = 'block';
      searchInput.value = '';
      renderFileList(currentFileList);
    }

    function renderFileList(files) {
      const list = document.getElementById('fileList');
      if (!files.length) {
        list.innerHTML = '<div class="file-list-empty">' + escapeHtml(_('Aucun fichier trouvé.')) + '</div>';
        return;
      }
      // Le chemin et le nom du fichier viennent du système de fichiers : ils
      // peuvent contenir des guillemets / caractères HTML -> échappés, et passés
      // par data-* (lus par la délégation, chantier A) plutôt que dans un onclick.
      list.innerHTML = files.map(f => {
        const relPath = f.relativePath && f.relativePath !== f.name
          ? `<span class="file-item__relpath">${escapeHtml(f.relativePath)}</span>`
          : '';
        return `
        <div class="file-item" data-path="${escapeHtml(f.path)}" data-name="${escapeHtml(f.name)}">
          <span class="ic file-icon-dim" data-icon="file-code"></span> ${escapeHtml(f.name)}${relPath}
        </div>
      `;
      }).join('');
      hydrateIcons(list);
    }

    window.onFileSearch = function() {
      const query = document.getElementById('fileSearchInput').value;
      renderFileList(filterFiles(currentFileList, query));
    }

    window.loadFileInEditor = async function(filePath, fileName, el) {
      const res = await ipcRenderer.invoke('read-file', filePath);
      // Fichier trop volumineux : main renvoie un sentinel {error:'too_large'}.
      if (res && typeof res === 'object' && res.error === 'too_large') {
        showToast(_('Fichier trop volumineux pour l\'éditeur : {size} Mo (limite : 20 Mo).', { size: Math.round(res.size / 1048576) }), 'error');
        return;
      }
      if (res === null) return; // fichier illisible (permissions, disparu…)
      const content = res;

      currentOpenFilePath = filePath;
      document.getElementById('activeFileName').textContent = fileName;
      
      document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
      el.classList.add('active');

      const ext = fileName.split('.').pop();
      const langMap = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', html: 'html', css: 'css', json: 'json', md: 'markdown' };
      const lang = langMap[ext] || 'plaintext';

      setEditorContent(content, lang);
    }

    // Palette
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openPalette();
      }
      if (e.key === 'Escape') {
        document.getElementById('paletteOverlay').classList.remove('open');
        document.getElementById('accountModal').classList.remove('open');
        document.getElementById('sauvegardeModal').classList.remove('open');
        document.getElementById('deleteModal').classList.remove('open');
        document.getElementById('helpModal').classList.remove('open');
        closeImportConfirm(); // ferme + vide pendingImportContent (pas un simple classList.remove)
        closeDisconnectModal(); // ferme + vide pendingDisconnectAccId (lot 17/09/2026)
      }
      if (e.key === 'Enter' && document.getElementById('paletteOverlay').classList.contains('open')) {
        e.preventDefault();
        const sel = document.querySelector('.palette-item.selected');
        if (sel) sel.click();
      }

      // --- Navigation entre onglets IA ---
      // Ctrl+Tab / Ctrl+Maj+Tab : onglet suivant / précédent (cyclique).
      // Alt+1..9 : aller directement au Nᵉ onglet.
      // Note : quand le focus est DANS une webview, l'événement ne remonte pas
      // jusqu'ici (limite Electron) — cliquer dans l'app hôte rend les raccourcis.
      // Ctrl+W est volontairement évité : c'est l'accélérateur « fermer la
      // fenêtre » du menu Electron par défaut, qui passe avant le renderer.
      if (e.ctrlKey && e.key === 'Tab' && tabs.length > 1) {
        e.preventDefault();
        const i = tabs.findIndex(t => t.id === activeTabId);
        const next = e.shiftKey
          ? (i - 1 + tabs.length) % tabs.length
          : (i + 1) % tabs.length;
        activateTab(tabs[next].id);
      }
      if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key)) {
        const t = tabs[parseInt(e.key, 10) - 1];
        if (t) { e.preventDefault(); activateTab(t.id); }
      }
    });

    window.filterPalette = function() {
      const query = document.getElementById('paletteInput').value.toLowerCase();
      const results = document.getElementById('paletteResults');
      let items = [];
      accounts.forEach(acc => {
        if (acc.name.toLowerCase().includes(query) || acc.email.toLowerCase().includes(query)) {
          acc.services.forEach(sid => {
            const svc = SERVICES.find(s => s.id === sid);
            if (svc) items.push({ acc, svc });
          });
        }
      });
      results.innerHTML = items.map((item, idx) => `
        <div class="palette-item ${idx === 0 ? 'selected' : ''}" data-acc="${escapeHtml(item.acc.id)}" data-svc="${escapeHtml(item.svc.id)}">
          <span>${escapeHtml(item.acc.name)} - ${escapeHtml(item.svc.name)}</span>
        </div>
      `).join('');
      applyDataColors(results); // lot 9 : couleurs dynamiques (avatars)
    }

    // --- Lot 9 (18/09/2026) : applique les couleurs dynamiques via element.style
    //     après innerHTML. Ces propriétés individuelles (.style.background, .style.color)
    //     ne sont PAS bloquées par CSP style-src 'self' (contrairement aux attributs
    //     style="..." qui le sont). Remplace les anciens style="background:${color}".
    function applyDataColors(container) {
      if (!container) return;
      container.querySelectorAll('[data-avatar-color]').forEach(function(el) {
        el.style.background = el.getAttribute('data-avatar-color');
      });
      container.querySelectorAll('[data-dot-color]').forEach(function(el) {
        el.style.background = el.getAttribute('data-dot-color');
      });
      container.querySelectorAll('[data-status-color]').forEach(function(el) {
        el.style.color = el.getAttribute('data-status-color');
      });
    }

    // Modals
    window.openModal = function(accId = null) {
      const modal = document.getElementById('accountModal');
      const title = document.getElementById('modalTitle');
      if (accId) {
        const acc = accounts.find(a => a.id === accId);
        title.textContent = _('Modifier le compte');
        document.getElementById('editId').value = acc.id;
        document.getElementById('inputName').value = acc.name;
        document.getElementById('inputEmail').value = acc.email;
        document.getElementById('inputProfile').value = acc.profile;
      } else {
        title.textContent = _('Ajouter un compte');
        document.getElementById('editId').value = '';
        document.getElementById('inputName').value = '';
        document.getElementById('inputEmail').value = '';
        // Issue #333 : le profil est tiré du nom à l'enregistrement (saveAccount).
        document.getElementById('inputProfile').value = '';
      }
      // Issue #201 : mot de passe de messagerie, masqué ; relu depuis le coffre chiffré.
      const pass = document.getElementById('inputMailPassword');
      pass.value = '';
      afficherMotDePasse(false);
      if (accId) {
        const profil = document.getElementById('inputProfile').value;
        ipcRenderer.invoke('secrets:get', profil).then((v) => {
          if (typeof v === 'string' && document.getElementById('editId').value === accId) pass.value = v;
        }).catch(() => {});
      }
      modal.classList.add('open');
    }

    function afficherMotDePasse(visible) {
      const pass = document.getElementById('inputMailPassword');
      const btn = document.getElementById('btnToggleMailPassword');
      pass.type = visible ? 'text' : 'password';
      const titre = visible ? _('Masquer le mot de passe') : _('Afficher le mot de passe');
      btn.title = titre;
      btn.setAttribute('aria-label', titre);
      btn.innerHTML = '<span class="ic" data-icon="' + (visible ? 'eye-slash' : 'eye') + '"></span>';
      hydrateIcons(btn);
    }
    window.toggleMailPassword = function() {
      afficherMotDePasse(document.getElementById('inputMailPassword').type === 'password');
    };
    function motDePasseAleatoire() {
      return window.iaoComptesSerie.genererMotDePasse((n) => crypto.getRandomValues(new Uint8Array(n)));
    }
    window.generateMailPassword = function() {
      document.getElementById('inputMailPassword').value = motDePasseAleatoire();
      afficherMotDePasse(true);
    };
    // Enregistre le mot de passe dans le coffre ; message si le chiffrement manque.
    async function enregistrerMotDePasse(profil, valeur) {
      const r = await ipcRenderer.invoke('secrets:set', profil, valeur).catch(e => ({ ok: false, erreur: e && e.message }));
      if (r && r.ok) return true;
      showToast(r && r.erreur === 'chiffrement-indisponible'
        ? _('Mot de passe non enregistré : le trousseau du système est indisponible')
        : _('Mot de passe non enregistré'), 'warning');
      return false;
    }
    window.closeModal = function() { document.getElementById('accountModal').classList.remove('open'); }

    // Modale d'aide « Comprendre les IA disponibles ». Liste régénérée à chaque
    // ouverture depuis SERVICES + SERVICE_INFO : un 10e service apparaîtra tout
    // seul (avec son nom au minimum si sa fiche SERVICE_INFO manque encore).
    // Purement informatif : ne touche ni comptes, ni cooldowns, ni webviews.
    window.openHelpModal = function() {
      const list = document.getElementById('helpList');
      // Contenu 100% statique (SERVICES + SERVICE_INFO codés en dur) -> sûr,
      // mais on garde escapeHtml par cohérence avec le reste du rendu.
      list.innerHTML = SERVICES.map(svc => {
        const info = SERVICE_INFO[svc.id];
        return `
          <div class="help-entry">
            <div class="help-entry__name">${svcIcon(svc)}${escapeHtml(svc.name)}</div>
            ${info ? `
              <div class="help-entry__line"><span class="help-entry__label">${escapeHtml(_('C\'est quoi ?'))}</span> ${escapeHtml(_(info.what))}</div>
              <div class="help-entry__line"><span class="help-entry__label">${escapeHtml(_('Quand l\'utiliser ?'))}</span> ${escapeHtml(_(info.when))}</div>
            ` : `<div class="help-entry__line help-entry__line--muted">${escapeHtml(_('Description à venir.'))}</div>`}
          </div>
        `;
      }).join('');
      document.getElementById('helpModal').classList.add('open');
    }
    window.closeHelpModal = function() { document.getElementById('helpModal').classList.remove('open'); }
    // Fermeture par clic en dehors de la boîte (sur le fond assombri).
    document.getElementById('helpModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeHelpModal();
    });

    // --- Issue #42 : Menu de sélection des services « à portée de main » ---
    let pendingServices = null;

    window.openServicesModal = function() {
      const list = document.getElementById('servicesList');
      const activeIds = getActiveServices();
      pendingServices = new Set(activeIds);

      list.innerHTML = SERVICES.map(svc => {
        const checked = activeIds.includes(svc.id) ? 'checked' : '';
        return `
          <div class="help-entry">
            <div class="help-entry__name">
              <label class="service-select-item">
                <input type="checkbox" data-svc-id="${escapeHtml(svc.id)}" ${checked}>
                ${svcIcon(svc)}
                ${escapeHtml(svc.name)}
              </label>
            </div>
          </div>
        `;
      }).join('');

      // Délégation : mettre à jour pendingServices + compter
      list.onchange = (e) => {
        const cb = e.target;
        if (cb && cb.dataset && cb.dataset.svcId) {
          if (cb.checked) {
            pendingServices.add(cb.dataset.svcId);
          } else {
            pendingServices.delete(cb.dataset.svcId);
          }
        }
      };

      document.getElementById('servicesModal').classList.add('open');
    };
    window.closeServicesModal = function() { document.getElementById('servicesModal').classList.remove('open'); pendingServices = null; };
    window.saveServicesModal = function() {
      if (!pendingServices) return closeServicesModal();
      const ids = Array.from(pendingServices);
      if (ids.length === 0) { showToast(_('Sélectionnez au moins 1 service'), 'error'); return; }
      saveActiveServices(ids);
      // Issue #319 : les cartes reprennent tout de suite la nouvelle sélection
      // (avant, rien n'était appliqué aux comptes avant le redémarrage).
      const modifies = window.iaoServicesActifs.alignerTous(accounts, getActiveServices());
      if (modifies > 0) saveAccounts(accounts);
      dbg('services', 'sélection enregistrée', ids.length, 'services,', modifies, 'compte(s) alignés');
      closeServicesModal();
      // Mettre à jour ALL_SERVICES et re-rendre les comptes
      showToast(_('IA à portée de main : {count}', { count: ids.length }));
      // Recharger pour appliquer les changements partout
      renderAccounts();
    };
    document.getElementById('servicesModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeServicesModal();
    });

    // Suppression de compte
    window.openDeleteModal = function(accId) {
      const acc = accounts.find(a => a.id === accId);
      if (!acc) return;
      document.getElementById('deleteId').value = accId;
      document.getElementById('deleteDesc').textContent =
        _('Supprimer « {name} » ({email}) ? La session restera stockée sur le disque, mais le compte disparaîtra de la liste.', { name: acc.name, email: acc.email });
      document.getElementById('deleteModal').classList.add('open');
    }
    window.closeDeleteModal = function() { document.getElementById('deleteModal').classList.remove('open'); }

    // --- Export / import JSON des comptes (branchement UI, cf. FEATURES.md P1) ---
    // Les fonctions pures exportAccountsJSON()/importAccountsJSON(text) existaient
    // déjà (chantier C) ; ce lot n'ajoute que la sélection de fichier (côté main.js,
    // IPC 'accounts:export'/'accounts:import' — dialog.showSaveDialog/showOpenDialog,
    // seul process avec accès au système de fichiers) et la confirmation d'écrasement.
    window.exportAccountsToFile = async function() {
      try {
        const res = await ipcRenderer.invoke('accounts:export', exportAccountsJSON());
        if (res && res.canceled) return; // l'utilisateur a fermé la boîte de dialogue
        if (res && res.error) { showToast(_('Échec de l\'export (écriture impossible)'), 'error'); return; }
        showToast(_n('{count} compte exporté', '{count} comptes exportés', accounts.length, { count: accounts.length }));
      } catch (e) {
        console.error('[import-export] export impossible :', e);
        showToast(_('Export impossible'), 'error');
      }
    }

    // Contenu du fichier choisi, en attente de confirmation (voir confirmImport ci-dessous).
    // Remis à null après usage ou annulation : ne doit jamais survivre à la modale.
    let pendingImportContent = null;

    window.importAccountsFromFile = async function() {
      try {
        const res = await ipcRenderer.invoke('accounts:import');
        if (res && res.canceled) return;
        if (res && res.error) { showToast(_('Échec de la lecture du fichier'), 'error'); return; }
        let parsed;
        try { parsed = JSON.parse(res.content); }
        catch (e) { showToast(_('Fichier JSON invalide'), 'error'); return; }
        if (!Array.isArray(parsed)) { showToast(_('Format invalide : un tableau de comptes est attendu.'), 'error'); return; }
        pendingImportContent = res.content;
        document.getElementById('importConfirmDesc').textContent =
          _('Le fichier contient {count} compte(s). L\'import REMPLACE entièrement la liste actuelle ({current} compte(s)) — cette action écrase les comptes existants, pas leurs sessions (cookies) déjà enregistrées sur le disque. Continuer ?', { count: parsed.length, current: accounts.length });
        document.getElementById('importConfirmModal').classList.add('open');
      } catch (e) {
        console.error('[import-export] import impossible :', e);
        showToast(_('Import impossible'), 'error');
      }
    }
    window.closeImportConfirm = function() {
      pendingImportContent = null;
      document.getElementById('importConfirmModal').classList.remove('open');
    }
    // Fermeture par clic en dehors de la boîte (sur le fond assombri), comme #helpModal.
    document.getElementById('importConfirmModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeImportConfirm();
    });
    window.confirmImport = function() {
      const content = pendingImportContent;
      closeImportConfirm(); // remet pendingImportContent à null avant tout, y compris en cas d'erreur
      if (!content) return;
      try {
        const count = importAccountsJSON(content); // saveAccounts() + renderAccounts() déjà inclus
        showToast(_n('{count} compte importé', '{count} comptes importés', count, { count }));
      } catch (e) {
        console.error('[import-export] échec de l\'import :', e);
        showToast(_('Échec de l\'import : {error}', { error: e.message || e }), 'error');
      }
    }
    window.confirmDelete = function() {
      const id = document.getElementById('deleteId').value;
      accounts = accounts.filter(a => a.id !== id);
      if (activeAccountId === id) activeAccountId = null;
      saveCollapsed();        // purge l'état de repli du compte supprimé
      pruneAccountOrder(accounts); // issue #6 : nettoie l'ordre des comptes supprimés
      saveAccounts(accounts); // écrit + backup de la génération précédente (chantier C)
      renderAccounts();
      closeDeleteModal();
      showToast(_('Compte supprimé'));
    }

    window.saveAccount = async function() {
      const id = document.getElementById('editId').value;
      const name = document.getElementById('inputName').value.trim();
      const email = document.getElementById('inputEmail').value.trim();
      if (!name || !email) return showToast(_('Remplissez tous les champs'), 'error');
      // Issue #333 : un compte existant garde son profil (ses sessions y sont) ;
      // un nouveau compte prend un profil tiré de son nom, unique.
      const profile = id
        ? document.getElementById('inputProfile').value.trim()
        : window.iaoProfilCompte.profilDepuisNom(name, accounts.map(a => a.profile));

      // Unicité du profil (chantier audit 3.1) : deux comptes partageant le même
      // `profile` utiliseraient la MÊME partition Electron (persist:<profile>) →
      // cookies/sessions mêlés entre comptes. On refuse la collision.
      if (accounts.some(a => a.id !== id && a.profile === profile)) {
        return showToast(_('Ce profil est déjà utilisé par un autre compte (les sessions seraient partagées).'), 'error');
      }

      if (id) {
        const acc = accounts.find(a => a.id === id);
        if (!acc) return; // garde : id obsolète
        Object.assign(acc, { name, email, profile });
        showToast(_('Compte mis à jour'));
      } else {
        accounts.push({
          id: 'acc_' + Date.now(), name, email, profile,
          color: COLORS[accounts.length % COLORS.length],
          // Issue #319 : la sélection active, pas tout le catalogue.
          services: getActiveServices(),
          cooldowns: Object.fromEntries(getActiveServices().map(sid => [sid, 0])),
          automation: { enabled: true, lastUsedAt: 0, lastAutomationAt: 0 }
        });
        showToast(_('Compte ajouté'));
      }
      saveAccounts(accounts); // écrit + backup de la génération précédente (chantier C)
      renderAccounts();
      const motDePasse = document.getElementById('inputMailPassword').value;
      // Le mot de passe doit être au coffre avant l'appel à l'API (le
      // process principal y lit le mot de passe du compte) : on attend.
      if (motDePasse) await enregistrerMotDePasse(profile, motDePasse);
      closeModal();
      // Issue #357 : si le domaine de l'adresse correspond à celui des
      // réglages, le compte de messagerie est créé via l'API (ou son mot de
      // passe changé quand un mot de passe est ajouté). Retour en
      // notification ; la connexion au webmail est tentée en arrière-plan.
      if (apiMessageriePrete(email) && (!id || motDePasse)) tenterCreationMessagerie(email, profile);
    }

    // Issue #357 : conditions pour parler à l'API de messagerie — réglages
    // chargés, URL renseignée, domaine de l'adresse == domaine des réglages.
    function apiMessageriePrete(email) {
      return !!(currentSettings && currentSettings.mailApiUrl && window.iaoMailApi &&
        window.iaoMailApi.domaineCorrespond(email, currentSettings.mailDomain || ''));
    }
    // Traduit le retour de « mail-api:creer » en notification (haut à droite).
    function toastResultatMessagerie(r, email) {
      if (!r || typeof r !== 'object' || r.ok === undefined) return;
      if (r.ok && r.statut === 'cree') {
        showToast(r.enregistre
          ? _('Compte de messagerie créé : {email} — mot de passe généré, enregistré dans le coffre', { email })
          : _('Compte de messagerie créé : {email}', { email }), 'success');
        return;
      }
      if (r.ok && r.statut === 'existant') { showToast(_('Le compte de messagerie {email} existe déjà', { email }), 'warning'); return; }
      if (r.ok && r.statut === 'modifie') { showToast(_('Mot de passe de messagerie mis à jour pour {email}', { email }), 'success'); return; }
      if (!r.ok && r.statut === 'non-config') { showToast(_("Clé de l'API de messagerie non renseignée dans les réglages"), 'warning'); return; }
      if (!r.ok && r.statut === 'cle') { showToast(_("Clé de l'API de messagerie refusée"), 'warning'); return; }
      if (!r.ok && r.statut === 'invalide') { showToast(_('Adresse refusée par l\'API de messagerie'), 'error'); return; }
      if (!r.ok && r.statut === 'stockage') { showToast(_('Stockage de l\'API de messagerie indisponible'), 'error'); return; }
      if (!r.ok && r.statut === 'absent') { showToast(_('Compte de messagerie absent sur le serveur'), 'error'); return; }
      if (!r.ok) showToast(_('API de messagerie injoignable'), 'error');
    }
    async function tenterCreationMessagerie(email, profile) {
      try {
        const r = await ipcRenderer.invoke('mail-api:creer', { email, profil: profile });
        toastResultatMessagerie(r, email);
      } catch (_) { /* IPC muet : pas de notification parasite */ }
    }

    // Issue #201 : création de comptes en série (<préfixe><numéro>@<domaine>).
    window.openSerieModal = function() {
      const s = currentSettings || {};
      if (!s.mailDomain) {
        showToast(_('Renseignez d\'abord le domaine des adresses e-mail dans les réglages'), 'warning');
        return openSettingsModal();
      }
      const suivant = window.iaoComptesSerie.plusGrandNumero(accounts) + 1;
      document.getElementById('serieDesc').textContent = _('Premier compte : {nom}, {email}. Un mot de passe de messagerie aléatoire est généré pour chacun.', {
        nom: String(suivant), email: (s.mailPrefix || '') + suivant + '@' + s.mailDomain
      });
      document.getElementById('serieNombre').value = '1';
      document.getElementById('serieModal').classList.add('open');
    };
    window.closeSerieModal = function() { document.getElementById('serieModal').classList.remove('open'); };
    window.createSerie = async function() {
      const s = currentSettings || {};
      const r = window.iaoComptesSerie.comptesEnSerie({
        comptes: accounts, nombre: Number(document.getElementById('serieNombre').value),
        prefixe: s.mailPrefix, domaine: s.mailDomain, services: getActiveServices(), maintenant: Date.now()
      });
      if (!r.ok) {
        return showToast(r.erreur === 'nombre'
          ? _('Nombre de comptes : de 1 à {max}', { max: window.iaoComptesSerie.SERIE_MAX })
          : _('Renseignez d\'abord le domaine des adresses e-mail dans les réglages'), 'error');
      }
      r.comptes.forEach((c) => {
        accounts.push(Object.assign(c, {
          color: COLORS[accounts.length % COLORS.length],
          cooldowns: Object.fromEntries(c.services.map(sid => [sid, 0])),
          automation: { enabled: true, lastUsedAt: 0, lastAutomationAt: 0 }
        }));
      });
      saveAccounts(accounts);
      renderAccounts();
      closeSerieModal();
      let chiffres = 0;
      for (const c of r.comptes) {
        if (await enregistrerMotDePasse(c.profile, motDePasseAleatoire())) chiffres++;
        else break; // trousseau indisponible : inutile d'insister
      }
      showToast(_('{comptes}, {motsDePasse}', {
        comptes: _n('{n} compte créé', '{n} comptes créés', r.comptes.length, { n: r.comptes.length }),
        motsDePasse: _n('{m} mot de passe enregistré', '{m} mots de passe enregistrés', chiffres, { m: chiffres })
      }));
      // Issue #357 : création du lot sur le serveur de messagerie quand le
      // domaine des réglages correspond et que l'API est configurée. Retour
      // en notification ; les connexions au webmail sont tentées en
      // arrière-plan (espacées) par le process principal.
      if (r.comptes.length && apiMessageriePrete(r.comptes[0].email)) {
        try {
          const res = await ipcRenderer.invoke('mail-api:creer-lot',
            r.comptes.map(c => ({ email: c.email, profil: c.profile })));
          toastResultatLotMessagerie(res);
        } catch (_) { /* IPC muet : pas de notification parasite */ }
      }
    };

    // Traduit le retour de « mail-api:creer-lot » en notification.
    function toastResultatLotMessagerie(r) {
      if (!r || typeof r !== 'object' || r.ok === undefined) return;
      if (r.ok && r.statut === 'cree') {
        showToast(_n('{n} compte de messagerie créé', '{n} comptes de messagerie créés',
          r.nombre || 0, { n: r.nombre || 0 }), 'success');
        return;
      }
      if (r.ok && r.statut === 'melange') {
        showToast(_('{crees} comptes de messagerie créés, {existants} existants, {echecs} en échec', {
          crees: r.crees || 0, existants: r.existants || 0, echecs: r.echecs || 0
        }), 'warning');
        return;
      }
      // Erreurs : mêmes libellés que la création unitaire.
      toastResultatMessagerie(r, '');
    }

    // Issue #201 : webmail (URL des réglages, ouverte par le process principal) ;
    // l'adresse du compte est copiée. Issue #310 : le process principal ouvre le
    // webmail dans la partition du compte et s'y connecte avec l'adresse et le
    // mot de passe du coffre (le renderer ne transmet que profil et adresse).
    function openWebmail(accId) {
      copyAccountEmail(accId);
      const acc = accounts.find(a => a.id === accId);
      const compte = acc ? { profil: acc.profile, email: acc.email || '' } : null;
      ipcRenderer.invoke('app:open-webmail', compte).then((ok) => {
        if (ok !== true) showToast(_('Adresse du webmail non configurée dans les réglages'), 'warning');
      }).catch(() => showToast(_('Ouverture du webmail impossible'), 'error'));
    }

    // Issue #138 : clic sur l'e-mail d'un compte -> presse-papiers + toast.
    // La délégation résout data-action="copy-email" avant le toggle-collapse
    // du header (closest()), donc le clic ne replie pas la carte.
    function copyAccountEmail(accId) {
      const acc = accounts.find(a => a.id === accId);
      if (!acc || !acc.email) return;
      copyText(acc.email, { clipboard: navigator.clipboard, document }).then(ok => {
        showToast(ok ? _('E-mail copié : {email}', { email: acc.email }) : _('Copie impossible dans le presse-papiers'), ok ? 'success' : 'error');
      });
    }

    // Issue #310 (relecture) : codes et liens de connexion relevés par le
    // process principal dans la fenêtre du webmail d'un compte (lib/webmail-codes).
    // Affichés dans la barre de l'onglet du service pour ce compte (à côté de
    // recharger / accueil / déconnexion) ; le lien est ouvert dans l'onglet
    // après 3 s, sauf « Annuler ». Le code reste affiché 5 minutes (sa durée de vie).
    const CONNEXION_DELAI_S = 3;
    const CONNEXION_AFFICHAGE_MS = 5 * 60 * 1000;
    function afficherConnexionWebmail(ev) {
      if (!ev || typeof ev !== 'object') return;
      const acc = accounts.find(a => a.profile === ev.profil);
      const svc = SERVICES.find(s => s.id === ev.service);
      if (!acc || !svc) { dbg('webmail', 'connexion reçue sans compte ou service connu', ev.profil, ev.service); return; }
      const code = /^\d{6}$/.test(ev.code || '') ? ev.code : '';
      const lien = typeof ev.lien === 'string' && ev.lien.startsWith('https://') ? ev.lien : '';
      let tab = tabs.find(t => t.accId === acc.id && t.svcId === svc.id);
      if (!tab && lien) {
        // Onglet fermé : on l'ouvre pour y suivre le lien.
        window.openService(acc.id, svc.id);
        tab = tabs.find(t => t.accId === acc.id && t.svcId === svc.id);
      }
      dbg('webmail', 'connexion reçue', acc.profile, svc.id, code ? 'code' : 'sans code', lien ? 'lien' : 'sans lien', tab ? tab.id : 'sans onglet');
      if (code) showToast(_('Code {service} pour {account} : {code}', { service: svc.name, account: acc.name, code }));
      if (!tab) return;
      const toolbar = tab.paneEl.querySelector('.tab-toolbar');
      if (!toolbar) return;
      const ancien = toolbar.querySelector('.tab-code');
      if (ancien) { clearInterval(Number(ancien.dataset.minuterie)); ancien.remove(); }
      const bandeau = document.createElement('div');
      bandeau.className = 'tab-code';
      bandeau.setAttribute('role', 'status');
      bandeau.innerHTML = `
        ${code ? `<span class="tab-code__libelle">${escapeHtml(_('Code reçu par mail :'))}</span><strong class="tab-code__valeur">${escapeHtml(code)}</strong>
        <button type="button" class="tab-code__btn" data-code-action="copier">${escapeHtml(_('Copier'))}</button>` : ''}
        ${lien ? `<span class="tab-code__etat"></span>
        <button type="button" class="tab-code__btn" data-code-action="annuler">${escapeHtml(_('Annuler'))}</button>
        <button type="button" class="tab-code__btn" data-code-action="ouvrir" hidden>${escapeHtml(_('Ouvrir le lien de connexion'))}</button>` : ''}
        <button type="button" class="tab-code__btn tab-code__fermer" data-code-action="fermer" title="${escapeHtml(_('Fermer'))}">×</button>`;
      toolbar.insertBefore(bandeau, toolbar.firstChild);
      const etat = bandeau.querySelector('.tab-code__etat');
      const btnAnnuler = bandeau.querySelector('[data-code-action="annuler"]');
      const btnOuvrir = bandeau.querySelector('[data-code-action="ouvrir"]');
      let reste = CONNEXION_DELAI_S;
      let minuterie = 0;
      const ouvrirLien = () => {
        clearInterval(minuterie);
        const webview = tab.paneEl.querySelector('webview');
        if (webview) {
          webview.loadURL(lien).catch((e) => dbg('webmail', 'ouverture du lien interrompue', tab.id, e && e.message));
          dbg('webmail', 'lien de connexion ouvert dans l\'onglet', tab.id);
        }
        if (etat) etat.textContent = _('Lien de connexion ouvert');
        if (btnAnnuler) btnAnnuler.hidden = true;
        if (btnOuvrir) btnOuvrir.hidden = true;
      };
      if (lien) {
        etat.textContent = _('Connexion automatique dans {seconds} s', { seconds: reste });
        minuterie = setInterval(() => {
          reste -= 1;
          if (reste <= 0) ouvrirLien();
          else etat.textContent = _('Connexion automatique dans {seconds} s', { seconds: reste });
        }, 1000);
        bandeau.dataset.minuterie = String(minuterie);
      }
      const fin = setTimeout(() => { clearInterval(minuterie); bandeau.remove(); }, CONNEXION_AFFICHAGE_MS);
      bandeau.addEventListener('click', (e) => {
        const b = e.target.closest('[data-code-action]');
        if (!b) return;
        const action = b.getAttribute('data-code-action');
        if (action === 'copier') {
          copyText(code, { clipboard: navigator.clipboard, document }).then(ok => {
            showToast(ok ? _('Code copié') : _('Copie impossible dans le presse-papiers'), ok ? 'success' : 'error');
          });
        } else if (action === 'annuler') {
          clearInterval(minuterie);
          etat.textContent = _('Connexion automatique annulée');
          btnAnnuler.hidden = true;
          btnOuvrir.hidden = false;
        } else if (action === 'ouvrir') {
          ouvrirLien();
        } else {
          clearInterval(minuterie);
          clearTimeout(fin);
          bandeau.remove();
        }
      });
    }
    window.afficherConnexionWebmail = afficherConnexionWebmail;

    // Attente longue (canal webmail:attendre) : le process principal répond dès
    // qu'un mail de connexion est relevé, ou par une liste vide au bout de 25 s.
    async function boucleConnexionsWebmail() {
      for (;;) {
        let lot = [];
        try {
          lot = await ipcRenderer.invoke('webmail:attendre');
        } catch (e) {
          console.warn('[webmail] attente des mails de connexion interrompue :', e && e.message);
          await new Promise(r => setTimeout(r, 5000));
        }
        for (const ev of Array.isArray(lot) ? lot : []) {
          try { afficherConnexionWebmail(ev); } catch (e) { console.error('[webmail] affichage du code impossible :', e); }
        }
      }
    }
    boucleConnexionsWebmail();

    function showToast(msg, type = 'success') {
      const toast = document.createElement('div');
      toast.className = `toast`;
      toast.style.borderLeftColor = type === 'error' ? 'var(--danger)' : type === 'warning' ? 'var(--warning)' : 'var(--accent)';
      const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : 'exclamation-triangle';
      // msg peut contenir une donnée utilisateur (ex. nom de compte) -> échappé (chantier A).
      toast.innerHTML = `<span class="ic" data-icon="${iconName}"></span> ${escapeHtml(msg)}`;
      hydrateIcons(toast);
      document.getElementById('toastContainer').appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)'; setTimeout(() => toast.remove(), 300); }, 3000);
    }

    // Modale de confirmation réutilisable (lot 18/09/2026 — réglage « Confirmer
    // avant de fermer un onglet »). Pas de onclick inline : délégation d'événements
    // (invariant 5) + escapeHtml sur le message (invariant 1).
    var _confirmCallback = null;
    function showConfirmDialog(title, message, onConfirm) {
      _confirmCallback = onConfirm;
      var modal = document.getElementById('confirmModal');
      modal.querySelector('.confirm-title').textContent = title;
      modal.querySelector('.confirm-msg').textContent = message;
      modal.classList.add('open');
    }
    function closeConfirmModal() {
      _confirmCallback = null;
      document.getElementById('confirmModal').classList.remove('open');
    }
    document.getElementById('confirmModal').addEventListener('click', function(e) {
      if (e.target === e.currentTarget) closeConfirmModal();
    });
    document.getElementById('confirmModalYes').addEventListener('click', function() {
      if (_confirmCallback) { _confirmCallback(); }
      closeConfirmModal();
    });
    document.getElementById('confirmModalNo').addEventListener('click', closeConfirmModal);

    // Colonnes redimensionnables à la souris
    function setupResizers() {
      const overlay = document.getElementById('resizeOverlay');
      const idePanel = document.getElementById('idePanel');
      const fileExplorer = document.getElementById('fileExplorer');

      // On lève les limites CSS qui empêcheraient d'agrandir/réduire librement.
      idePanel.style.maxWidth = 'none';
      idePanel.style.minWidth = '0';
      fileExplorer.style.maxWidth = 'none';
      fileExplorer.style.minWidth = '0';

      // Restaure les largeurs mémorisées (via flex-basis = taille exacte).
      // Lecture défensive (chantier C) : une valeur absente/illisible ne doit
      // jamais empêcher l'app de démarrer — on retombe simplement sur le défaut.
      try {
        const savedIde = prefStore.getItem('ide_w');
        if (savedIde) idePanel.style.flex = '0 0 ' + savedIde;
        const savedExp = prefStore.getItem('explorer_w');
        if (savedExp) fileExplorer.style.flex = '0 0 ' + savedExp;
      } catch (e) { console.warn('[storage] largeurs de colonnes ignorées :', e); }

      function makeResizer(resizer, opts) {
        if (!resizer) return;
        resizer.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startSize = opts.getStart();
          // Issue #51 : en rtl, les panneaux s'ouvrent depuis la droite ; tirer
          // vers la gauche élargit donc le panneau (sens du glisser inversé).
          const sens = getComputedStyle(document.documentElement).direction === 'rtl' ? -1 : 1;
          resizer.classList.add('dragging');
          overlay.classList.add('active');
          document.body.style.userSelect = 'none';

          function move(ev) {
            const max = typeof opts.max === 'function' ? opts.max() : opts.max;
            let next = startSize + sens * (ev.clientX - startX);
            next = Math.max(opts.min, Math.min(max, next));
            opts.apply(next);
          }
          function up() {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            resizer.classList.remove('dragging');
            overlay.classList.remove('active');
            document.body.style.userSelect = '';
            if (opts.onEnd) opts.onEnd();
          }
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        });
      }

      // Éditeur (largeur du panneau IDE) ↔ panneaux IA
      makeResizer(document.getElementById('resizerIde'), {
        el: idePanel,
        getStart: () => idePanel.getBoundingClientRect().width,
        min: 260,
        max: () => document.querySelector('.workspace-body').getBoundingClientRect().width - 320,
        apply: (w) => { idePanel.style.flex = '0 0 ' + w + 'px'; },
        onEnd: () => { try { prefStore.setItem('ide_w', Math.round(idePanel.getBoundingClientRect().width) + 'px'); } catch (e) {} }
      });

      // Explorateur de fichiers ↔ éditeur
      makeResizer(document.getElementById('resizerExplorer'), {
        el: fileExplorer,
        getStart: () => fileExplorer.getBoundingClientRect().width,
        min: 120,
        max: () => idePanel.getBoundingClientRect().width - 160,
        apply: (w) => { fileExplorer.style.flex = '0 0 ' + w + 'px'; },
        onEnd: () => { try { prefStore.setItem('explorer_w', Math.round(fileExplorer.getBoundingClientRect().width) + 'px'); } catch (e) {} }
      });
    }
    setupResizers();

    // --- Délégation d'événements (chantier A) ---
    // Les listes rendues dynamiquement (comptes, palette, fichiers) n'ont plus
    // d'attributs onclick. On écoute UN seul clic sur chaque conteneur STABLE et
    // on lit l'action + les identifiants dans les data-*. Le vecteur d'injection
    // (valeur utilisateur interpolée dans un onclick) disparaît complètement.
    document.getElementById('accountsList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const accId = btn.getAttribute('data-acc');
      const svcId = btn.getAttribute('data-svc');
      switch (btn.getAttribute('data-action')) {
        case 'add':             openModal(); break;
        case 'open-service':    openService(accId, svcId); break;
        case 'edit':            openModal(accId); break;
        case 'delete':          openDeleteModal(accId); break;
        case 'toggle-collapse': toggleCardCollapse(accId); break;
        case 'copy-email':      copyAccountEmail(accId); break;
        case 'open-webmail':    openWebmail(accId); break;
      }
    });

    // --- Issue #6 : drag-and-drop pour réorganiser les comptes ------------
    // Délégation d'événements sur le conteneur (même pattern que le clic).
    // HTML5 Drag and Drop API natif — aucune dépendance externe.
    let draggedAccId = null;
    let draggedOverId = null;

    const accountsListEl = document.getElementById('accountsList');

    accountsListEl.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.account-card');
      if (!card) return;
      draggedAccId = card.getAttribute('data-acc');
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // dataTransfer.setData requis par Firefox pour initier le drag
      try { e.dataTransfer.setData('text/plain', draggedAccId); } catch (_) { /* ignore */ }
    });

    accountsListEl.addEventListener('dragend', (e) => {
      const card = e.target.closest('.account-card');
      if (card) card.classList.remove('dragging');
      // Nettoie les indicateurs visuels
      accountsListEl.querySelectorAll('.account-card.drag-over').forEach(c => c.classList.remove('drag-over'));
      draggedAccId = null;
      draggedOverId = null;
    });

    accountsListEl.addEventListener('dragover', (e) => {
      if (!draggedAccId) return;
      e.preventDefault(); // autorise le drop
      e.dataTransfer.dropEffect = 'move';
      const card = e.target.closest('.account-card');
      if (!card || card.getAttribute('data-acc') === draggedAccId) return;
      const overId = card.getAttribute('data-acc');
      if (draggedOverId !== overId) {
        // Nettoie l'ancien indicateur
        if (draggedOverId) {
          const old = accountsListEl.querySelector('.account-card[data-acc="' + CSS.escape(draggedOverId) + '"]');
          if (old) old.classList.remove('drag-over');
        }
        card.classList.add('drag-over');
        draggedOverId = overId;
      }
    });

    accountsListEl.addEventListener('dragleave', (e) => {
      // Nettoie seulement si on quitte vraiment le conteneur
      if (!accountsListEl.contains(e.relatedTarget)) {
        accountsListEl.querySelectorAll('.account-card.drag-over').forEach(c => c.classList.remove('drag-over'));
        draggedOverId = null;
      }
    });

    accountsListEl.addEventListener('drop', (e) => {
      if (!draggedAccId || !draggedOverId || draggedAccId === draggedOverId) return;
      e.preventDefault();

      // Reconstruit l'ordre : prend l'ordre actuel, déplace draggedAccId
      // à la position de draggedOverId.
      const currentOrder = sortAccountsByOrder(accounts).map(a => a.id);
      const fromIdx = currentOrder.indexOf(draggedAccId);
      const toIdx = currentOrder.indexOf(draggedOverId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

      currentOrder.splice(fromIdx, 1);
      currentOrder.splice(toIdx, 0, draggedAccId);
      saveAccountOrder(currentOrder);
      renderAccounts();
    });

    document.getElementById('paletteResults').addEventListener('click', (e) => {
      const item = e.target.closest('[data-acc]');
      if (!item) return;
      openService(item.getAttribute('data-acc'), item.getAttribute('data-svc'));
      document.getElementById('paletteOverlay').classList.remove('open');
    });

    document.getElementById('fileList').addEventListener('click', (e) => {
      const item = e.target.closest('.file-item');
      if (!item) return;
      loadFileInEditor(item.getAttribute('data-path'), item.getAttribute('data-name'), item);
    });

    // Lot 16/09/2026 : rafraîchissement ciblé par textContent (ne touche que
    // la puce + son title, pas de renderAccounts() complet).
    // Issue #137 : une puce par bouton d'IA (compte, service).
    function refreshAccountStatusDots() {
      const now = Date.now();
      document.querySelectorAll('#accountsList .svc-btn[data-action="open-service"]').forEach(btn => {
        const acc = accounts.find(a => a.id === btn.getAttribute('data-acc'));
        const dot = btn.querySelector('.status-dot');
        if (!acc || !dot) return;
        const status = getServiceActivityStatus({
          tabs, accId: acc.id, svcId: btn.getAttribute('data-svc'), now,
          lastUsedBySvc: acc.automation ? acc.automation.lastUsedBySvc : null
        });
        dot.className = `status-dot status-dot--${status}`;
        dot.title = activityStatusTitle(status);
      });
    }

    // Bascule tab--idle sur chaque onglet sans reconstruire toute la barre
    // (lot 16/09/2026) — même esprit que les deux fonctions ci-dessus.
    function refreshTabIdleClasses() {
      const now = Date.now();
      document.querySelectorAll('#tabsBar .tab').forEach(el => {
        const tab = tabs.find(t => t.id === el.getAttribute('data-tab'));
        if (!tab) return;
        el.classList.toggle('tab--idle', isTabIdle(tab.lastFocusAt, now, 5));
      });
    }

    // Tick cooldowns (1 s) : remet à 0 les cooldowns expirés (re-render pour
    // réactiver le bouton de service). Issue #136 : le bouton manuel de cooldown
    // est retiré, plus aucun cooldown n'est créé depuis l'interface ; ce tick
    // laisse expirer normalement ceux déjà enregistrés dans les comptes.
    // Coût d'un tick sans cooldown actif : boucle comptes x services pure (µs).
    //
    // Lot 18/09/2026 : notification de fin de cooldown. On compare le snapshot
    // des cooldowns actifs au tick précédent avec l'état courant pour détecter
    // les cooldowns qui viennent d'expirer (transition actif -> inactif), et on
    // envoie une notification navigateur + fait clignoter l'onglet concerné.
    let lastCdMinute = -1;
    let prevActiveCooldowns = snapshotActiveCooldowns(accounts);
    const notifiedCooldowns = new Set(); // clés déjà notifiées (anti-double-notification)

    setInterval(() => {
      const now = Date.now();
      let needsRender = false;
      accounts.forEach(acc => {
        SERVICES.forEach(svc => {
          const cd = acc.cooldowns[svc.id];
          if (!cd) return;
          if (cd <= now) { acc.cooldowns[svc.id] = 0; needsRender = true; }
        });
      });
      // Lot 18/09/2026 : détection des cooldowns qui viennent d'expirer.
      // On compare le snapshot précédent (prevActiveCooldowns) avec l'état
      // courant des comptes : tout cooldown qui était actif et ne l'est plus
      // déclenche une notification. Le snapshot est rafraîchi à chaque tick.
      const newlyExpired = getNewlyExpiredCooldowns(accounts, prevActiveCooldowns, now);
      prevActiveCooldowns = snapshotActiveCooldowns(accounts);
      // Nettoie les clés notifiées pour les cooldowns qui sont redevenus actifs
      // (permet de re-notifier si le même couple est réactivé puis expire à nouveau).
      for (const active of prevActiveCooldowns) {
        notifiedCooldowns.delete(active.key);
      }
      if (newlyExpired.length > 0) {
        for (const exp of newlyExpired) {
          if (notifiedCooldowns.has(exp.key)) continue; // déjà notifié
          notifiedCooldowns.add(exp.key);
          const acc = accounts.find(a => a.id === exp.accId);
          const svc = SERVICES.find(s => s.id === exp.svcId);
          if (!acc || !svc) continue;
          // Notification navigateur (si permission accordée)
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(_('Cooldown terminé'), {
                body: _('{account} — {service} est de nouveau disponible.', { account: acc.name, service: svc.name }),
                silent: false
              });
            } catch (e) { /* l'app ne doit pas planter sur une notification */ }
          }
          // Fait clignoter l'onglet concerné s'il est ouvert
          const tab = tabs.find(t => t.accId === exp.accId && t.svcId === exp.svcId);
          if (tab) {
            const tabEl = document.querySelector('#tabsBar .tab[data-tab="' + tab.id + '"]');
            if (tabEl) tabEl.classList.add('tab--flash');
          }
          showToast(_('{account} — {service} : cooldown terminé', { account: acc.name, service: svc.name }));
        }
      }
      const minute = Math.floor(now / 60000);
      const minuteChanged = minute !== lastCdMinute;
      if (needsRender) renderAccounts();
      // Lot 16/09/2026 : badges de statut compte + rappel onglet inactif,
      // même cadence (1×/min) — indépendants des cooldowns de service
      // ci-dessus. Pas besoin de refreshAccountStatusDots() si renderAccounts()
      // vient déjà de tourner (needsRender) : il a déjà tout reconstruit.
      if (minuteChanged) {
        if (!needsRender) refreshAccountStatusDots();
        refreshTabIdleClasses();
      }
      lastCdMinute = minute;
    }, 1000);

    // Issue #6 : nettoie l'ordre personnalisé des comptes supprimés/importés
    pruneAccountOrder(accounts);

    renderAccounts();

    // === Chargement et application des réglages au démarrage (lot 18/09/2026) ===
    // Applique le thème, la taille de police, le word wrap, et pousse
    // showAutomationWindows vers la config du scheduler.
    loadSettings();

    // === Ordonnanceur IA (chantier E) ===
    // Le registre de jobs vit côté main.js (scheduler/, IPC 'scheduler:*') ;
    // ce bloc ne fait qu'afficher l'état renvoyé par 'scheduler:get-state' et
    // relayer les actions du panneau. Voir FEATURES.md « Ordonnanceur » pour
    // le périmètre exact de ce lot (la fenêtre d'automatisation + le moteur
    // d'adaptateurs par service ne sont PAS encore implémentés).
    const SCHED_STATUS_LABELS = {
      DOWNLOADING: N_('Téléchargement…'), COMPLETED: N_('Téléchargé — à traiter'),
      PROJECT_PENDING: N_("Projet en cours d'analyse"), WAITING_FOR_PROFILE: N_('Aucun profil disponible'),
      RESUME_REQUIRED: N_('Reprise programmée'), RUNNING: N_('En cours'), PAUSED: N_('En pause'),
      DELIVERED: N_('Livré'), ERROR: N_('Erreur')
    };
    const SCHED_STATUS_COLORS = {
      DOWNLOADING: 'var(--accent)', RUNNING: 'var(--accent)', RESUME_REQUIRED: 'var(--accent)',
      COMPLETED: 'var(--warning)', PROJECT_PENDING: 'var(--warning)',
      WAITING_FOR_PROFILE: 'var(--fg-muted)', PAUSED: 'var(--fg-muted)',
      ERROR: 'var(--danger)', DELIVERED: 'var(--rose)'
    };
    let schedulerPollTimer = null;

    window.openSchedulerModal = function() {
      document.getElementById('schedulerModal').classList.add('open');
      refreshScheduler();
      if (!schedulerPollTimer) schedulerPollTimer = setInterval(refreshScheduler, 4000);
    }
    window.closeSchedulerModal = function() {
      document.getElementById('schedulerModal').classList.remove('open');
      if (schedulerPollTimer) { clearInterval(schedulerPollTimer); schedulerPollTimer = null; }
    }
    document.getElementById('schedulerModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeSchedulerModal();
    });

    // --- Tâches programmables : interface (issue #199, lot 4) ---
    // Liste, création/édition, « Exécuter maintenant » (même chemin que la
    // minuterie via moteurTaches), historique. Helpers purs dans lib/taches-ui.js
    // (conversions, descripteurs) ; validation finale par le service (taches:save).
    // Dernier état reçu (pour retrouver une tâche au clic « Modifier »).
    var tachesEtat = [];

    // Libellés : appels _() LITTÉRAUX pour que xgettext extraie chaque message
    // complet (invariant 8) — pas de fragments concaténés.
    function libelleUniteTaches(unite, n) {
      // Pluriels (issue #51) : « chaque minute » pour n = 1 au lieu de
      // « tous les 1 minutes ».
      if (unite === 'minute') return _n('chaque minute', 'toutes les {n} minutes', n, { n: n });
      if (unite === 'jour') return _n('chaque jour', 'tous les {n} jours', n, { n: n });
      if (unite === 'semaine') return _n('chaque semaine', 'toutes les {n} semaines', n, { n: n });
      if (unite === 'mois') return _n('chaque mois', 'tous les {n} mois', n, { n: n });
      return _n('chaque heure', 'toutes les {n} heures', n, { n: n });
    }
    function texteProgrammationTache(tache) {
      var d = window.iaoTachesUi.decrireProgrammation(tache.programmation);
      if (d.cle === 'unique') {
        return _('Le {date}', { date: formatterDateTache(d.iso) });
      }
      if (d.cle === 'periodique') {
        return libelleUniteTaches(d.unite, d.tous) + ' · ' + _('à partir du {date}', { date: formatterDateTache(d.iso) });
      }
      return _('programmation inconnue');
    }
    function texteComptesTache(tache) {
      var d = window.iaoTachesUi.decrireComptes(tache.comptes);
      if (d.cle === 'liste') return _n('{n} compte sélectionné', '{n} comptes sélectionnés', d.n, { n: d.n });
      return _('tous les comptes avec Claude');
    }
    function texteRepartitionTache(tache) {
      var d = window.iaoTachesUi.decrireRepartition(tache.repartition);
      if (d.cle === 'rotation') return _('rotation (un compte à la fois)');
      return d.secondes > 0
        ? _('tous les comptes, espacement de {n} s', { n: d.secondes })
        : _('tous les comptes en même temps');
    }
    function texteResultatTache(evenement) {
      var cle = window.iaoTachesUi.cleResultat(evenement.resultat);
      if (cle === 'lancee') return _('lancée');
      if (cle === 'envoye') return _('envoyée');
      if (cle === 'quota') return _('quota épuisé');
      if (cle === 'heures-calmes') return _('heures calmes');
      if (cle === 'non-connecte') return _('non connecté');
      if (cle === 'aucun-compte') return _('aucun compte éligible');
      if (cle === 'erreur') return _('erreur');
      return String(evenement.resultat || '');
    }
    function formatterDateTache(iso) {
      if (!iso) return '—';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      // Langue active de l'application : document.documentElement.lang est
      // mis à jour par le chargeur de catalogue (i18n:catalog -> « fr » reste
      // la langue source). Pas de français codé en dur dans le formatage.
      return d.toLocaleString(document.documentElement.lang || 'fr',
        { dateStyle: 'short', timeStyle: 'short' });
    }

    // Rafraîchit liste + historique. Le formulaire n'est JAMAIS reconstruit
    // ici : une saisie en cours n'est ni perdue ni écrasée par le polling de
    // 4 s (le formulaire ne dépend que des clics de l'utilisateur).
    async function refreshTachesUI() {
      try {
        var liste = await ipcRenderer.invoke('taches:list');
        if (liste && !liste.error) {
          tachesEtat = Array.isArray(liste) ? liste : [];
          renderTachesList(tachesEtat);
        }
      } catch (e) { console.warn('[taches] liste indisponible :', e && e.message); }
      try {
        var historique = await ipcRenderer.invoke('taches:history', 50);
        if (historique && !historique.error) renderTachesHistory(Array.isArray(historique) ? historique : []);
      } catch (e) { /* l'historique est secondaire */ }
    }

    function renderTachesList(taches) {
      var conteneur = document.getElementById('tachesList');
      if (!conteneur) return;
      if (!taches.length) {
        conteneur.innerHTML = '<div class="sched-empty">' + escapeHtml(_('Aucune tâche programmée pour l\'instant — créez-en une avec « Nouvelle tâche ».')) + '</div>';
        return;
      }
      conteneur.innerHTML = taches.map(function(t) {
        var prochain = t.prochaine ? _('Prochaine exécution : {date}', { date: formatterDateTache(t.prochaine) }) : _('Plus aucune exécution programmée');
        return '<div class="sched-job tache-card">' +
          '<div class="sched-job__dot" data-dot-color="' + (t.active ? 'var(--accent)' : 'var(--fg-muted)') + '"></div>' +
          '<div class="sched-job__body">' +
          '<div class="sched-job__title">' + escapeHtml(t.nom || '') + (t.active ? '' : ' <span class="tache-card__inactive">(' + escapeHtml(_('inactive')) + ')</span>') + '</div>' +
          '<div class="sched-job__meta">' + escapeHtml(texteProgrammationTache(t)) + ' · ' + escapeHtml(texteComptesTache(t)) + ' · ' + escapeHtml(texteRepartitionTache(t)) + '</div>' +
          '<div class="sched-job__meta">' + escapeHtml(prochain) + '</div>' +
          '<div class="sched-job__actions">' +
          '<button class="btn" data-action="tache-toggle" data-id="' + escapeHtml(t.id) + '">' + escapeHtml(t.active ? _('Désactiver') : _('Activer')) + '</button>' +
          '<button class="btn" data-action="tache-run" data-id="' + escapeHtml(t.id) + '">' + escapeHtml(_('Exécuter maintenant')) + '</button>' +
          '<button class="btn" data-action="tache-edit" data-id="' + escapeHtml(t.id) + '">' + escapeHtml(_('Modifier')) + '</button>' +
          '<button class="btn" data-action="tache-delete" data-id="' + escapeHtml(t.id) + '">' + escapeHtml(_('Supprimer')) + '</button>' +
          '</div></div></div>';
      }).join('');
      applyDataColors(conteneur);
    }

    function renderTachesHistory(evenements) {
      var conteneur = document.getElementById('tachesHistory');
      if (!conteneur) return;
      if (!evenements.length) {
        conteneur.innerHTML = '<div class="sched-empty-log">' + escapeHtml(_('Aucun événement pour l\'instant.')) + '</div>';
        return;
      }
      conteneur.innerHTML = evenements.map(function(ev) {
        var ligne = '[' + escapeHtml(formatterDateTache(ev.date)) + '] ' +
          escapeHtml(ev.nom || '') + (ev.profil ? ' · ' + escapeHtml(window.iaoProfilCompte.libelleProfil(ev.profil, accounts)) : '') +
          ' — ' + escapeHtml(texteResultatTache(ev));
        if (ev.detail) ligne += ' (' + escapeHtml(String(ev.detail)) + ')';
        return '<div>' + ligne + '</div>';
      }).join('');
    }

    // Formulaire de création / édition. La valeur du champ « id » (hidden au
    // sens DOM : stockée dans une propriété) distingue création et édition.
    var formulaireTacheId = null;
    var formulaireTacheOriginale = null;
    function ouvrirFormulaireTache(tache) {
      var form = document.getElementById('tacheForm');
      var champs = window.iaoTachesUi.tacheVersForm(tache || {});
      formulaireTacheId = champs.id;
      // Tâche d'origine (édition) : les valeurs que le formulaire ne peut pas
      // représenter exactement (ms) sont préservées à l'enregistrement si le
      // champ correspondant n'a pas été modifié (lib/taches-ui.js).
      formulaireTacheOriginale = tache || null;
      document.getElementById('tacheFormNom').value = champs.nom;
      document.getElementById('tacheFormComptesMode').value = champs.comptesMode;
      construireChoixComptes(champs.comptesProfils);
      document.getElementById('tacheFormRepartition').value = champs.repartitionMode;
      document.getElementById('tacheFormEspacement').value = champs.espacementSecondes;
      document.getElementById('tacheFormSession').checked = champs.nouvelleSession;
      document.getElementById('tacheFormPrompt').value = champs.prompt;
      document.getElementById('tacheFormProgType').value = champs.programmationType;
      document.getElementById('tacheFormProgLe').value = champs.programmationLe || '';
      document.getElementById('tacheFormProgTous').value = champs.programmationTous;
      document.getElementById('tacheFormProgUnite').value = champs.programmationUnite;
      document.getElementById('tacheFormProgDepuis').value = champs.programmationDepuis || '';
      document.getElementById('tacheFormActive').checked = champs.active;
      document.getElementById('tacheFormErreurs').hidden = true;
      document.getElementById('tacheFormErreurs').innerHTML = '';
      basculerChampsFormulaire();
      form.hidden = false;
      form.scrollIntoView({ block: 'start' });
    }
    function fermerFormulaireTache() {
      document.getElementById('tacheForm').hidden = true;
      formulaireTacheId = null;
      formulaireTacheOriginale = null;
    }

    // Cases à cocher des comptes : seuls les comptes AVEC le service Claude
    // sont proposés. Les profils SÉLECTIONNÉS mais devenus indisponibles (plus
    // de service Claude, compte supprimé) restent cochés et signalés — sinon
    // une édition du seul nom les retirerait silencieusement de la tâche
    // (l'éligibilité à l'exécution reste contrôlée par le service, qui les
    // exclut le moment venu).
    function construireChoixComptes(profilsSelectionnes) {
      var conteneur = document.getElementById('tacheFormComptesChoix');
      var avecClaude = accounts.filter(function(a) {
        return Array.isArray(a.services) && a.services.indexOf('claude') !== -1;
      });
      var connus = new Set(accounts.map(function(a) { return a.profile; }));
      var selectionnes = new Set(profilsSelectionnes || []);
      var indisponibles = [...selectionnes].filter(function(p) {
        return !avecClaude.some(function(a) { return a.profile === p; });
      });
      if (!avecClaude.length && !indisponibles.length) {
        conteneur.innerHTML = '<div class="sched-empty">' + escapeHtml(_('Aucun compte avec le service Claude — la tâche ne pourra pas s\'exécuter.')) + '</div>';
        return;
      }
      var lignes = avecClaude.map(function(a) {
        var coche = selectionnes.has(a.profile);
        return '<label class="tache-form__compte"><input type="checkbox" data-profile="' + escapeHtml(a.profile) + '"' + (coche ? ' checked' : '') + '> ' + escapeHtml(window.iaoProfilCompte.libelleCompte(a)) + '</label>';
      });
      for (var i = 0; i < indisponibles.length; i++) {
        var p = indisponibles[i];
        var note = connus.has(p)
          ? _('sans le service Claude')
          : _('compte supprimé');
        lignes.push('<label class="tache-form__compte tache-form__compte--indisponible">' +
          '<input type="checkbox" data-profile="' + escapeHtml(p) + '" checked disabled> ' +
          escapeHtml(window.iaoProfilCompte.libelleProfil(p, accounts)) + ' <span class="tache-form__note">(' + escapeHtml(note) + ')</span></label>');
      }
      conteneur.innerHTML = lignes.join('');
    }

    // Affiche/masque les champs conditionnels du formulaire.
    function basculerChampsFormulaire() {
      var modeComptes = document.getElementById('tacheFormComptesMode').value;
      document.getElementById('tacheFormComptesChoix').hidden = modeComptes !== 'liste';
      var repartition = document.getElementById('tacheFormRepartition').value;
      document.getElementById('tacheFormEspacementGroupe').style.display = repartition === 'tous' ? '' : 'none';
      var progType = document.getElementById('tacheFormProgType').value;
      document.getElementById('tacheFormProgUniqueGroupe').style.display = progType === 'unique' ? '' : 'none';
      document.getElementById('tacheFormProgPeriodiqueGroupe').style.display = progType === 'periodique' ? '' : 'none';
    }

    // Enregistre le formulaire : mapping par les helpers purs (lib/taches-ui.js),
    // validation finale par le service. Les erreurs (codes du helper ou du
    // service) sont traduites ici par des appels _() littéraux et affichées
    // dans le formulaire, sans le fermer.
    // Msgids marqués par N_() (extraction xgettext à la construction) puis
    // traduits par _() au moment du rendu — le catalogue charge APRÈS app.js
    // (motif établi du fichier, cf. N_ plus haut).
    var MESSAGES_ERREURS_FORMULAIRE = {
      'nom': N_('Le nom est obligatoire.'),
      'prompt': N_('Le prompt est obligatoire.'),
      'comptes-mode': N_('Comptes : choix invalide.'),
      'comptes-vides': N_('Sélectionnez au moins un compte.'),
      'repartition-mode': N_('Répartition : choix invalide.'),
      'espacement': N_('Espacement invalide : entre 0 et 86400 secondes.'),
      'programmation-type': N_('Programmation : choix invalide.'),
      'date-le': N_('Date « Le » invalide.'),
      'date-depuis': N_('Date « À partir du » invalide.'),
      'tous': N_('« Tous les » doit être un entier supérieur à 0.'),
      'unite': N_('Unité inconnue.')
    };
    function traduireErreursFormulaire(erreurs) {
      return (erreurs || []).map(function(e) {
        if (typeof e === 'string' && MESSAGES_ERREURS_FORMULAIRE[e]) return _(MESSAGES_ERREURS_FORMULAIRE[e]);
        return String(e); // messages du service (déjà en français, côté main)
      });
    }

    async function enregistrerFormulaireTache() {
      var profils = [];
      document.querySelectorAll('#tacheFormComptesChoix input[type="checkbox"]:checked').forEach(function(cb) {
        profils.push(cb.getAttribute('data-profile'));
      });
      var champs = {
        id: formulaireTacheId,
        nom: document.getElementById('tacheFormNom').value,
        fournisseur: 'claude',
        comptesMode: document.getElementById('tacheFormComptesMode').value,
        comptesProfils: profils,
        repartitionMode: document.getElementById('tacheFormRepartition').value,
        espacementSecondes: Number(document.getElementById('tacheFormEspacement').value),
        nouvelleSession: document.getElementById('tacheFormSession').checked,
        prompt: document.getElementById('tacheFormPrompt').value,
        programmationType: document.getElementById('tacheFormProgType').value,
        programmationLe: document.getElementById('tacheFormProgLe').value,
        programmationDepuis: document.getElementById('tacheFormProgDepuis').value,
        programmationTous: Number(document.getElementById('tacheFormProgTous').value),
        programmationUnite: document.getElementById('tacheFormProgUnite').value,
        active: document.getElementById('tacheFormActive').checked
      };
      var conv = window.iaoTachesUi.formVersTache(champs);
      var erreurs = conv.ok ? [] : conv.erreurs.slice();
      if (conv.ok) {
        // Édition : les champs inchangés gardent leur valeur EXACTE du modèle
        // (ms) plutôt que la conversion arrondie du formulaire.
        conv.tache = window.iaoTachesUi.preserverValeursNonModifiees(
          conv.tache, formulaireTacheOriginale, champs);
        try {
          var res = await ipcRenderer.invoke('taches:save', conv.tache);
          if (res && res.error) erreurs = [res.error];
          else if (res && res.ok === false && Array.isArray(res.erreurs)) erreurs = traduireErreursFormulaire(res.erreurs);
        } catch (e) {
          erreurs = [_('Enregistrement impossible : {erreur}', { erreur: e && e.message ? e.message : String(e) })];
        }
      } else {
        erreurs = traduireErreursFormulaire(erreurs);
      }
      if (erreurs.length) {
        var zone = document.getElementById('tacheFormErreurs');
        zone.innerHTML = erreurs.map(function(e) { return '<div>' + escapeHtml(String(e)) + '</div>'; }).join('');
        zone.hidden = false;
        return;
      }
      fermerFormulaireTache();
      refreshTachesUI();
    }

    // « Exécuter maintenant » : la garde du moteur est prise AVANT l'appel au
    // service (taches:run-now marque la tâche côté service) ; le plan est
    // construit par le service puis exécuté par le moteur partagé — même
    // chemin que la minuterie. Le résultat arrive par l'historique
    // (taches:report), jamais fabriqué ici : le message reste neutre.
    async function executerTacheMaintenant(id) {
      if (!moteurTaches) { showToast(_('Le moteur de tâches n\'est pas démarré.'), 'error'); return; }
      try {
        var r = await moteurTaches.executerTache(id);
        if (r && r.ok) {
          showToast(_('Exécution demandée — le résultat apparaîtra dans l\'historique.'), 'success');
        } else if (r && r.motif === 'occupe') {
          showToast(_('Une exécution est déjà en cours — réessayez dans un instant.'), 'warning');
        } else if (r && r.motif === 'erreur-service') {
          showToast(_('Le service des tâches a refusé l\'exécution.'), 'error');
        } else {
          showToast(_('Tâche introuvable.'), 'error');
        }
      } catch (e) {
        showToast(_('Exécution impossible : {erreur}', { erreur: e && e.message ? e.message : String(e) }), 'error');
      }
      refreshTachesUI();
    }

    // Délégation d'événements (invariant 5) : un listener par conteneur, aucune
    // donnée interpolée dans le HTML généré (les ids sont échappés au rendu).
    document.getElementById('tachesList').addEventListener('click', async function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var action = btn.getAttribute('data-action');
      if (action === 'tache-toggle') {
        var t = tachesEtat.find(function(x) { return x.id === id; });
        try {
          var res = await ipcRenderer.invoke('taches:set-active', id, !(t && t.active));
          if (res && res.error) showToast(res.error, 'error');
        } catch (err) { showToast(_('Action impossible : {erreur}', { erreur: err && err.message }), 'error'); }
        refreshTachesUI();
        return;
      }
      if (action === 'tache-run') { executerTacheMaintenant(id); return; }
      if (action === 'tache-edit') {
        var t2 = tachesEtat.find(function(x) { return x.id === id; });
        if (t2) ouvrirFormulaireTache(t2);
        return;
      }
      if (action === 'tache-delete') {
        var t3 = tachesEtat.find(function(x) { return x.id === id; });
        showConfirmDialog(_('Supprimer la tâche'),
          _('Supprimer « {nom} » ? L\'historique est conservé.', { nom: (t3 && t3.nom) || id }),
          async function() {
            try {
              var r2 = await ipcRenderer.invoke('taches:delete', id);
              if (r2 && r2.error) showToast(r2.error, 'error');
            } catch (err) { showToast(_('Suppression impossible : {erreur}', { erreur: err && err.message }), 'error'); }
            refreshTachesUI();
          });
      }
    });
    document.getElementById('tacheForm').addEventListener('click', async function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.getAttribute('data-action') === 'tache-form-cancel') fermerFormulaireTache();
      if (btn.getAttribute('data-action') === 'tache-form-save') enregistrerFormulaireTache();
    });
    document.getElementById('tacheNewBtn').addEventListener('click', function() { ouvrirFormulaireTache(null); });
    document.getElementById('tacheFormComptesMode').addEventListener('change', basculerChampsFormulaire);
    document.getElementById('tacheFormRepartition').addEventListener('change', basculerChampsFormulaire);
    document.getElementById('tacheFormProgType').addEventListener('change', basculerChampsFormulaire);

    // === Réglages (lot 18/09/2026, FEATURES.md P2) ===
    // Persistance via IPC settings:load/settings:save (main.js), normalisation
    // via lib/settings.js (normalizeSettings, DEFAULT_SETTINGS).
    var currentSettings = null;

    // Issue #139 : préférence claire/sombre du bureau. Electron relaie le thème
    // du système (nativeTheme.themeSource = 'system' par défaut) vers
    // prefers-color-scheme. undefined si matchMedia est indisponible.
    var systemThemeQuery = (typeof window.matchMedia === 'function')
      ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function systemPrefersDark() {
      return systemThemeQuery ? systemThemeQuery.matches === true : undefined;
    }
    // Le bureau change de thème pendant que l'app tourne -> réappliquer si
    // le réglage est « system » (les autres thèmes sont fixes).
    if (systemThemeQuery && typeof systemThemeQuery.addEventListener === 'function') {
      systemThemeQuery.addEventListener('change', function() {
        if (currentSettings && normalizeTheme(currentSettings.theme) === 'system') {
          document.documentElement.setAttribute('data-theme',
            resolveTheme('system', systemPrefersDark()));
        }
      });
    }

    // Applique effectivement tous les réglages à l'UI.
    // Appelée au démarrage (après chargement) et après chaque sauvegarde.
    function applySettings(settings) {
      if (!settings) return;
      currentSettings = settings;
      var plan = buildApplySettingsPlan(settings, { prefersDark: systemPrefersDark() });

      // 1. Thème : pose data-theme sur <html> (« system » -> dark/light selon
      // le bureau, issue #139 ; suivi en direct par l'écouteur ci-dessous)
      document.documentElement.setAttribute('data-theme', plan.themeAttr);

      // 2. Taille de police + retour à la ligne de l'éditeur Monaco
      if (window.monacoEditor && typeof window.monacoEditor.updateOptions === 'function') {
        window.monacoEditor.updateOptions(plan.monacoOptions);
      }
      // Éditeur de secours (textarea)
      var fe = document.getElementById('fallbackEditor');
      if (fe) {
        fe.style.fontSize = plan.fallbackFontSizePx;
      }

      // 3. showAutomationWindows : pousser vers la config du scheduler
      ipcRenderer.invoke('scheduler:set-config', plan.schedulerConfigPush).catch(function() {});
    }

    // --- Statistiques d'utilisation (issue #206, lot 1) ---
    // Historique (stats:load) + sessions en cours, agrégés par lib/stats.js.
    // Les noms de compte et de service viennent des données locales et passent
    // par escapeHtml() ; un profil sans compte (supprimé) reste affiché tel quel.
    let statsPeriode = 'jour';
    let statsHistorique = [];
    function dureeStats(ms) {
      if (ms > 0 && ms < 60000) return _('< 1 min');
      const d = window.iaoStats.decomposerDuree(ms);
      return d.heures ? _('{h} h {m} min', { h: d.heures, m: String(d.minutes).padStart(2, '0') })
        : _('{m} min', { m: d.minutes });
    }
    function dateStats(ms) {
      if (!ms) return '—';
      try {
        return new Date(ms).toLocaleString(document.documentElement.lang || undefined,
          { dateStyle: 'short', timeStyle: 'short' });
      } catch (_e) { return new Date(ms).toLocaleString(); }
    }
    // Tri par colonne (lot 2) : clic sur un en-tête [data-stats-tri] ; un
    // second clic inverse le sens. État par tableau, conservé à la réouverture.
    const statsTri = {};
    function enteteTri(table, col, libelle, num) {
      const t = statsTri[table];
      const actif = t && t.col === col;
      const fleche = actif ? (t.sens === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="stats-tri${num ? ' num' : ''}${actif ? ' stats-tri--actif' : ''}" data-stats-tri="${table}" data-col="${col}"
        aria-sort="${actif ? (t.sens === 'asc' ? 'ascending' : 'descending') : 'none'}">${escapeHtml(libelle)}${fleche}</th>`;
    }
    function trierStats(table, lignes) {
      const t = statsTri[table];
      return t ? window.iaoStats.trierLignes(lignes, t.col, t.sens) : lignes;
    }
    function tableStats(table, titre, colonne, lignes, nomLigne, avecPart) {
      if (!lignes.length) return '';
      const max = Math.max(1, ...lignes.map(l => l.actifMs));
      const corps = trierStats(table, lignes).map(l => {
        const n = nomLigne(l);
        return `<tr>
          <td><div class="stats-nom">${n.point}<span title="${escapeHtml(n.titre)}">${escapeHtml(n.nom)}</span></div>
            <div class="stats-barre" style="width:${Math.round(100 * l.actifMs / max)}%"></div></td>
          <td class="num">${escapeHtml(dureeStats(l.actifMs))}</td>
          <td class="num">${escapeHtml(dureeStats(l.dureeMs))}</td>
          <td class="num">${l.sessions}</td>
          <td class="num">${avecPart ? Math.round(100 * l.part) + ' %' : escapeHtml(dateStats(l.dernier))}</td>
        </tr>`;
      }).join('');
      return `<div><div class="stats-titre">${escapeHtml(titre)}</div>
        <table class="stats-table"><thead><tr>
          ${enteteTri(table, 'cle', colonne, false)}${enteteTri(table, 'actifMs', _('Temps actif'), true)}
          ${enteteTri(table, 'dureeMs', _('Durée ouverte'), true)}${enteteTri(table, 'sessions', _('Sessions'), true)}
          ${avecPart ? enteteTri(table, 'part', _('Part'), true) : enteteTri(table, 'dernier', _('Dernière utilisation'), true)}
        </tr></thead><tbody>${corps}</tbody></table></div>`;
    }
    function nomCompteStats(profil) {
      const acc = accounts.find(a => a.profile === profil);
      return acc ? acc.name : profil;
    }
    // Carte de chaleur jour × heure (lundi en premier, heures locales).
    function carteChaleurStats(h) {
      if (!h.max) return '';
      const jours = [_('Lun'), _('Mar'), _('Mer'), _('Jeu'), _('Ven'), _('Sam'), _('Dim')];
      const entete = Array.from({ length: 24 }, (_x, i) => `<th>${i % 3 === 0 ? i : ''}</th>`).join('');
      const lignes = h.grille.map((ligne, j) => `<tr><th class="stats-chaleur__jour">${escapeHtml(jours[j])}</th>${
        ligne.map((ms, heure) => {
          const niveau = ms ? Math.max(0.12, ms / h.max) : 0;
          const titre = _('{jour} {h} h : {duree}', { jour: jours[j], h: heure, duree: dureeStats(ms) });
          return `<td class="stats-chaleur__case" style="--niveau:${niveau.toFixed(2)}" title="${escapeHtml(titre)}"></td>`;
        }).join('')}</tr>`).join('');
      return `<div><div class="stats-titre">${escapeHtml(_('Heures de pointe (temps actif)'))}</div>
        <table class="stats-chaleur" id="statsChaleur"><thead><tr><th></th>${entete}</tr></thead><tbody>${lignes}</tbody></table></div>`;
    }
    function inutilisesStats(liste) {
      if (!liste.length) return '';
      const items = liste.map(l => `<li><span title="${escapeHtml(l.cle)}">${escapeHtml(nomCompteStats(l.cle))}</span>
        <span class="stats-inutilise__date">${escapeHtml(l.dernier ? _('dernière utilisation : {date}', { date: dateStats(l.dernier) }) : _('jamais utilisé depuis le début de la mesure'))}</span></li>`).join('');
      return `<div><div class="stats-titre">${escapeHtml(_('Comptes inutilisés sur la période'))}</div>
        <ul class="stats-inutilises" id="statsInutilises">${items}</ul></div>`;
    }
    function tachesStats(lignes) {
      if (!lignes.length) return '';
      const corps = trierStats('taches', lignes).map(l => `<tr>
          <td><span title="${escapeHtml(l.cle)}">${escapeHtml(nomCompteStats(l.cle))}</span></td>
          <td class="num">${l.envoye}</td><td class="num">${l.quota}</td><td class="num">${l.erreur}</td>
          <td class="num">${l.total}</td>
          <td class="num">${escapeHtml(l.dernierQuota ? dateStats(Date.parse(l.dernierQuota)) + (l.heureQuota ? ' (' + _('fin {h}', { h: l.heureQuota }) + ')' : '') : '—')}</td>
        </tr>`).join('');
      return `<div><div class="stats-titre">${escapeHtml(_('Tâches programmables par compte'))}</div>
        <table class="stats-table" id="statsTaches"><thead><tr>
          ${enteteTri('taches', 'cle', _('Compte'), false)}${enteteTri('taches', 'envoye', _('Envoyées'), true)}
          ${enteteTri('taches', 'quota', _('Quotas'), true)}${enteteTri('taches', 'erreur', _('Erreurs'), true)}
          ${enteteTri('taches', 'total', _('Exécutions'), true)}${enteteTri('taches', 'dernierQuota', _('Dernier quota'), true)}
        </tr></thead><tbody>${corps}</tbody></table>
        <div class="stats-note">${escapeHtml(_('D\'après l\'historique des tâches (200 dernières exécutions).'))}</div></div>`;
    }
    // Histogramme d'évolution du temps actif (lot 3) : SVG maison, sans
    // dépendance ; géométrie calculée par lib/stats.js, libellés échappés.
    function heureCourte(ms) {
      const d = new Date(ms);
      return statsPeriode === 'jour' ? String(d.getHours()) : d.getDate() + '/' + (d.getMonth() + 1);
    }
    // Histogramme générique : `valeur(t)` donne la hauteur, `format` le texte
    // de l'échelle et `infobulle(t, date)` le titre de chaque barre.
    function histogrammeStats(id, titre, tranches, valeur, format, infobulle, secondes) {
      const L = 680, HAUT = 120, G = 44, BAS = 18;
      const valeurs = tranches.map(valeur);
      if (!valeurs.some(v => v > 0)) return '';
      const geo = window.iaoStats.geometrieBarres(valeurs, { largeur: L - G, hauteur: HAUT, secondes });
      const pasLibelle = Math.ceil(tranches.length / 12);
      const barres = geo.barres.map((b, i) => {
        const t = tranches[i];
        const date = statsPeriode === 'jour' ? _('{h} h', { h: heureCourte(t.debut) }) : heureCourte(t.debut);
        return `<rect class="stats-evolution__barre" x="${G + b.x}" y="${b.y}" width="${b.largeur}" height="${b.hauteur}"><title>${escapeHtml(infobulle(t, date))}</title></rect>`;
      }).join('');
      const libelles = tranches.map((t, i) => i % pasLibelle ? '' :
        `<text class="stats-evolution__texte" x="${G + geo.barres[i].x + geo.barres[i].largeur / 2}" y="${HAUT + 13}" text-anchor="middle">${escapeHtml(heureCourte(t.debut))}</text>`).join('');
      return `<div class="stats-evolution" id="${id}"><div class="stats-titre">${escapeHtml(titre)}</div>
        <svg viewBox="0 0 ${L} ${HAUT + BAS}" role="img" aria-label="${escapeHtml(titre)}">
          <line class="stats-evolution__axe" x1="${G}" y1="0.5" x2="${L}" y2="0.5"></line>
          <line class="stats-evolution__axe" x1="${G}" y1="${HAUT / 2}" x2="${L}" y2="${HAUT / 2}"></line>
          <line class="stats-evolution__axe" x1="${G}" y1="${HAUT}" x2="${L}" y2="${HAUT}"></line>
          <text class="stats-evolution__texte" x="${G - 6}" y="10" text-anchor="end">${escapeHtml(format(geo.echelle))}</text>
          <text class="stats-evolution__texte" x="${G - 6}" y="${HAUT + 3}" text-anchor="end">0</text>
          ${barres}${libelles}
        </svg></div>`;
    }
    function evolutionStats(tranches) {
      return histogrammeStats('statsEvolution', _('Évolution du temps actif'), tranches, t => t.actifMs, dureeStats,
        (t, date) => _('{date} : {duree} actif', { date, duree: dureeStats(t.actifMs) }));
    }
    // Temps de réponse et quotas atteints (lot 2b) : mesurés sur les tâches
    // programmables et sur les messages envoyés à la main (lib/mesure-reponse.js).
    let statsReponses = [];
    let statsQuotas = [];
    function delaiStats(ms) {
      if (ms < 60000) return _('{s} s', { s: Math.max(0, Math.round(ms / 1000)) });
      return dureeStats(ms);
    }
    function nomServiceStats(id) {
      const svc = SERVICES.find(x => x.id === id);
      return svc ? svc.name : id;
    }
    function reponsesStats(agr) {
      const lignes = agr.parCompteService.map(l => Object.assign({ cle: l.profil + '|' + l.service }, l));
      if (!lignes.length) return '';
      const corps = trierStats('reponses', lignes).map(l => `<tr>
          <td><span title="${escapeHtml(l.profil)}">${escapeHtml(nomCompteStats(l.profil))}</span></td>
          <td>${escapeHtml(nomServiceStats(l.service))}</td>
          <td class="num">${l.nombre}</td>
          <td class="num">${escapeHtml(delaiStats(l.medianeMs))}</td>
          <td class="num">${escapeHtml(delaiStats(l.minMs))}</td>
          <td class="num">${escapeHtml(delaiStats(l.maxMs))}</td>
        </tr>`).join('');
      return `<div><div class="stats-titre">${escapeHtml(_('Temps de réponse'))}</div>
        <table class="stats-table" id="statsReponses"><thead><tr>
          ${enteteTri('reponses', 'cle', _('Compte'), false)}${enteteTri('reponses', 'service', _('Service'), false)}
          ${enteteTri('reponses', 'nombre', _('Réponses'), true)}${enteteTri('reponses', 'medianeMs', _('Médiane'), true)}
          ${enteteTri('reponses', 'minMs', _('Plus rapide'), true)}${enteteTri('reponses', 'maxMs', _('Plus lente'), true)}
        </tr></thead><tbody>${corps}</tbody></table>
        <div class="stats-note">${escapeHtml(_('Du message envoyé à la fin de la réponse, pour les tâches programmables et les messages envoyés à la main.'))}</div></div>`;
    }
    function quotasStats(agr) {
      const lignes = agr.parCompteService.map(l => Object.assign({
        cle: l.profil + '|' + l.service,
        heure: l.parHeure.indexOf(Math.max(...l.parHeure))
      }, l));
      if (!lignes.length) return '';
      const corps = trierStats('quotas', lignes).map(l => `<tr>
          <td><span title="${escapeHtml(l.profil)}">${escapeHtml(nomCompteStats(l.profil))}</span></td>
          <td>${escapeHtml(nomServiceStats(l.service))}</td>
          <td class="num">${l.nombre}</td>
          <td class="num">${escapeHtml(_('{h} h', { h: l.heure }))}</td>
        </tr>`).join('');
      return `<div><div class="stats-titre">${escapeHtml(_('Quotas atteints'))}</div>
        <table class="stats-table" id="statsQuotas"><thead><tr>
          ${enteteTri('quotas', 'cle', _('Compte'), false)}${enteteTri('quotas', 'service', _('Service'), false)}
          ${enteteTri('quotas', 'nombre', _('Fois'), true)}${enteteTri('quotas', 'heure', _('Heure habituelle'), true)}
        </tr></thead><tbody>${corps}</tbody></table></div>`;
    }
    // Lot 4 : évolution du temps de réponse médian et comptes surchargés.
    function evolutionReponsesStats(tranches) {
      return histogrammeStats('statsEvolutionReponses', _('Évolution du temps de réponse médian'), tranches,
        t => t.medianeMs, delaiStats,
        (t, date) => _n('{date} : médiane {duree}, {n} réponse', '{date} : médiane {duree}, {n} réponses', t.nombre,
          { date, duree: delaiStats(t.medianeMs), n: t.nombre }), true);
    }
    function surchargesStats(r) {
      if (!r.surcharges.length) return '';
      const items = r.surcharges.map(l => `<li><span title="${escapeHtml(l.profil)}">${escapeHtml(nomCompteStats(l.profil))}</span>
        <span class="stats-inutilise__date">${escapeHtml(_n('{n} quota atteint', '{n} quotas atteints', l.quotas, { n: l.quotas }))}</span></li>`).join('');
      const relais = r.relais.length ? `<div class="stats-note">${escapeHtml(_('Comptes à privilégier pour répartir l\'usage : {comptes}',
        { comptes: r.relais.map(nomCompteStats).join(', ') }))}</div>` : '';
      return `<div><div class="stats-titre">${escapeHtml(_('Comptes souvent bloqués par un quota'))}</div>
        <ul class="stats-inutilises" id="statsSurcharges">${items}</ul>${relais}</div>`;
    }
    let statsTaches = [];
    function renderStats() {
      document.querySelectorAll('#statsPeriodes [data-periode]').forEach(b =>
        b.classList.toggle('stats-periode--active', b.getAttribute('data-periode') === statsPeriode));
      const maintenant = Date.now();
      const sessions = statsHistorique.concat(suiviStats.instantane());
      const r = window.iaoStats.agreger(sessions, { periode: statsPeriode, maintenant });
      const taches = window.iaoStats.resultatsTaches(statsTaches, r.depuis);
      const reponses = window.iaoStats.agregerReponses(statsReponses, { periode: statsPeriode, maintenant });
      const quotas = window.iaoStats.agregerQuotas(statsQuotas, { periode: statsPeriode, maintenant });
      const body = document.getElementById('statsBody');
      if (!r.totaux.sessions && !taches.length && !reponses.totaux.nombre && !quotas.parCompteService.length) {
        body.innerHTML = `<div class="stats-vide">${escapeHtml(_('Aucune session sur cette période. La mesure commence à l\'installation de cette version.'))}</div>`;
        return;
      }
      const serie = window.iaoStats.serieJours(sessions, maintenant);
      const jours = (n) => _n('{n} jour', '{n} jours', n, { n });
      const carte = (valeur, libelle) => `<div class="stats-carte"><div class="stats-carte__valeur">${escapeHtml(valeur)}</div><div class="stats-carte__libelle">${escapeHtml(libelle)}</div></div>`;
      body.innerHTML = `<div class="stats-totaux">
          ${carte(dureeStats(r.totaux.actifMs), _('Temps actif'))}
          ${carte(dureeStats(r.totaux.dureeMs), _('Durée ouverte'))}
          ${carte(String(r.totaux.sessions), _('Sessions'))}
          ${carte(jours(serie.actuelle), _('Série en cours (record : {n})', { n: jours(serie.record) }))}
          ${carte(String(reponses.totaux.nombre), _('Réponses'))}
          ${carte(reponses.totaux.nombre ? delaiStats(reponses.totaux.medianeMs) : '—', _('Temps de réponse médian'))}
        </div>
        ${evolutionStats(window.iaoStats.evolution(sessions, { periode: statsPeriode, maintenant }))}
        ${evolutionReponsesStats(window.iaoStats.evolutionReponses(statsReponses, { periode: statsPeriode, maintenant }))}
        ${tableStats('compte', _('Par compte'), _('Compte'), r.parCompte, (l) =>
          ({ nom: nomCompteStats(l.cle), titre: l.cle, point: '' }), false)}
        ${tableStats('service', _('Par service'), _('Service'), r.parService, (l) => {
          const svc = SERVICES.find(x => x.id === l.cle);
          return { nom: svc ? svc.name : l.cle, titre: l.cle,
            point: svc ? `<span class="stats-point svc-bg-${svc.id}"></span>` : '' };
        }, true)}
        ${carteChaleurStats(window.iaoStats.heuresDePointe(sessions, r.depuis))}
        ${inutilisesStats(window.iaoStats.comptesInutilises(sessions, accounts.map(a => a.profile), r.depuis))}
        ${reponsesStats(reponses)}
        ${quotasStats(quotas)}
        ${surchargesStats(window.iaoStats.comptesSurcharges(sessions, statsQuotas, accounts.map(a => a.profile), r.depuis))}
        ${tachesStats(taches)}`;
    }
    document.getElementById('statsBody').addEventListener('click', (e) => {
      const th = e.target.closest('[data-stats-tri]');
      if (!th) return;
      const table = th.getAttribute('data-stats-tri');
      const col = th.getAttribute('data-col');
      const t = statsTri[table];
      statsTri[table] = { col, sens: t && t.col === col && t.sens === 'desc' ? 'asc' : 'desc' };
      renderStats();
    });
    window.openStatsModal = async function() {
      document.getElementById('statsModal').classList.add('open');
      renderStats();
      try {
        const h = await ipcRenderer.invoke('stats:load');
        statsHistorique = Array.isArray(h) ? h : [];
        if (h && h.error) showToast(_('Statistiques illisibles : {error}', { error: h.error }), 'error');
      } catch (e) {
        statsHistorique = [];
        dbg('stats', 'chargement en échec', e && e.message);
      }
      try {
        // Historique des tâches programmables (lot 2) : secondaire, une panne
        // n'empêche pas l'affichage des sessions.
        const t = await ipcRenderer.invoke('taches:history', 200);
        statsTaches = Array.isArray(t) ? t : [];
      } catch (e) {
        statsTaches = [];
        dbg('stats', 'historique des tâches indisponible', e && e.message);
      }
      try {
        // Temps de réponse et quotas (lot 2b) : secondaires eux aussi.
        const [rep, quo] = await Promise.all([ipcRenderer.invoke('stats:reponses'), ipcRenderer.invoke('stats:quotas')]);
        statsReponses = Array.isArray(rep) ? rep : [];
        statsQuotas = Array.isArray(quo) ? quo : [];
      } catch (e) {
        statsReponses = [];
        statsQuotas = [];
        dbg('stats', 'temps de réponse et quotas indisponibles', e && e.message);
      }
      renderStats();
    };
    // Export (lot 3) : historique + onglets ouverts, noms de compte joints ;
    // le fichier est choisi et écrit par le process principal (stats:export).
    async function exporterStats(format) {
      const noms = {};
      for (const a of accounts) noms[a.profile] = a.name;
      try {
        const r = await ipcRenderer.invoke('stats:export', format, suiviStats.instantane(), noms);
        if (r && r.canceled) return;
        if (!r || r.error) { showToast(_('Export des statistiques impossible : {error}', { error: (r && r.error) || '?' }), 'error'); return; }
        showToast(_('Statistiques exportées'), 'success');
      } catch (e) {
        showToast(_('Export des statistiques impossible : {error}', { error: e && e.message }), 'error');
      }
    }
    window.exportStatsCsv = function() { return exporterStats('csv'); };
    window.exportStatsJson = function() { return exporterStats('json'); };
    // Remise à zéro (lot 3) : confirmation, puis historique et instantané
    // vidés ; les onglets ouverts repartent de maintenant.
    window.resetStats = function() {
      showConfirmDialog(_('Remettre les statistiques à zéro ?'),
        _('Les sessions, temps de réponse et quotas enregistrés sur cet ordinateur seront effacés. L\'historique des tâches programmables n\'est pas touché. Pensez à exporter avant si besoin.'),
        async () => {
          try {
            const r = await ipcRenderer.invoke('stats:reset');
            if (!r || r.error) { showToast(_('Remise à zéro impossible : {error}', { error: (r && r.error) || '?' }), 'error'); return; }
            suiviStats.recommencer();
            statsHistorique = [];
            statsReponses = [];
            statsQuotas = [];
            renderStats();
            showToast(_('Statistiques remises à zéro'), 'success');
          } catch (e) {
            showToast(_('Remise à zéro impossible : {error}', { error: e && e.message }), 'error');
          }
        });
    };
    window.closeStatsModal = function() {
      document.getElementById('statsModal').classList.remove('open');
    };
    document.getElementById('statsModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeStatsModal();
    });
    document.getElementById('statsPeriodes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-periode]');
      if (!b) return;
      statsPeriode = b.getAttribute('data-periode');
      renderStats();
    });

    window.openSettingsModal = function() {
      document.getElementById('settingsModal').classList.add('open');
      loadSettings();
      rafraichirIdentifiants();
    }
    window.closeSettingsModal = function() {
      document.getElementById('settingsModal').classList.remove('open');
    }
    document.getElementById('settingsModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeSettingsModal();
    });

    // --- Identifiants des connecteurs, partagés entre profils (issue #278) ---
    // Gestion dans les réglages : liste + ajout + suppression. Le remplissage
    // des formulaires, lui, se fait par le menu natif du process principal
    // (lib/identifiants-preload.js + lib/identifiants-focus.js) : le mot de
    // passe ne transite jamais par ici.
    async function rafraichirIdentifiants() {
      const conteneur = document.getElementById('identifiantsListe');
      if (!conteneur) return;
      let liste;
      try {
        liste = await ipcRenderer.invoke('identifiants:lister');
      } catch (e) {
        showToast(_('Impossible de charger les identifiants'), 'error');
        return;
      }
      conteneur.textContent = '';
      const hotes = Object.keys(liste || {}).sort();
      if (!hotes.length) {
        const vide = document.createElement('span');
        vide.className = 'settings-hint';
        vide.textContent = _('Aucun identifiant enregistré pour l\'instant');
        conteneur.appendChild(vide);
        return;
      }
      for (const hote of hotes) {
        for (const entree of liste[hote]) {
          const ligne = document.createElement('div');
          ligne.className = 'identifiants-item';
          const etiquette = document.createElement('span');
          etiquette.className = 'identifiants-item__label';
          etiquette.textContent = entree.login + ' — ' + hote;
          const bouton = document.createElement('button');
          bouton.type = 'button';
          bouton.className = 'btn identifiants-item__suppr';
          bouton.title = _('Supprimer {login} pour {host}', { login: entree.login, host: hote });
          bouton.textContent = _('Supprimer');
          bouton.addEventListener('click', async () => {
            try {
              const r = await ipcRenderer.invoke('identifiants:supprimer', hote, entree.login);
              if (r === true) {
                showToast(_('Identifiant {login} supprimé pour {host}', { login: entree.login, host: hote }), 'success');
                rafraichirIdentifiants();
              } else {
                showToast(_('Suppression impossible : identifiant introuvable'), 'error');
              }
            } catch (e) {
              showToast(_('Suppression impossible : {error}', { error: e && e.message }), 'error');
            }
          });
          ligne.appendChild(etiquette);
          ligne.appendChild(bouton);
          conteneur.appendChild(ligne);
        }
      }
    }
    document.getElementById('identifiantsAjouter').addEventListener('click', async () => {
      const hote = (document.getElementById('identifiantHote').value || '').trim().toLowerCase();
      const login = (document.getElementById('identifiantLogin').value || '').trim();
      const motDePasse = document.getElementById('identifiantMotDePasse').value || '';
      try {
        const r = await ipcRenderer.invoke('identifiants:enregistrer', hote, login, motDePasse);
        if (r && r.ok) {
          document.getElementById('identifiantMotDePasse').value = '';
          showToast(_('Identifiant enregistré pour {host} (chiffré, partagé entre profils)', { host: hote }), 'success');
          rafraichirIdentifiants();
        } else if (r && r.erreur === 'chiffrement-indisponible') {
          showToast(_('Chiffrement du système indisponible : identifiant non enregistré'), 'error');
        } else {
          showToast(_('Enregistrement impossible : hôte, login ou mot de passe invalide'), 'error');
        }
      } catch (e) {
        showToast(_('Enregistrement impossible : {error}', { error: e && e.message }), 'error');
      }
    });

    // --- Sauvegarde complète (issue #329) -----------------------------------
    // Modal de mot de passe partagé création/restauration. Le mot de passe ne
    // transite que par l'IPC : jamais dans iao.log, jamais en clair sur disque ;
    // il chiffre les secrets du zip (AES-256-GCM, voir main.js).
    let sauvegardeMode = 'creer';
    function ouvrirSauvegardeModal(mode) {
      sauvegardeMode = mode;
      const creation = mode === 'creer';
      document.getElementById('sauvegardeTitre').textContent = creation
        ? _('Créer une sauvegarde complète')
        : _('Restaurer une sauvegarde complète');
      document.getElementById('sauvegardeConfirmeBloc').style.display = creation ? '' : 'none';
      document.getElementById('sauvegardeAide').textContent = creation
        ? _('Ce mot de passe protège les mots de passe de messagerie du zip : sans lui, ils sont perdus. Notez-le.')
        : _('Celui choisi à la création de cette sauvegarde.');
      document.getElementById('sauvegardeMdp').value = '';
      document.getElementById('sauvegardeMdp2').value = '';
      document.getElementById('sauvegardeModal').classList.add('open');
      setTimeout(() => document.getElementById('sauvegardeMdp').focus(), 50);
    }
    function fermerSauvegardeModal() {
      document.getElementById('sauvegardeModal').classList.remove('open');
    }

    async function validerSauvegarde() {
      const mdp = document.getElementById('sauvegardeMdp').value;
      if (!mdp) { showToast(_('Choisissez un mot de passe de sauvegarde'), 'error'); return; }
      if (sauvegardeMode === 'creer' && mdp !== document.getElementById('sauvegardeMdp2').value) {
        showToast(_('Les deux mots de passe ne correspondent pas'), 'error');
        return;
      }
      fermerSauvegardeModal();
      if (sauvegardeMode === 'creer') {
        const res = await ipcRenderer.invoke('sauvegarde-complete:creer', mdp);
        if (res.canceled) return;
        if (res.error) {
          showToast(_('Échec de la création de la sauvegarde'), 'error');
          return;
        }
        showToast(_('Sauvegarde créée : {count} fichiers', { count: res.entrees }), 'success');
        dbg('sauvegarde', 'créée : ' + res.filePath);
      } else {
        const res = await ipcRenderer.invoke('sauvegarde-complete:restaurer', mdp);
        if (res.canceled) return;
        if (res.error === 'mot_de_passe_faux') {
          showToast(_('Mot de passe de la sauvegarde incorrect'), 'error');
          return;
        }
        if (res.error) {
          showToast(_('Échec de la restauration'), 'error');
          return;
        }
        // Les données (dont les sessions Chromium) sont remplacées : seul un
        // redémarrage les rouvre proprement.
        showToast(_('Sauvegarde restaurée — IAO va redémarrer'), 'success');
        setTimeout(() => window.iaoAPI.ipcInvoke('app:relaunch'), 900);
      }
    }

    document.getElementById('sauvegardeCreer').addEventListener('click', function() { ouvrirSauvegardeModal('creer'); });
    document.getElementById('sauvegardeRestaurer').addEventListener('click', function() { ouvrirSauvegardeModal('restaurer'); });
    document.getElementById('sauvegardeAnnuler').addEventListener('click', fermerSauvegardeModal);
    document.getElementById('sauvegardeValider').addEventListener('click', function() { validerSauvegarde(); });

    let loadedLanguage = 'auto';
    async function loadSettings() {
      try {
        var settings = await ipcRenderer.invoke('settings:load');
        applySettings(settings);
        renderAccounts(); // bouton webmail selon le réglage (issue #201)
        // Remplir les champs du modal
        document.getElementById('settingsEditorFontSize').value = settings.editorFontSize;
        document.getElementById('settingsTheme').value = settings.theme;
        document.getElementById('settingsEditorWordWrap').value = settings.editorWordWrap;
        document.getElementById('settingsConfirmTabClose').checked = settings.confirmTabClose;
        document.getElementById('settingsShowAutomationWindows').checked = settings.showAutomationWindows;
        document.getElementById('settingsStartWithLastSession').checked = settings.startWithLastSession;
        // Issue #305 : capture HAR des 15 premières minutes d'une connexion.
        document.getElementById('settingsHarCapture').checked = settings.harCapture === true;
        document.getElementById('settingsMailPrefix').value = settings.mailPrefix || '';
        document.getElementById('settingsMailDomain').value = settings.mailDomain || '';
        document.getElementById('settingsWebmailUrl').value = settings.webmailUrl || '';
        // Issue #357 : URL de l'API de messagerie ; la clé n'est jamais
        // affichée (champ vidé, la saisie remplace la clé du coffre).
        document.getElementById('settingsMailApiUrl').value = settings.mailApiUrl || '';
        document.getElementById('settingsMailApiKey').value = '';
        document.getElementById('settingsOngletFixeActif').checked = settings.ongletFixeActif === true;
        document.getElementById('settingsOngletFixeUrl').value = settings.ongletFixeUrl || '';
        appliquerOngletFixe(settings); // issue #338
        loadedLanguage = settings.language || 'auto';
        const langSelect = document.getElementById('settingsLanguage');
        if (langSelect && langSelect.querySelector('option[value="' + loadedLanguage + '"]')) langSelect.value = loadedLanguage;
        // Onglets de la session précédente (lot 18/09/2026, issues #317/#318).
        handleStartupTabs(settings.startWithLastSession === true);
      } catch (e) {
        showToast(_('Impossible de charger les réglages'), 'error');
      }
    }

    async function saveSettings() {
      var raw = {
        editorFontSize: parseInt(document.getElementById('settingsEditorFontSize').value, 10),
        editorWordWrap: document.getElementById('settingsEditorWordWrap').value,
        theme: document.getElementById('settingsTheme').value,
        confirmTabClose: document.getElementById('settingsConfirmTabClose').checked,
        showAutomationWindows: document.getElementById('settingsShowAutomationWindows').checked,
        startWithLastSession: document.getElementById('settingsStartWithLastSession').checked,
        harCapture: document.getElementById('settingsHarCapture').checked,
        language: (document.getElementById('settingsLanguage') || { value: loadedLanguage }).value,
        mailPrefix: document.getElementById('settingsMailPrefix').value,
        mailDomain: document.getElementById('settingsMailDomain').value,
        webmailUrl: document.getElementById('settingsWebmailUrl').value,
        mailApiUrl: document.getElementById('settingsMailApiUrl').value,
        ongletFixeActif: document.getElementById('settingsOngletFixeActif').checked,
        ongletFixeUrl: document.getElementById('settingsOngletFixeUrl').value
      };
      // Issue #338 : onglet fixe coché sans adresse https valide -> rien n'est enregistré.
      if (raw.ongletFixeActif && !window.normalizeOngletFixeUrl(raw.ongletFixeUrl)) {
        showToast(_('Adresse du premier onglet invalide : une adresse https:// est attendue'), 'error');
        return;
      }
      try {
        var result = await ipcRenderer.invoke('settings:save', raw);
        if (result && result.ok) {
          applySettings(result.settings);
          renderAccounts(); // bouton webmail selon le réglage (issue #201)
          appliquerOngletFixe(result.settings); // issue #338
          // Issue #357 : la clé de l'API saisie part au coffre chiffré (jamais
          // dans settings.json) ; vide = clé actuelle conservée.
          const cleApi = document.getElementById('settingsMailApiKey').value;
          if (cleApi) {
            const r = await ipcRenderer.invoke('secrets:set', 'mail_api', cleApi).catch(e => ({ ok: false, erreur: e && e.message }));
            if (!r || !r.ok) showToast(_('Clé de l\'API non enregistrée : le trousseau du système est indisponible'), 'warning');
          }
          const languageChanged = result.settings.language !== loadedLanguage;
          loadedLanguage = result.settings.language;
          showToast(languageChanged
            ? _('Réglages enregistrés — la langue sera appliquée au prochain démarrage')
            : _('Réglages enregistrés'), 'success');
          closeSettingsModal();
        } else {
          showToast(result && result.error ? result.error : _('Erreur lors de la sauvegarde'), 'error');
        }
      } catch (e) {
        showToast(_('Erreur lors de la sauvegarde des réglages'), 'error');
      }
    }
    window.saveSettings = saveSettings;

    async function refreshScheduler() {
      // Issue #199, lot 4 : le suivi des tâches est indépendant de l'état de
      // l'ancien ordonnanceur — il se rafraîchit même si scheduler:get-state
      // échoue (le service des tâches est un processus séparé du scheduler).
      refreshTachesUI();
      let state;
      try { state = await ipcRenderer.invoke('scheduler:get-state'); }
      catch (e) { console.error('[scheduler] état indisponible :', e); return; }
      if (state && state.error) { console.error('[scheduler]', state.error); return; }
      renderSchedulerState(state);
    }

    function renderSchedulerState(state) {
      var cfg = state.config;
      // Issue #199, lot 1 : ancien flux masqué sauf IAO_ORDONNANCEUR_ANCIEN=1.
      var ancien = state.ancienFlux !== false;
      document.getElementById('schedLegacy').hidden = !ancien;
      document.getElementById('schedRun').hidden = !ancien;
      // Issue #199, lot 4 : interface des tâches programmables (remplace le
      // bandeau « en cours de développement » du lot 1, désormais obsolète).
      document.getElementById('schedTaches').hidden = ancien;
      document.getElementById('schedLegacyOff').hidden = true;
      // Sous-titre adapté au flux actif (msgids marqués N_(), traduits au
      // rendu — le catalogue charge après app.js).
      var SOUS_TITRES_ORDONNANCEUR = {
        ancien: N_('Détection des ZIP livrés par les onglets IA, reprise par profil.'),
        taches: N_('Tâches programmables : envoyez un prompt à Claude à date fixe ou périodiquement.')
      };
      document.getElementById('schedSubtitle').textContent =
        _(ancien ? SOUS_TITRES_ORDONNANCEUR.ancien : SOUS_TITRES_ORDONNANCEUR.taches);
      // Issue #181 : bouton explicite, l'ordonnanceur ne démarre jamais seul.
      var startStop = document.getElementById('schedStartStopBtn');
      startStop.textContent = cfg.enabled ? _('Arrêter') : _('Démarrer');
      startStop.dataset.enabled = cfg.enabled ? '1' : '0';
      startStop.classList.toggle('btn--primary', !cfg.enabled);
      var runState = document.getElementById('schedRunState');
      runState.textContent = cfg.enabled ? _('En marche') : _('Arrêté');
      runState.classList.toggle('sched-run__state--on', !!cfg.enabled);
      document.getElementById('statSchedActive').textContent = state.counters.active;
      document.getElementById('statSchedWaiting').textContent = state.counters.waiting;
      document.getElementById('statSchedDelivered').textContent = state.counters.deliveredToday;

      document.getElementById('schedMaxJobs').value = cfg.maxConcurrentJobs;
      document.getElementById('schedMinDelay').value = cfg.minDelayBetweenAutomationsMinutes;
      document.getElementById('schedThreshold').value = cfg.profileAgeThresholdHours;
      document.getElementById('schedDownloadsDir').textContent = cfg.downloadsDir || _('(dossier de téléchargements du système)');
      document.getElementById('schedDeliveryDir').textContent = cfg.deliveryDir || _('(non défini)');

      // Projets & tâches (lot 18/09/2026, point 6)
      renderProjects(state.projects || []);

      const list = document.getElementById('schedJobsList');
      if (!state.jobs.length) {
        list.innerHTML = '<div class="sched-empty">' + escapeHtml(_('Aucun job pour l\'instant — un ZIP téléchargé depuis un onglet IA (ordonnanceur activé) en créera un automatiquement.')) + '</div>';
      } else {
        list.innerHTML = state.jobs.map(j => {
          const label = SCHED_STATUS_LABELS[j.status] ? _(SCHED_STATUS_LABELS[j.status]) : j.status;
          const color = SCHED_STATUS_COLORS[j.status] || 'var(--fg-muted)';
          const actions = [];
          if (j.status === 'COMPLETED') {
            actions.push(`<button class="btn" data-action="sched-continue" data-job="${escapeHtml(j.id)}">${escapeHtml(_('Continuer le projet'))}</button>`);
            actions.push(`<button class="btn" data-action="sched-deliver" data-job="${escapeHtml(j.id)}">${escapeHtml(_('Marquer livré'))}</button>`);
          }
          if (['RUNNING', 'RESUME_REQUIRED', 'WAITING_FOR_PROFILE'].includes(j.status)) {
            actions.push(`<button class="btn" data-action="sched-pause" data-job="${escapeHtml(j.id)}">${escapeHtml(_('Pause'))}</button>`);
          }
          if (j.status === 'PAUSED' || j.status === 'WAITING_FOR_PROFILE') {
            actions.push(`<button class="btn" data-action="sched-resume" data-job="${escapeHtml(j.id)}">${escapeHtml(_('Reprendre'))}</button>`);
          }
          if (j.status === 'ERROR') {
            actions.push(`<button class="btn" data-action="sched-retry" data-job="${escapeHtml(j.id)}">${escapeHtml(_('Relancer'))}</button>`);
          }
          if (j.file_path || j.outputZip) {
            actions.push(`<button class="btn" data-action="sched-open-zip" data-job="${escapeHtml(j.id)}">${escapeHtml(_('Ouvrir le ZIP'))}</button>`);
            // Lot 18/09/2026 : analyse de complétude — lit le FEATURES.md du ZIP
            // et compte les cases restantes (parseFeaturesMd, scheduler/core.js).
            actions.push(`<button class="btn" data-action="sched-analyze" data-job="${escapeHtml(j.id)}">${escapeHtml(_('Analyser la complétude'))}</button>`);
          }
          const fileName = j.file_path ? String(j.file_path).split(/[\\/]/).pop() : null;
          return `
            <div class="sched-job">
              <div class="sched-job__dot" data-dot-color="${color}"></div>
              <div class="sched-job__body">
                <div class="sched-job__title">${escapeHtml(j.id)} — ${escapeHtml(j.service || _('service inconnu'))} · ${escapeHtml(j.profile ? window.iaoProfilCompte.libelleProfil(j.profile, accounts) : '—')}</div>
                <div class="sched-job__meta">${escapeHtml(label)} · ${escapeHtml(_('tentative {n}', { n: j.attempts || 1 }))}${fileName ? ' · ' + escapeHtml(fileName) : ''}</div>
                ${actions.length ? `<div class="sched-job__actions">${actions.join('')}</div>` : ''}
              </div>
            </div>
          `;
        }).join('');
        applyDataColors(list); // lot 9 : couleurs dynamiques (job dots)
      }

      const log = document.getElementById('schedLog');
      log.innerHTML = state.log.length
        ? state.log.map(l => `<div>[${escapeHtml(new Date(l.ts).toLocaleTimeString('fr-FR'))}] ${escapeHtml(l.message)}</div>`).join('')
        : '<div class="sched-empty-log">' + escapeHtml(_('Aucune activité enregistrée.')) + '</div>';

      hydrateIcons(document.getElementById('schedulerModal'));
    }

    document.getElementById('schedStartStopBtn').addEventListener('click', async (e) => {
      try {
        const res = await ipcRenderer.invoke('scheduler:set-enabled', e.currentTarget.dataset.enabled !== '1');
        if (res && res.error) throw new Error(res.error);
        refreshScheduler();
      } catch (err) { showToast(_("Impossible de modifier l'état de l'ordonnanceur"), 'error'); }
    });

    function bindSchedNumberInput(id, key) {
      document.getElementById(id).addEventListener('change', async (e) => {
        const value = Number(e.target.value);
        try {
          const res = await ipcRenderer.invoke('scheduler:set-config', { [key]: value });
          if (res && res.error) throw new Error(res.error);
          refreshScheduler();
        } catch (err) { showToast(_('Configuration non enregistrée'), 'error'); }
      });
    }
    bindSchedNumberInput('schedMaxJobs', 'maxConcurrentJobs');
    bindSchedNumberInput('schedMinDelay', 'minDelayBetweenAutomationsMinutes');
    bindSchedNumberInput('schedThreshold', 'profileAgeThresholdHours');

    document.getElementById('schedPickDownloads').addEventListener('click', async () => {
      try {
        const res = await ipcRenderer.invoke('scheduler:pick-downloads-dir');
        if (res && res.error) throw new Error(res.error);
        refreshScheduler();
      } catch (e) { showToast(_('Sélection du dossier impossible'), 'error'); }
    });
    document.getElementById('schedPickDelivery').addEventListener('click', async () => {
      try {
        const res = await ipcRenderer.invoke('scheduler:pick-delivery-dir');
        if (res && res.error) throw new Error(res.error);
        refreshScheduler();
      } catch (e) { showToast(_('Sélection du dossier impossible'), 'error'); }
    });

    // Délégation d'événements (chantier A) : un seul listener sur le conteneur,
    // pas de onclick avec donnée interpolée dans le HTML généré ci-dessus.
    document.getElementById('schedJobsList').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const jobId = btn.getAttribute('data-job');
      const action = btn.getAttribute('data-action');
      // Lot 18/09/2026 : analyse de complétude — pas un simple relais IPC, on
      // affiche le résultat dans un toast plutôt que de juste rafraîchir la liste.
      if (action === 'sched-analyze') {
        try {
          const res = await ipcRenderer.invoke('scheduler:analyze-completeness', jobId);
          if (res && res.error) { showToast(res.error, 'error'); return; }
          if (res && res.analysis) {
            const a = res.analysis;
            const msg = a.complete
              ? _('Projet terminé : {done}/{total} tâches faites, 0 restante.', { done: a.done, total: a.total })
              : _('{pending} à faire, {inProgress} en cours, {done} faite(s) sur {total} au total.', { pending: a.pending, inProgress: a.inProgress, done: a.done, total: a.total });
            showToast(msg, a.complete ? 'success' : 'warning');
          }
        } catch (err) { showToast(_('Analyse impossible : {error}', { error: err.message || err }), 'error'); }
        return;
      }
      const channelByAction = {
        'sched-continue': 'scheduler:continue-project',
        'sched-deliver': 'scheduler:mark-delivered',
        'sched-pause': 'scheduler:pause-job',
        'sched-resume': 'scheduler:resume-job',
        'sched-retry': 'scheduler:retry-job',
        'sched-open-zip': 'scheduler:open-zip'
      };
      const channel = channelByAction[btn.getAttribute('data-action')];
      if (!channel) return;
      try {
        const res = await ipcRenderer.invoke(channel, jobId);
        if (res && res.error) { showToast(res.error, 'error'); return; }
        refreshScheduler();
      } catch (err) { showToast(_('Action impossible : {error}', { error: err.message || err }), 'error'); }
    });

    // --- Projets & tâches (lot 18/09/2026, point 6) ---
    // Affichage et gestion des projets dans le panneau Ordonnanceur.
    // Les tâches ne peuvent être assignées qu'aux comptes verts (plus de 5h
    // d'inactivité) — voir getAssignableAccounts (lib/activity-status.js).
    function renderProjects(projects) {
      var list = document.getElementById('schedProjectsList');
      if (!projects || !projects.length) {
        list.innerHTML = '<div class="sched-empty">' + escapeHtml(_('Aucun projet pour l\'instant.')) + ' <button class="btn sched-create-btn" data-action="sched-create-project">' + escapeHtml(_('Créer un projet')) + '</button></div>';
        return;
      }
      list.innerHTML = projects.map(function(p) {
        var tasks = p.tasks || [];
        var taskHtml = tasks.length ? tasks.map(function(t) {
          var statusLabel = {
            pending: _('En attente'), assigned: _('Assignée'), running: _('En cours'),
            completed: _('Terminée'), failed: _('Échouée')
          }[t.status] || t.status;
          var statusColor = {
            pending: 'var(--fg-muted)', assigned: 'var(--warning)',
            running: 'var(--accent)', completed: 'var(--status-idle)',
            failed: 'var(--danger)'
          }[t.status] || 'var(--fg-muted)';
          // Bouton « Lancer » pour les tâches assignées (automatisation Claude)
          var launchBtn = (t.status === 'assigned' && t.assignedProfile)
            ? '<button class="btn sched-task-btn" data-action="sched-execute-task" data-project="' + escapeHtml(p.id) + '" data-task="' + escapeHtml(t.id) + '">' + escapeHtml(_('Lancer')) + '</button>'
            : '';
          // Bouton « Voir résultat » pour les tâches terminées
          var resultBtn = (t.status === 'completed' && t.result)
            ? '<button class="btn sched-task-btn" data-action="sched-view-result" data-project="' + escapeHtml(p.id) + '" data-task="' + escapeHtml(t.id) + '">' + escapeHtml(_('Résultat')) + '</button>'
            : '';
          return '<div class="sched-job sched-job--task">' +
            '<div class="sched-job__dot sched-job__dot--mt3" data-dot-color="' + statusColor + '"></div>' +
            '<div class="sched-job__body">' +
            '<div class="sched-job__title sched-task-title">' + escapeHtml(t.id) +
            (t.assignedProfile ? ' → ' + escapeHtml(t.assignedProfile) : '') +
            ' <span class="sched-task-status" data-status-color="' + statusColor + '">' + escapeHtml(statusLabel) + '</span></div>' +
            '<div class="sched-job__meta">' +
            (t.prompt ? escapeHtml(t.prompt.slice(0, 60)) + (t.prompt.length > 60 ? '…' : '') : '') +
            '</div>' +
            '<div class="sched-job__actions sched-task-actions">' + launchBtn + resultBtn + '</div>' +
            '</div></div>';
        }).join('') : '<div class="sched-task-empty">' + escapeHtml(_('Aucune tâche.')) + '</div>';
        var allowedText = p.allowedAccountIds && p.allowedAccountIds.length
          ? p.allowedAccountIds.map(function(id) {
              var acc = accounts.find(function(a) { return a.id === id; });
              return acc ? escapeHtml(acc.name) : escapeHtml(id);
            }).join(', ')
          : escapeHtml(_('Tous les comptes'));
        return '<div class="sched-job">' +
          '<div class="sched-job__dot sched-job__dot--accent sched-job__dot--mt5"></div>' +
          '<div class="sched-job__body">' +
          '<div class="sched-job__title">' + escapeHtml(p.name) +
          ' <span class="sched-subtitle sched-subtitle--inline">(' + escapeHtml(p.id) + ')</span></div>' +
          '<div class="sched-job__meta">' + escapeHtml(_n('{count} tâche', '{count} tâches', tasks.length, { count: tasks.length })) + ' · ' + escapeHtml(_('Comptes autorisés :')) + ' ' + allowedText + '</div>' +
          '<div class="sched-job__actions">' +
          '<button class="btn" data-action="sched-add-task" data-project="' + escapeHtml(p.id) + '">' + escapeHtml(_('Nouvelle tâche')) + '</button>' +
          '<button class="btn" data-action="sched-assign-task" data-project="' + escapeHtml(p.id) + '">' + escapeHtml(_('Assigner')) + '</button>' +
          '<button class="btn" data-action="sched-delete-project" data-project="' + escapeHtml(p.id) + '">' + escapeHtml(_('Supprimer')) + '</button>' +
          '</div>' +
          taskHtml +
          '</div></div>';
      }).join('') +
      '<div class="sched-project-actions"><button class="btn" data-action="sched-create-project">' + escapeHtml(_('Créer un projet')) + '</button></div>';
      applyDataColors(list); // lot 9 : couleurs dynamiques (job dots, status colors)
    }

    // --- Automatisation Claude (lot 18/09/2026, points 7-8, 10-13) ---
    // Seul Claude est supporté pour l'instant (point 10).
    window.schedDiagnoseClaude = async function(profile) {
      try {
        var res = await ipcRenderer.invoke('scheduler:diagnose-claude', profile);
        if (res && res.error) { showToast(_('Diagnostic Claude : {error}', { error: res.error }), 'error'); return; }
        if (res) {
          var parts = [];
          if (res.continueButton && res.continueButton.found) parts.push(_('« Continuer »'));
          if (res.downloadButton && res.downloadButton.found) parts.push(_('« Télécharger »'));
          if (res.newChatButton && res.newChatButton.found) parts.push(_('« Nouveau »'));
          if (res.chatInput && res.chatInput.found) parts.push(_('zone de chat'));
          if (res.fileUpload && res.fileUpload.found) parts.push(_('envoi de fichier'));
          if (res.quotaMessage && res.quotaMessage.detected) parts.push('QUOTA: ' + res.quotaMessage.time);
          if (res.popups && res.popups.count > 0) parts.push(_n('{count} popup', '{count} popups', res.popups.count, { count: res.popups.count }));
          showToast(_('Claude (« {profile} ») : {details}', { profile, details: parts.length ? parts.join(', ') : _('aucun élément détecté') }));
        }
      } catch (e) { showToast(_('Diagnostic impossible : {error}', { error: e.message }), 'error'); }
    };

    window.schedRunClaudeJob = async function(profile, prompt, sourceZipPath) {
      try {
        var res = await ipcRenderer.invoke('scheduler:run-claude-job', profile, prompt, sourceZipPath);
        if (res && res.error) {
          if (res.error === 'quota_exhausted') {
            showToast(_('Quota gratuit épuisé jusqu\'à {time} pour ce profil.', { time: res.quotaTime }), 'error');
          } else {
            showToast(_('Job Claude échoué : {error}', { error: res.error }), 'error');
          }
          return;
        }
        if (res && res.ok) {
          showToast(_('Prompt envoyé à Claude via {method} (« {profile} »)', { method: res.method, profile }));
        }
      } catch (e) { showToast(_('Job Claude impossible : {error}', { error: e.message }), 'error'); }
    };

    window.schedCollectResponse = async function(profile) {
      try {
        var res = await ipcRenderer.invoke('scheduler:collect-claude-response', profile);
        if (res && res.error) { showToast(_('Collecte impossible : {error}', { error: res.error }), 'error'); return; }
        if (res && res.ok && res.response) {
          showToast(_('Réponse collectée : {count} caractères (« {profile} »)', { count: res.response.length, profile }));
          console.log('[claude] Réponse collectée (« ' + profile + ' »):', res.response);
        } else {
          showToast(_('Aucune réponse trouvée pour le moment.'), 'warning');
        }
      } catch (e) { showToast(_('Collecte impossible : {error}', { error: e.message }), 'error'); }
    };

    // --- Gestion des projets (CRUD) ---
    window.schedCreateProject = async function() {
      var name = prompt(_('Nom du projet :'), _('Projet {n}', { n: Date.now() }));
      if (!name) return;
      try {
        // Pour l'instant, tous les comptes sont autorisés (liste vide = tous)
        var res = await ipcRenderer.invoke('scheduler:create-project', name, []);
        if (res && res.error) { showToast(res.error, 'error'); return; }
        showToast(_('Projet « {name} » créé', { name }));
        refreshScheduler();
      } catch (e) { showToast(_('Création impossible : {error}', { error: e.message }), 'error'); }
    };

    window.schedDeleteProject = async function(projectId) {
      try {
        var res = await ipcRenderer.invoke('scheduler:delete-project', projectId);
        if (res && res.error) { showToast(res.error, 'error'); return; }
        showToast(_('Projet supprimé'));
        refreshScheduler();
      } catch (e) { showToast(_('Suppression impossible : {error}', { error: e.message }), 'error'); }
    };

    window.schedAddTask = async function(projectId) {
      var taskPrompt = window.prompt(_('Prompt de la tâche :'), '');
      if (!taskPrompt) return;
      try {
        var res = await ipcRenderer.invoke('scheduler:create-task', projectId, taskPrompt, null);
        if (res && res.error) { showToast(res.error, 'error'); return; }
        showToast(_('Tâche créée dans le projet'));
        refreshScheduler();
      } catch (e) { showToast(_('Création impossible : {error}', { error: e.message }), 'error'); }
    };

    window.schedAssignTask = async function(projectId) {
      // Récupère les comptes assignables (verts) pour ce projet
      var openAccountIds = tabs.map(function(t) { return t.accId; });
      try {
        var res = await ipcRenderer.invoke('scheduler:get-assignable-accounts', projectId, openAccountIds);
        if (res && res.error) { showToast(res.error, 'error'); return; }
        if (!res || !res.length) {
          showToast(_('Aucun compte vert disponible pour ce projet.'), 'warning');
          return;
        }
        var names = res.map(function(a) { return window.iaoProfilCompte.libelleProfil(a.profile, accounts); });
        var choice = prompt(_('Comptes verts disponibles :') + '\n' + names.map(function(n, i) { return (i+1) + '. ' + n; }).join('\n') + '\n\n' + _('Numéro du compte :'), '1');
        if (!choice) return;
        var idx = parseInt(choice, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= res.length) { showToast(_('Choix invalide'), 'error'); return; }
        var account = res[idx];
        // Demande quelle tâche assigner
        var state = await ipcRenderer.invoke('scheduler:get-state');
        var project = state.projects.find(function(p) { return p.id === projectId; });
        if (!project || !project.tasks || !project.tasks.length) {
          showToast(_('Aucune tâche dans ce projet.'), 'warning');
          return;
        }
        var taskNames = project.tasks.map(function(t) { return t.id + (t.status !== 'pending' ? ' (' + t.status + ')' : ''); });
        var taskChoice = prompt(_('Tâches du projet :') + '\n' + taskNames.map(function(n, i) { return (i+1) + '. ' + n; }).join('\n') + '\n\n' + _('Numéro de la tâche :'), '1');
        if (!taskChoice) return;
        var taskIdx = parseInt(taskChoice, 10) - 1;
        if (isNaN(taskIdx) || taskIdx < 0 || taskIdx >= project.tasks.length) { showToast(_('Choix invalide'), 'error'); return; }
        var task = project.tasks[taskIdx];
        var assignRes = await ipcRenderer.invoke('scheduler:assign-task', projectId, task.id, account.id, openAccountIds);
        if (assignRes && assignRes.error) { showToast(assignRes.error, 'error'); return; }
        showToast(_('Tâche {task} assignée à « {account} »', { task: task.id, account: account.name }));
        refreshScheduler();
      } catch (e) { showToast(_('Assignation impossible : {error}', { error: e.message }), 'error'); }
    };

    // Exécute une tâche assignée : crée un job et lance l'automatisation Claude
    window.schedExecuteTask = async function(projectId, taskId) {
      try {
        showToast(_('Lancement de l\'automatisation Claude...'), 'info');
        var res = await ipcRenderer.invoke('scheduler:execute-task', projectId, taskId);
        if (res && res.error) { showToast(res.error, 'error'); return; }
        if (res && !res.ok) { showToast(res.reason || _('Lancement impossible'), 'warning'); return; }
        showToast(_('Tâche lancée — suivi dans le journal d\'activité'));
        refreshScheduler();
      } catch (e) { showToast(_('Exécution impossible : {error}', { error: e.message }), 'error'); }
    };

    // Affiche le résultat d'une tâche terminée
    window.schedViewResult = async function(projectId, taskId) {
      var state = await ipcRenderer.invoke('scheduler:get-state');
      var project = state.projects.find(function(p) { return p.id === projectId; });
      if (!project) return;
      var task = project.tasks.find(function(t) { return t.id === taskId; });
      if (!task || !task.result) { showToast(_('Aucun résultat disponible'), 'warning'); return; }
      // Afficher dans une fenêtre modale simple
      var modal = document.getElementById('confirmModal');
      var titleEl = modal.querySelector('.modal-card__title');
      var bodyEl = modal.querySelector('.modal-card__body');
      var okBtn = modal.querySelector('[data-confirm]');
      if (titleEl) titleEl.textContent = _('Résultat — {task}', { task: task.id });
      if (bodyEl) bodyEl.innerHTML = '<pre class="sched-result-pre">' + escapeHtml(task.result) + '</pre>';
      modal.classList.add('open');
      modal.dataset.confirmAction = 'close-result';
    };

    // Délégation d'événements pour les actions projets/tâches
    document.getElementById('schedProjectsList').addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var projectId = btn.getAttribute('data-project');
      var taskId = btn.getAttribute('data-task');
      if (action === 'sched-create-project') schedCreateProject();
      else if (action === 'sched-delete-project') schedDeleteProject(projectId);
      else if (action === 'sched-add-task') schedAddTask(projectId);
      else if (action === 'sched-assign-task') schedAssignTask(projectId);
      else if (action === 'sched-execute-task') schedExecuteTask(projectId, taskId);
      else if (action === 'sched-view-result') schedViewResult(projectId, taskId);
    });

    // Pousse un premier instantané des comptes au démarrage : sans ça, main.js
    // n'a aucune info sur les profils tant que l'utilisateur ne modifie pas un
    // compte (saveAccounts n'aurait pas encore été rappelée).
    // Issue #186 : une liste vide au démarrage n'écrase plus l'instantané de
    // l'ordonnanceur ; c'est lui qui permet de restaurer les comptes perdus.
    if (accounts.length > 0) {
      try { ipcRenderer.invoke('scheduler:sync-accounts', accounts).catch(() => {}); } catch (_) { /* ignore */ }
    }

    // Issue #186 : le nombre de comptes lus est écrit dans iao.log. Si
    // l'interface n'en a aucun alors que l'ordonnanceur en connaît, on propose
    // de les restaurer (sessions conservées : partitions persist:<profil>).
    ipcRenderer.invoke('scheduler:accounts-startup', { status: accountsLoadStatus, count: accounts.length })
      .then((res) => {
        if (res && res.offerRestore && Array.isArray(res.accounts) && res.accounts.length > 0 && accounts.length === 0) {
          showSnapshotRestoreUI(res.accounts);
        }
      })
      .catch(() => { /* canal absent : pas de proposition */ });

    // Modale de restauration depuis l'instantané de l'ordonnanceur (#186).
    // textContent uniquement : aucune donnée interprétée en HTML (invariant 1).
    function showSnapshotRestoreUI(restored) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.id = 'snapshotRestore';
      const box = document.createElement('div');
      box.className = 'modal';
      const title = document.createElement('div');
      title.className = 'modal__title';
      title.textContent = _('Comptes retrouvés');
      const desc = document.createElement('div');
      desc.className = 'modal__desc';
      desc.textContent = _("Aucun compte n'a été lu au démarrage, mais IAO en a gardé une copie ({count} compte(s)). Les restaurer ? C'est la même opération qu'importer un fichier d'export : comptes, adresses et sessions des services sont conservés.", { count: restored.length });
      const actions = document.createElement('div');
      actions.className = 'modal__actions';
      const close = () => overlay.remove();
      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = _('Ignorer');
      cancel.addEventListener('click', close);
      const restore = document.createElement('button');
      restore.className = 'btn btn--primary';
      restore.setAttribute('data-role', 'snapshot-restore');
      restore.textContent = _('Restaurer les comptes');
      restore.addEventListener('click', () => {
        close();
        // Issue #311 : restaurer = importer la copie, par le même chemin que le
        // bouton « Importer » (importAccountsJSON : migration, enregistrement,
        // affichage). Aucun traitement propre à la restauration.
        try {
          const count = importAccountsJSON(JSON.stringify(restored));
          dbg('comptes', 'restauration au démarrage : ' + count + ' compte(s) importé(s)');
          showToast(_n('{count} compte restauré', '{count} comptes restaurés', count, { count }));
        } catch (e) {
          console.error('[comptes] échec de la restauration :', e);
          showToast(_('Échec de l\'import : {error}', { error: e.message || e }), 'error');
        }
      });
      actions.appendChild(cancel);
      actions.appendChild(restore);
      box.appendChild(title);
      box.appendChild(desc);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    }

    // Récupération des données (chantier C) : si profils.json (ou, avant
    // migration, ai_accounts) était illisible au
    // démarrage, on propose de restaurer la sauvegarde plutôt que de perdre en
    // silence les comptes de l'utilisateur.
    if (dataCorrupt) showRecoveryUI();

    // Construit et affiche la modale de récupération. Restaure depuis
    // profils.json.bak (ou ai_accounts_backup) si une sauvegarde valide existe,
    // sinon informe simplement.
    // (Fonction déclarée -> hoistée, l'appel ci-dessus la voit.)
    function showRecoveryUI() {
      // Issue #311 : sauvegarde profils.json.bak, ou, pour une installation pas
      // encore migrée, l'ancien ai_accounts_backup du localStorage.
      const b = profilsSauvegarde ? { status: 'ok', data: profilsSauvegarde } : readJSON(BACKUP_KEY);
      const hasBackup = b.status === 'ok' && Array.isArray(b.data);

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      const box = document.createElement('div');
      box.className = 'modal';

      const title = document.createElement('div');
      title.className = 'modal__title';
      title.textContent = _('Données de comptes illisibles');

      const desc = document.createElement('div');
      desc.className = 'modal__desc';
      // textContent (pas innerHTML) : aucune donnée n'est interprétée en HTML.
      desc.textContent = hasBackup
        ? _('La liste de comptes enregistrée est corrompue. Une sauvegarde de {count} compte(s) a été trouvée. La restaurer ?', { count: b.data.length })
        : _("La liste de comptes enregistrée est corrompue et aucune sauvegarde n'est disponible. L'application démarre avec une liste vide ; vos données actuelles ne seront pas écrasées tant que vous ne créez ou ne modifiez pas de compte.");

      const actions = document.createElement('div');
      actions.className = 'modal__actions';
      const close = () => overlay.remove();

      if (hasBackup) {
        const cancel = document.createElement('button');
        cancel.className = 'btn';
        cancel.textContent = _('Ignorer');
        cancel.addEventListener('click', close);

        const restore = document.createElement('button');
        restore.className = 'btn btn--primary';
        restore.textContent = _('Restaurer la sauvegarde');
        restore.addEventListener('click', () => {
          accounts = b.data;
          migrateOldAccounts();   // complète/répare les comptes restaurés
          saveAccounts(accounts); // saveAccounts préserve le backup (valeur actuelle illisible)
          renderAccounts();
          close();
          showToast(_('Comptes restaurés depuis la sauvegarde'));
        });
        actions.appendChild(cancel);
        actions.appendChild(restore);
      } else {
        const ok = document.createElement('button');
        ok.className = 'btn btn--primary';
        ok.textContent = _('Compris');
        ok.addEventListener('click', close);
        actions.appendChild(ok);
      }

      box.appendChild(title);
      box.appendChild(desc);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    }
  }

// ---------------------------------------------------------------------------
// Délégation des actions UI statiques (lot CSP, 18/09/2026)
// ---------------------------------------------------------------------------
// Les anciens attributs inline onclick="fn()" / oninput="fn()" ont été
// convertis en data-action="ui-fn" / data-input-action="fn" : une CSP
// stricte (script-src 'self') interdit les gestionnaires inline. Même
// mécanisme de délégation que le panneau Ordonnanceur (data-action
// "sched-*"), mais au niveau document : ce listener n'exécute QUE les
// actions « ui-* » de la table ci-dessous — les actions sched-* des
// conteneurs spécialisés ne passent jamais par ici. Résolution par nom au
// moment du clic (liste blanche explicite, jamais de chaîne arbitraire).
const UI_ACTIONS = {
  'ui-toggleDashboard': 'toggleDashboard',
  'ui-toggleAllCards': 'toggleAllCards',
  'ui-toggleExplorer': 'toggleExplorer',
  'ui-toggleIdePanel': 'toggleIdePanel',
  'ui-openDevToolsMenu': 'openDevToolsMenu',
  'ui-relaunchDebug': 'relaunchDebug',
  'ui-relaunch': 'relaunchNormal',
  'ui-openPalette': 'openPalette',
  'ui-openModal': 'openModal',
  'ui-openHelpModal': 'openHelpModal',
  'ui-openServicesModal': 'openServicesModal',
  'ui-closeServicesModal': 'closeServicesModal',
  'ui-saveServicesModal': 'saveServicesModal',
  'ui-openSchedulerModal': 'openSchedulerModal',
  'ui-openSettingsModal': 'openSettingsModal',
  'ui-openStatsModal': 'openStatsModal',
  'ui-closeStatsModal': 'closeStatsModal',
  'ui-exportStatsCsv': 'exportStatsCsv',
  'ui-exportStatsJson': 'exportStatsJson',
  'ui-resetStats': 'resetStats',
  'ui-exportAccountsToFile': 'exportAccountsToFile',
  'ui-importAccountsFromFile': 'importAccountsFromFile',
  'ui-selectLocalFolder': 'selectLocalFolder',
  'ui-closeModal': 'closeModal',
  'ui-saveAccount': 'saveAccount',
  'ui-closeDeleteModal': 'closeDeleteModal',
  'ui-confirmDelete': 'confirmDelete',
  'ui-closeImportConfirm': 'closeImportConfirm',
  'ui-confirmImport': 'confirmImport',
  'ui-closeDisconnectModal': 'closeDisconnectModal',
  'ui-confirmDisconnect': 'confirmDisconnect',
  'ui-closeHelpModal': 'closeHelpModal',
  'ui-closeSchedulerModal': 'closeSchedulerModal',
  'ui-closeSettingsModal': 'closeSettingsModal',
  'ui-saveSettings': 'saveSettings',
  'ui-toggleMailPassword': 'toggleMailPassword',
  'ui-generateMailPassword': 'generateMailPassword',
  'ui-openSerieModal': 'openSerieModal',
  'ui-closeSerieModal': 'closeSerieModal',
  'ui-createSerie': 'createSerie'
};
const INPUT_ACTIONS = {
  'filterPalette': 'filterPalette',
  'onFileSearch': 'onFileSearch'
};
document.addEventListener('click', function(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const name = UI_ACTIONS[el.getAttribute('data-action')];
  if (name && typeof window[name] === 'function') window[name]();
});
document.addEventListener('input', function(e) {
  const el = e.target.closest('[data-input-action]');
  if (!el) return;
  const name = INPUT_ACTIONS[el.getAttribute('data-input-action')];
  if (name && typeof window[name] === 'function') window[name]();
});
