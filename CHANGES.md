## Issue #357 — création de comptes de messagerie via mail-accounts-api (31/10/2026)

### Ajouté
- À l'enregistrement d'un compte ou d'une série, si le domaine de l'adresse correspond à
  celui des réglages, IAO essaie de créer la boîte via
  [mail-accounts-api](https://github.com/Mathilde-Team/mail-accounts-api) (nouveau
  `lib/mail-api.js`, client pur : POST `/accounts`, POST `/accounts/batch` atomique avec
  retombée par compte, PATCH `/accounts/{email}`) et tente la connexion au webmail en
  arrière-plan (fenêtre cachée, garde de l'issue #354, 2 s d'écart entre comptes en série).
- Réglages : URL de l'API (`mailApiUrl`) et clé d'API. La clé vit dans le coffre chiffré
  (`mail_api`), jamais en clair dans `settings.json` ; le renderer ne fait aucun appel
  réseau (CSP `default-src 'none'`), tout passe par IPC (`mail-api:creer`,
  `mail-api:creer-lot`).
- 409 avec mot de passe fourni → changement de mot de passe (PATCH) ; le mot de passe
  généré par l'API est enregistré dans le coffre. Retours en toast : créé, existant,
  modifié, lot `{crees}/{existants}/{echecs}`, clé non renseignée, clé refusée, etc.
- i18n : 19 nouvelles chaînes, traduites à la main dans les 30 langues.

### Tests
- `test/mail-api.test.js` (24 tests) ; extensions `test/webmail-connexion.test.js`
  (arrière-plan), `test/settings.test.js` (`mailApiUrl`), `test/main-harness.test.js`
  (canaux IPC).
## Issue #354 — la page de messagerie s'ouvre en arrière-plan au clic sur une IA (31/10/2026)

### Corrigé
- Une page d'IA chargée dans un onglet pouvait ouvrir une fenêtre EN ARRIÈRE-PLAN
  (disposition « background-tab » de `window.open`, typiquement la messagerie
  embarquée du site) : elle apparaissait derrière la fenêtre principale et se
  refermait d'elle-même quelques minutes plus tard, sauf si ouverte
  intentionnellement. Les trois points d'ouverture de fenêtres (webviews des
  onglets, fenêtres filles, fenêtre webmail) refusent désormais cette
  disposition : seule une fenêtre demandée au premier plan s'ouvre. Les
  fenêtres d'authentification (#278) et les pièces jointes du webmail restent
  autorisées comme avant.

### Tests
- `test/webmail-connexion.test.js` : le gestionnaire de la fenêtre webmail
  refuse `background-tab` et laisse passer `foreground-tab`.
- `test/main-window-security.test.js` : le gestionnaire des webviews d'onglet
  refuse une ouverture en arrière-plan, même sur une URL https autorisée.

## Issue #353 — suppression du rond avec le nom de compte (31/10/2026)

### Retiré
- Pastille ronde d'avatar avec les initiales du compte dans les cartes de la
  liste des comptes et dans les résultats de recherche : le nom du compte est
  affiché juste à côté, la pastille n'apportait rien. Les règles CSS
  associées (`.account-avatar`, halo du compte actif) sont retirées avec elle.
  `acc.color` n'est plus utilisé par l'interface (donnée conservée sans effet).

## Issue #349 — harnais : bandeau d'erreur aléatoire après fermeture d'onglet (30/10/2026)

### Corrigé
- C12.1 échouait au hasard (surtout sous charge sur le runner maison) : à la
  fermeture d'un onglet, la mise à jour des flèches de défilement (#339) par le
  ResizeObserver de la barre pouvait écrire le DOM dans la boucle de
  notification, ce que Chromium signale par l'avertissement « ResizeObserver
  loop completed with undelivered notifications » — remonté en bandeau rouge par
  le garde de démarrage, d'où le constat « bandeau d'erreur affiché après
  fermeture ». Deux correctifs complémentaires : la mise à jour passe par
  `requestAnimationFrame` (hors de la frame d'observation, plus de boucle), et
  le garde de démarrage journalise cet avertissement en info sans bandeau
  (même traitement que ERR_ABORTED, #185) — les vraies erreurs JS et réseau
  gardent leur bandeau.

## Issue #339 — flèches de défilement de la barre d'onglets (29/10/2026)

### Ajouté
- Quand la barre d'onglets déborde, des flèches gauche et droite encadrent la
  zone défilante et font défiler les onglets (défilement lissé, ~80 % de la
  zone visible par clic). Masquées quand la barre tient, désactivées à
  l'extrême atteint (la paire reste affichée : la géométrie ne bouge pas).
  Directions valables en LTR comme en RTL (contenu miroir).
- L'onglet fixe (#338) est épinglé hors de la zone défilante (`#tabsBarFixe`) :
  il ne défile jamais et reste visible. `lib/defilement-onglets.js` (pur) :
  état des flèches (LTR et RTL via position normalisée, tolérance aux arrondis
  sous-pixel) et pas de défilement.
- L'onglet activé (clic, ouverture, fermeture d'un voisin) est amené dans la
  partie visible de la zone ; la barre fine de défilement est retirée.
- L'état des flèches suit les redimensionnements de la zone (fenêtre,
  séparateurs de l'explorateur et de l'éditeur) via ResizeObserver.

### Modifié
- `index.html`/`assets/app.css` : la barre devient un conteneur (onglet fixe
  épinglé, flèches, zone défilante `#tabsScrollZone`).

### Tests
- `test/defilement-onglets.test.js` ; harnais Electron : C9.5 (débordement,
  défilement par flèches, onglet fixe immobile, onglet actif ramené, retour à
  l'état).

# Rapport de modifications — IAO (18/09/2026)

## Issue #329 — sauvegarde complète de tout le dossier de données (29/10/2026)

### Ajouté
- Page Réglages, boutons « Sauvegarde complète » : la sauvegarde copie tout ce qui est utile dans le dossier de données (profils, secrets transportables, sessions Chromium, statistiques, capture HAR, historique — sauf les journaux) dans un fichier `iao-sauvegarde-<date>.zip`.
- Les mots de passe de messagerie sont déchiffrés du trousseau puis rechiffrés avec le mot de passe de la sauvegarde (AES-256-GCM) : le fichier est restaurable sur une autre machine ou pour un autre utilisateur, même après une réinstallation.
- La restauration remplace le contenu actuel du dossier de données puis propose de redémarrer IAO.

### Modifié
- Le mot de passe de la sauvegarde n'est jamais écrit en clair ni dans `iao.log` ; sans lui, la sauvegarde ne contient que des données de comptes sans mots de passe. Un mot de passe incorrect est refusé avant qu'aucun fichier ne soit écrasé.
- L'écriture et la lecture du zip sont des fonctions pures sans dépendance npm (`lib/ecriture-zip.js`, `lib/sauvegarde-complete.js`), testées via `node --test` (invariants 7 et 11).

### Vérifié
- `node --test` : 1373 tests, les 9 échecs pré-existants du dev sont inchangés (dialogues de dossier et openZip, déjà documentés).
- `scripts/i18n-update.sh --check` : catalogues synchronisés pour les 30 langues.
- Couverture : `lib/ecriture-zip.js` et `lib/sauvegarde-complete.js` à 100 % (lignes et branches), handlers de `main.js` à 100 % des lignes.

### Tests
- `test/ecriture-zip.test.js` (12) : format zip conforme au lecteur existant (bloc local, répertoire central, offsets, DOS time/date), noms sûrs, plafond ZIP64 injectable.
- `test/sauvegarde-complete.test.js` (10) : chemins retenus/exclus, secrets transportables scrypt+AES-256-GCM (mot de passe faux → null), round-trip, entrées mal formées.
- `test/main-sauvegarde.test.js` (15) : handlers IPC complets — création (annulations, exclusions, secret illisible omis, échec d'écriture) et restauration (mot de passe faux refusé avant toute écriture, rechiffrement au trousseau local, entrée de zip au nom dangereux refusée, fichier non zip).
- `test/main-harness.test.js` : deux canaux IPC `sauvegarde-complete:creer` / `sauvegarde-complete:restaurer` dans la liste de référence.

## Issue #316 — documentation des raccourcis clavier (29/10/2026)

### Ajouté
- `docs/raccourcis.md` : page « Raccourcis clavier » du guide utilisateur — palette `Ctrl+K` (ouverture, `Entrée`, `Échap`), onglets (`Ctrl+Tab` / `Ctrl+Maj+Tab` / `Alt+1..9`), `Ctrl+S` de l'éditeur, et le comportement des touches quand le focus est dans une page IA (webview).
- `mkdocs.yml` : entrée « Raccourcis clavier » dans la navigation du guide utilisateur ; lien depuis la page d'accueil (`docs/index.md`).

### Vérifié
- `mkdocs build --strict` : la nouvelle page est construite, liens valides.

## Issue #335 — licence MIT et version des paquets (27/10/2026)

### Modifié
- `package.json` et `package-lock.json` : licence `ISC` → `MIT`, comme le fichier `LICENSE` (copyright X'o-noth).
- `dist:win` et `dist:linux` ne codent plus `--app-version=1.0.0` : electron-packager prend la version de `package.json`.
- Les paquets gardent `ThirdPartyNotices.txt` de Monaco (exclu jusqu'ici) et `docs/THIRD-PARTY-NOTICES.md` (le reste de `docs/` reste exclu), pour electron-packager et electron-builder.
- `docs/THIRD-PARTY-NOTICES.md` : liste des notices embarquées.

### Vérifié
- `npm run dist:linux` et `electron-builder --linux dir` : licence MIT et version 1.0.0 dans le `package.json` embarqué, `LICENSE`, `docs/THIRD-PARTY-NOTICES.md`, notices Electron/Chromium et Monaco présentes.
- README et `installer/` : README dit MIT, l'installeur ne mentionne pas de licence.

### Tests
- `test/licence-distribution.test.js`.
## Issue #338 — premier onglet fixe (27/10/2026)

### Ajouté
- Réglages : « Ouvrir un premier onglet fixe » et « Adresse du premier onglet » (https). Une adresse invalide est refusée avant enregistrement.
- Onglet en tête de la barre, sans croix ni glisser-déposer ni menu contextuel ; un clic le ramène à l'adresse définie. Décocher le réglage le retire.
- `lib/onglet-fixe.js` : partition `persist:onglet-fixe`, `memeSite()` (même hôte ou sous-domaine, https), `configuration()`, `libelle()`.
- `main.js` : navigations et popups de cet onglet jugées par `memeSite()` ; sortie du site bloquée et journalisée, popup du même site chargée dans l'onglet.
- Les identifiants partagés des réglages (#278) y sont proposés (preload posé sur chaque session).
- Traductions en/de/es/it.

### Tests
- `test/onglet-fixe.test.js`, `test/main-window-security.test.js` (#338), `test/settings.test.js` ; harnais C9.4.

### Limites
- Redirections HTTP vers un autre site non bloquées (connexion par fournisseur tiers possible) ; Ctrl+Tab et Alt+1..9 ignorent l'onglet fixe.
## Issue #333 — le nom de profil n'est plus saisi ni affiché (27/10/2026)

### Modifié
- Le formulaire de compte ne demande plus de « Nom du Profil » : à la création, le profil Electron est tiré du nom du compte (`lib/profil-compte.js` : sans accents, minuscules, `[a-z0-9_-]`, 64 caractères au plus, rendu unique par suffixe `_2`, `_3`…).
- Un compte modifié garde son profil (ses cookies et sessions y sont rangés) ; les anciens comptes sans profil en reçoivent un au démarrage.
- La carte d'un compte n'affiche plus le profil ; l'ordonnanceur, l'historique des tâches et les messages présentent un compte par « nom - adresse mail ».
- Création en série : le profil vaut le numéro du compte (`profil_<n>` si déjà pris).

### Tests
- `test/profil-compte.test.js`, `test/comptes-serie.test.js` ; harnais : C9.1b et contrôle du libellé dans C10.
## Issue #311 (relecture du 27/10/2026) — comptes dans `profils.json` (27/10/2026)

### Modifié
- **Les comptes quittent le localStorage** : nom, adresse, profil, couleur, services,
  cooldowns et automatisation sont dans `<userData>/profils.json`
  (`~/.config/ai-manager`, `%APPDATA%\ai-manager`). `saveAccounts()` (création,
  modification, suppression, import, restauration) l'écrit par le process principal ;
  le localStorage ne garde que l'état de l'interface (onglets, étoiles, ordre, repli).
- **`lib/profils.js`** (nouveau) : lecture tolérante (`absent` / `ok` / `corrompu` /
  `erreur`), écriture atomique (fichier temporaire puis renommage), version précédente
  dans `profils.json.bak`, fichier illisible mis de côté dans `profils.json.illisible`.
- **`main.js`** : canaux synchrones `profils:lire` et `profils:ecrire` (aucun contenu de
  compte journalisé) ; **`preload.js`** : `iaoAPI.profilsLire()` / `profilsEcrire()`.
  Synchrones pour que les comptes soient lus avant le premier affichage et qu'un compte
  créé juste avant une relance soit déjà sur le disque.
- **Migration** : au premier démarrage sans `profils.json`, les comptes du localStorage
  (`ai_accounts`) y sont recopiés, puis les anciennes clés retirées.
- Restauration d'un `profils.json` illisible : depuis `profils.json.bak` (modale
  existante « Données de comptes illisibles »).
- Tests : `test/profils.test.js`, `test/main-accounts.test.js`,
  `test/preload-sandbox.test.js` ; harnais Electron C8.0 (migration, perte du
  localStorage sans perte de compte) et C8.1 (perte de `profils.json`).
- README (emplacement des données), `docs/PROJECT_CONTEXT.md` §5, CLAUDE.md invariant 3.
## Issue #328 — mémoire : seules les sessions des onglets ouverts sont chargées (27/10/2026)

### Corrigé
- **`scheduler/index.js`** (`resolveProfileFromSession`) : à chaque onglet ouvert, le compte
  de l'onglet était cherché par `session.fromPartition('persist:<profil>')` sur chaque
  compte connu, dans l'ordre de la liste, jusqu'au bon. Or cet appel **crée** la session
  (cookies, cache, contexte réseau) quand elle n'existe pas : ouvrir un onglet du dernier
  compte chargeait en mémoire la session de tous les autres. Le compte est maintenant
  reconnu par le dossier de la session de l'onglet (`storagePath`,
  `<userData>/Partitions/<profil>`), sans créer aucune session. La comparaison
  d'origine ne sert plus qu'à une session sans dossier (jamais le cas d'un onglet IAO).
- **`scheduler/core.js`** : `partitionDepuisStoragePath` (fonction pure) relit le nom
  écrit par Electron, en minuscules et encodé façon URL (« Mon Profil » ->
  `mon%20profil`), séparateurs Windows compris.
- Tests : `test/scheduler-branches-coverage.test.js` ; scénario Electron C15.1 (ouvrir
  un onglet du dernier compte ne crée que la session de ce compte ; il échoue sans le
  correctif : session de `profil_3` chargée).

### Non modifié
- L'ancien ordonnanceur (désactivé par défaut depuis #199) surveille encore toutes les
  partitions quand on l'active (`_watchAllPartitions`).
## Issue #331 — préférences de l'interface dans un fichier (27/10/2026)

### Modifié
- Les préférences de l'interface ne sont plus dans le `localStorage` mais dans
  `<userData>/preferences.json` : IA à portée de main, ordre des comptes, onglets
  étoilés, cartes repliées, largeur de l'éditeur et de l'explorateur. Elles survivent
  à la perte du `localStorage`. Seuls les onglets ouverts y restent.
- `lib/preferences.js` (lecture filtrée sur les clés connues, écriture atomique, fichier
  illisible mis de côté dans `preferences.json.illisible`) ; `lib/magasin-preferences.js`
  (même interface que `localStorage` pour `assets/app.js`) ; canaux synchrones
  `preferences:lire` / `preferences:ecrire` exposés par le preload.
- Migration unique : sans `preferences.json`, les clés encore dans le `localStorage` y
  sont recopiées, puis retirées une fois le fichier écrit.

### Testé
- `test/preferences.test.js`, `test/main-accounts.test.js`, `test/preload-sandbox.test.js` ;
  harnais C1.8 (migration, plus rien dans le `localStorage`, choix des IA conservé
  après la perte du `localStorage`).

### Limites
- Les réglages de la fenêtre « Réglages » restent dans `settings.json`, et les comptes
  dans `profils.json` (#311, fusionnée depuis).
## Issue #330 — confirmation de fermeture d'un onglet : option désactivée par défaut (27/10/2026)

### Modifié
- **`lib/settings.js`** : nouvelle clé `confirmTabClose`, `false` par défaut. L'ancienne clé
  `confirmBeforeClose` (activée d'office, jamais demandée) n'est pas reprise : la
  confirmation disparaît aussi sur les installations existantes, et la clé quitte
  `settings.json` au prochain enregistrement des réglages. La case « Confirmer avant de
  fermer un onglet » des réglages la réactive.
- **`assets/app.js`**, **`index.html`** : `closeTab` et la fenêtre des réglages lisent la
  nouvelle clé.
- Tests : `test/settings.test.js`, `test/settings-applied.test.js`,
  `test/main-settings.test.js` ; scénario Electron C12.2 (fermeture directe par défaut,
  confirmation une fois la case cochée).

## Issue #310 (relecture) — codes et liens de connexion reçus par mail (27/10/2026)

### Ajouté
- **`lib/webmail-codes.js`** : tant que la fenêtre webmail d'un compte est ouverte, le
  process principal relève toutes les 10 s la première page de la boîte de réception,
  dans cette fenêtre (requêtes Roundcube `_action=list` puis `_action=viewsource` de la
  page elle-même, jeton `rcmail.env.request_token` : aucun mot de passe ni cookie ne sort
  de la fenêtre ; 5 nouveaux messages au plus par relevé, dédoublonnés par uid). Chaque
  message est analysé sans dépendance (multipart, quoted-printable, base64, en-têtes
  RFC 2047, HTML -> texte) : expéditeur d'un domaine connu d'un des 21 services, reçu
  depuis moins de 15 min, code à 6 chiffres hors liens et adresses (de préférence près de
  « code » / « vérification »), lien de connexion https vers un domaine du même service
  uniquement. Le journal ne contient ni le code ni le lien.
- **Interface** : `webmail:attendre` (attente longue de 25 s, le preload n'expose que
  `invoke`) remet les événements au renderer. Dans l'onglet du service pour ce compte
  (ouvert s'il ne l'est pas et qu'un lien est présent), un bandeau au début de la barre
  « recharger / accueil / déconnecter » affiche le code et un bouton Copier ; si un lien
  est présent, il est ouvert dans l'onglet après 3 s (compte à rebours, bouton Annuler,
  puis « Ouvrir le lien de connexion » à la main). Bandeau retiré après 5 min ou par ×.
  Nouvelles chaînes traduites en anglais, allemand, espagnol et italien.

### Corrigé
- Tâche programmée vers un onglet déjà ouvert : l'échec de `loadURL` (réseau coupé,
  navigation remplacée) était un rejet de promesse non géré qui affichait le bandeau
  « IAO a rencontré un problème » ; il est maintenant journalisé (`[taches]`).

### Limites
- Relevé seulement pendant que la fenêtre webmail du compte est ouverte ; première page de
  la boîte de réception (tri Roundcube par date décroissante supposé).
- Testé sur des sources de mails réelles (Perplexity, Mistral) et une page Roundcube
  simulée, pas sur un serveur Roundcube réel ; l'affichage de la source peut marquer le
  message comme lu selon la configuration du serveur.

### Tests
- `test/webmail-codes.test.js`, `test/webmail-connexion.test.js` (relevé créé, actif
  seulement sur l'hôte du webmail, arrêté à la fermeture), canal `webmail:attendre` dans
  `test/main-harness.test.js` ; couverture 100 %. Harnais Electron : C9.3 (bandeau, lien
  ouvert après 3 s, annulation, événements invalides ignorés).

## Issue #310 — webmail ouvert connecté au compte (26/10/2026)

### Corrigé
- L'enveloppe d'un compte ouvrait le webmail dans le navigateur système, sans compte ni
  mot de passe. **`lib/webmail-connexion.js`** l'ouvre désormais dans une fenêtre IAO sans
  privilèges (sandbox, contextIsolation, partition `persist:<profil>` du compte : une session
  Roundcube par compte, une fenêtre par profil ramenée au premier plan au second clic). Au
  premier chargement d'une page de l'hôte des réglages, le formulaire Roundcube
  (`#rcmloginuser`, `#rcmloginpwd`, `#rcmloginsubmit`) est rempli avec l'adresse du compte et
  le mot de passe du coffre (#201), puis validé ; une seule tentative par fenêtre (un refus
  ne boucle pas). Sans mot de passe enregistré, l'adresse seule est remplie.
- **`lib/coffre-secrets.js`** : `app:open-webmail` reçoit le compte `{ profil, email }` ;
  l'URL reste celle des réglages, le mot de passe est lu dans le coffre par le process
  principal et n'est jamais journalisé. Compte illisible : ouverture dans le navigateur,
  comme avant.
- Tests : `test/webmail-connexion.test.js` (script exécuté dans une page Roundcube simulée,
  fenêtre simulée), `test/coffre-secrets.test.js` ; couverture 100 %.

## Issue #311 — restauration des comptes : adresse e-mail perdue (26/10/2026)

### Corrigé
- L'instantané de l'ordonnanceur (`accounts-snapshot.json`) ne gardait que nom, profil et
  automatisation : les comptes restaurés au démarrage (« Comptes retrouvés », #186) n'avaient
  plus d'adresse et la carte affichait « • <profil> » à la place de l'adresse.
  **`scheduler/index.js`** (`syncAccounts`) garde désormais l'adresse, et
  **`lib/accounts-recovery.js`** (`accountsFromSnapshot`) la restaure ; un ancien instantané
  donne toujours une adresse vide.
- **`assets/app.js`** : sans adresse, la carte n'affiche plus que le profil (plus de
  séparateur orphelin) ; texte de la modale de restauration ajusté (catalogues mis à jour,
  traductions en, de, es, it revues, les autres langues en « fuzzy »).
- Tests : `test/accounts-recovery.test.js`, `test/scheduler-state-config.test.js`, scénario
  Electron C8.1 (adresses restaurées et ligne de la carte).

### Modifié (suite de la relecture : restaurer comme l'import)
- **Copie complète des comptes** `<userData>/comptes-sauvegarde.json`, au format exact du
  fichier d'export, écrite par `syncAccounts` à chaque enregistrement (fichier temporaire puis
  renommage). Elle se suffit à elle-même : nom, adresse, profil, couleur, services, cooldowns,
  automatisation.
- Restauration au démarrage : la copie complète d'abord (`accountsFromBackup`), l'ancien
  instantané partiel seulement à défaut ; l'interface restaure par `importAccountsJSON`,
  exactement comme le bouton « Importer ». Texte de la modale revu (en, de, es, it traduits).
- Tests : `test/accounts-recovery.test.js`, `test/scheduler-state-config.test.js` (format,
  repli, échec d'écriture), C8.1 vérifie aussi noms et couleurs.

## Issues #317 et #318 — relance sans perte, redémarrage normal, onglets proposés (26/10/2026)

### Corrigé
- « Redémarrer en mode debug » appelait `app.exit(0)` juste après `app.relaunch()` sans
  laisser Chromium écrire le localStorage : les comptes créés juste avant étaient perdus, et
  au démarrage suivant l'ancienne liste écrasait l'instantané de l'ordonnanceur. **`main.js`**
  écrit le stockage de la fenêtre principale (`session.flushStorageData()`) avant toute
  relance ; un échec est journalisé et n'empêche pas la relance.

### Ajouté
- Bouton **« Redémarrer IAO »** (canal `app:relaunch`) : relance en mode normal, aussi pour
  quitter le mode debug (`--iao-debug`, `--debug` et `IAO_DEBUG` retirés,
  `normalRelaunchArgs()` dans `lib/startup-diagnostics.js`).
- Au démarrage (relance comprise), les onglets de la session précédente sont proposés
  (« Rouvrir les onglets précédents ? ») quand « Restaurer les onglets ouverts au démarrage »
  est décoché ; coché, ils sont rouverts directement comme avant. Seuls les onglets d'un compte
  encore présent comptent, et la proposition (ou la restauration) n'a lieu qu'une fois : la
  relecture des réglages à l'ouverture de leur fenêtre ne rouvre plus les onglets.
- Tests : `test/main-window-security.test.js`, `test/startup-diagnostics.test.js`, scénarios
  Electron C6.5 et C8.3 ; catalogues mis à jour (en, de, es, it traduits).

## Issue #319 — choix des IA : de 1 à n, plus de cumul au redémarrage (26/10/2026)

### Corrigé
- Après un changement de la sélection « mes 9 IA à portée de main », le démarrage
  **ajoutait** les services actifs à ceux de chaque compte : on retrouvait les 9 anciens plus
  les nouveaux. Les services d'un compte sont désormais exactement la sélection active, dans
  son ordre (`lib/services-actifs.js`, pur, 100 %), au démarrage comme dès l'enregistrement de
  la sélection. Les cooldowns sont conservés.
- Un compte créé (fenêtre « Ajouter un compte » ou création en série) recevait tout le
  catalogue (21 services) au lieu de la sélection active.
- Plus de plafond à 9 (demande de l'issue) : on choisit de 1 à toutes les IA (« Choisir mes IA
  à portée de main ») ; libellés et catalogues mis à jour (en, de, es, it traduits).
- Tests : `test/services-actifs.test.js`, scénarios Electron C1.6 et C1.7.

## Issue #324 — logos des IA, boutons de couleur standard (27/10/2026)

### Ajouté
- **`lib/service-icons.js`** : module pur `iconeService(id, nom, logos?)` qui rend le logo
  officiel d'un service en SVG inline (`aria-hidden`, le nom reste écrit). Tracés repris de
  Lobe Icons (`@lobehub/icons-static-svg` 1.101.0, MIT) et, pour Wolfram, de Simple Icons
  16.36.0 (CC0). Chaque tracé, couleur, opacité, règle de remplissage et `viewBox` est revalidé
  avant rendu ; une valeur inattendue fait refuser le logo. Repli : initiale du nom sur la
  pastille de couleur du service (Leonardo AI et Elicit, sans logo sous licence libre).
- **`docs/THIRD-PARTY-NOTICES.md`** : page des composants tiers (référencée par le README mais
  absente jusqu'ici), ajoutée à la navigation mkdocs.

### Modifié
- Boutons des cartes de comptes : **couleur standard** (fond neutre du thème, plus de couleur
  par service), logo devant le nom (`assets/app.js` `svcIcon`, `assets/app.css` `.svc-ic*`).
- Onglets : logo + nom du compte ; le service passe dans l'infobulle (`.tab__dot` et
  `.tab__acc` supprimés).
- Fenêtres « Comprendre les IA » et « Choisir mes IA » : logo à la place du point de couleur.

### Tests
- `test/service-icons.test.js` (7 tests, 100 % lignes, branches, fonctions) ; harnais
  Electron C5.3 (logos dans boutons, onglets, aide et choix ; boutons de même fond) ;
  `test/activity-status.test.js` adapté au `<span class="svc-btn__nom">`.

### Corrigé (CI)
- Harnais Electron : le renderer s'arrêtait (« crashed », code 133) pendant C7.5 sur les
  runners. Cause mesurée en local avec un `/dev/shm` de 64 Mo (taille par défaut d'un
  conteneur Docker) : la mémoire partagée de Chromium culmine à 58 Mo sur dev et dépasse
  64 Mo avec les logos (3 crashs sur 3). `test-electron/ui-flows.js` active
  `disable-dev-shm-usage` (option Chromium pour les conteneurs) : 0 crash, 57/57.

## Issue #320 — ordonnanceur IA : le prompt est écrit et envoyé (26/10/2026)

### Corrigé
- Le texte était posé dans l'éditeur de Claude (ProseMirror) par `textContent`, que
  l'éditeur ignore : champ vide côté Claude, bouton d'envoi grisé, et pourtant « succès ».
  `buildPromptInjectionScript()` écrit maintenant par `document.execCommand('insertText')`
  (événements natifs, comme au clavier), garde l'ancienne méthode en repli, attend que le
  bouton d'envoi soit actif (5 s) et renvoie un échec explicite (`prompt_not_written`,
  `send_button_disabled`) au lieu d'un faux succès ; l'échec est écrit dans le journal.
- Écriture trop tôt : `runClaudeJob()` attend que la page de l'onglet ouvert par IAO soit
  chargée, au moins 30 s après l'ouverture et 3 s après la fin du chargement (au plus 90 s ;
  `pageOuvertureMs`, `pageStabiliteMs`, `pageAttenteMaxMs`).
- Popups « toujours présentes » après fermeture (détection large) : le script de fermeture
  était exécuté à la place du prompt ; l'écriture est désormais tentée.
- Un compte avec plusieurs onglets (Claude et ChatGPT par exemple) : le script visait le
  dernier onglet ouvert ; il vise l'onglet `claude.ai` du compte, et fermer un autre onglet
  n'oublie plus l'onglet Claude.
- Le moteur des tâches réessaie aussi quand le champ de saisie manque à l'écriture
  (`chat_input_not_found`).

### Ajouté
- Mode debug : bouton **Outils de développement de l'onglet** dans la barre de chaque onglet
  IA (`webview.openDevTools()`), pour voir le champ qui a le focus.
- Tests : `test/scheduler-page-prete.test.js`, script d'écriture exécuté en bac à sable
  (`test/claude-integration.test.js`), scénarios Electron C13.2 (éditeur type ProseMirror) et
  C13.3 ; catalogues mis à jour (en, de, es, it traduits).
- Relecture : le bouton « Outils de développement » de la barre du haut ouvre un **second
  menu** quand un onglet d'IA est actif : « Fenêtre IAO » ou « Page de l'IA : <service> —
  <compte> » (`openDevToolsMenu`), sans exiger le mode debug ; sans onglet actif, il ouvre
  directement ceux de la fenêtre IAO. Ctrl+Maj+I inchangé. Scénario Electron C13.4.

## Issue #305 — capture HAR des 15 premières minutes d'une connexion (25/10/2026)

### Ajouté
- **`lib/har.js`** : module pur d'enregistrement HAR 1.2 à partir des événements CDP
  `Network.*` (`requestWillBeSent`, `responseReceived`, `loadingFinished`,
  `loadingFailed`). Fenêtre de capture de 15 minutes (horloge injectée), quota de
  2 000 entrées, corps de réponses relus à la finalisation via une dépendance
  injectée (un corps illisible n'empêche pas le reste), corps tronqués au-delà de
  512 Ko, redirections = une entrée par `requestWillBeSent`, sauvegarde dans
  `<dossier de données>/har/<hôte>-<horodatage>.har`. Toutes les dépendances sont
  injectées (horloge, lecture de corps, écriture, journal) : testé par `node --test` à
  100 % de couverture lignes/branches/fonctions.
- **`main.js`** : câblage minimal sur `did-attach-webview` — si le réglage
  « harCapture » est actif, le débogueur CDP est attaché au `guestContents`
  (`Network.enable`), les événements sont transmis au module, et la capture est
  finalisée à la fermeture de l'onglet, au détachement du débogueur ou à l'expiration
  des 15 minutes. Échecs d'attachement (outils de développement déjà ouverts,
  par exemple) journalisés en avertissement, sans interrompre l'onglet.
- **Réglage « harCapture »** (désactivé par défaut) : case à cocher dans le modal
  Réglages (« Enregistrer en HAR les 15 premières minutes de chaque connexion »),
  normalisée par `lib/settings.js`, persistée dans `settings.json`, chaîne ajoutée à
  `lang/messages.pot`. Un HAR contient cookies et jetons : le réglage est volontairement
  opt-in.
- **README** (section données, reprise dans `docs/donnees-et-depannage.md`) :
  emplacement des fichiers, limites, arrêts automatiques et avertissement de
  confidentialité.

## Issue #291 — nom de l'organisation GitHub (24/10/2026)

### Corrigé
- L'ancien nom mal orthographié de l'organisation (sans « l », compte GitHub inexistant) est
  remplacé par `Mathilde-Team` : lien de la dernière release du `README.md`, `mkdocs.yml`
  (`repo_url`, `repo_name`), licence de `docs/developpement.md`, `Report-Msgid-Bugs-To` de
  `scripts/i18n-update.sh` et des 30 catalogues, commentaires.
- **`test/nom-organisation.test.js`** : refuse l'ancien nom dans tous les fichiers suivis.

## Issue #278 — identifiants partagés entre profils, lot 2 : menu au focus + interface réglages (22/10/2026)

### Ajouté
- **`lib/identifiants-preload.js`** : preload de session posé sur toutes les sessions
  (webviews et popups incluses, via `session-created`). Au focus d'un champ de connexion
  (email/texte + mot de passe), signale le process principal (`iao-identifiants:focus`) ;
  reçoit `iao-identifiants:remplir` et remplit le formulaire avec le setter natif + les
  événements `input`/`change` (formulaires contrôlés) — **sans jamais soumettre le
  formulaire ni remplir un champ 2FA** (`one-time-code`, `otp`, `totp`, `new-password`).
  Au focus d'un seul des deux champs, l'autre est découvert dans le même `<form>`
  (l'utilisateur n'a pas à visiter chaque champ). Le mot de passe transite uniquement
  par le main (déchiffrement) puis le preload du destinataire — jamais par le renderer
  hôte de l'application. Hors Electron (`node --test`), le module reste une bibliothèque pure.
- **`lib/identifiants-focus.js`** : proposition d'un **menu natif** (pas d'UI injectée dans
  la page) au focus d'un champ, ancré à la bonne fenêtre (fenêtre fille pour les popups
  d'authentification, suivies via `did-create-window`) et au curseur. Cooldown anti-boucle
  (1,2 s), hôte https uniquement, secrets déchiffrés dans le main et envoyés au seul
  émetteur de l'événement. Au moment du choix, l'origine de l'émetteur est revérifiée :
  si la page a navigué depuis la proposition, rien n'est déchiffré ni envoyé. Le choix
  du menu remplit sans soumettre.
- **Interface Réglages** : section « Identifiants des connecteurs (partagés) » —
  ajout/suppression d'identifiants par hôte, liste par hôte, explication de ce qui est
  partagé (identifiants) et de ce qui ne l'est pas (cookies, 2FA).
- **Harnais d'intégration réel** `test-electron/identifiants-continue.js` (9 tests) :
  fixture servie par interception https (aucun réseau), vrai Chromium — focus signalé,
  remplissage avec événements vus par la page (y compris depuis le focus d'un seul
  champ), 2FA jamais rempli, application réelle (main.js tel quel) : preload posé via
  `session-created`, menu proposé/ancré au curseur, choix du menu (remplissage via le
  coffre si trousseau, sinon refus silencieux), et **popup OAuth réelle** (fenêtre fille
  ouverte par la webview, menu ancré dans SA fenêtre, remplissage dans la fille sans
  toucher à la webview d'origine). `Menu.popup()` y est remplacé par un espion : les
  tests B sont des tests de câblage, le menu natif n'y est pas actionné par un vrai clic.
  Le déchiffrement de bout en bout dépend du trousseau du système : sans trousseau (xvfb),
  le parcours déchiffrement->remplissage n'est pas exécuté et le harnais le note sans
  échouer.

### Modifié
- **`main.js`** : suivi des fenêtres filles des webviews (popups d'authentification) pour
  ancrer le menu dans la bonne fenêtre ; branchement du handler de focus ; pose du preload
  d'identifiants sur chaque session créée ; `lib/identifiants.js` désormais tolérant aux
  entrées stockées sous une forme inattendue (pas un tableau).
- **i18n** : nouvelles chaînes (réglages + notifications), `lang/` régénéré (les nouvelles
  entrées arrivent non traduites, conformément au processus du dépôt).

### Tests
- Harnais `identifiants-continue.js` ajouté à la CI (`npm run test:electron:identifiants`,
  job « Harnais Electron (xvfb) ») ; coffre seedé après main.js (clé du trousseau liée au
  nom de l'application) ; annotation `::warning` si le runner n'a pas de trousseau.
- `test/identifiants-preload.test.js` (20 tests), `test/identifiants-focus.test.js` (12
  tests, dont 4 d'intégration du vrai `main.js` via mock Electron) — 100 % de couverture
  lignes/branches/fonctions sur les deux nouveaux modules (vérifié avec la commande
  `npm run test:coverage` du dépôt sous Node 22, la version de la CI : tous les fichiers
  à 100 %).
- Harnais réel : 9/9 (voir ci-dessus).

## Issue #278 — identifiants partagés entre profils, lot 1 : coffre + IPC (22/10/2026)

### Ajouté
- **`lib/identifiants.js`** : `IdentifiantsPartages` — coffre d'identifiants de connexion
  (login + mot de passe) chiffrés par le trousseau du système (`safeStorage`), stocké dans
  `<userData>/identifiants.json` (écriture atomique, mode 0600), partagé par tous les profils
  pour ne plus ressaisir les identifiants d'un connecteur dans chaque profil. Les cookies
  restent par partition (étanchéité conservée) ; le 2FA vit dans la session/le téléphone.
  Lister ne déchiffre jamais rien ; hôte/login/mot de passe validés, quotas (200 hôtes,
  20 identifiants par hôte) ; si le chiffrement du système n'est pas disponible, refus.
- **IPC** : `identifiants:lister` / `enregistrer` / `obtenir` / `supprimer` (mêmes règles
  d'absorption d'erreurs que le coffre #201).
- Lot 1 (stockage + IPC) ; l'UI de gestion et le remplissage automatique des formulaires
  seront le lot 2.

### Tests
- `test/identifiants.test.js` : 12 tests — chiffrement/déchiffrement, rien en clair sur le
  disque, remplacement sans doublon, quotas, JSON illisible, arguments vides, entrées mal
  formées, IPC (4 canaux + erreurs). Couverture 100 % lignes/branches/fonctions.
- `test/main-harness.test.js` : les 4 nouveaux canaux ajoutés à `MAIN_CHANNELS`.

## Issue #277 — popups d'authentification toujours dans l'application (22/10/2026)

### Corrigé
- **Les popups d'authentification s'ouvrent désormais toujours dans l'application.**
  La liste blanche `ALLOWED_POPUP_HOSTS` renvoyait vers le navigateur système toute
  popup d'origine inconnue : la session de connexion vit dans la partition de la
  webview, la connexion d'un connecteur (context7, tout fournisseur OAuth absent
  de la liste) échouait donc silencieusement. Reproduit : GitHub (dans la liste)
  fonctionnait, context7 non.
- Une fenêtre ouverte par une popup hérite de la même politique (`did-create-window`),
  jamais des privilèges de l'hôte.

### Modifié
- `lib/popup-guard.js` : `decidePopup()` remplace `isAllowedPopup()` /
  `ALLOWED_POPUP_HOSTS`. Toute popup web `https:` (et `about:blank`, ouverte vide
  puis redirigée par certains flux OAuth) est acceptée ; elle s'ouvre avec les
  webPreferences sandboxées de l'invité, sans Node. Les schémas non web (`http:`
  non chiffré, `data:`, `javascript:`, `file:`) restent refusés, journalisés avec
  le host seul, sans repli vers le navigateur système.
- `main.js` : plus aucun `shell.openExternal` dans le filtre des popups des
  webviews ; la fenêtre hôte reste en deny-all total.

### Tests
- `test/pure.test.js` (politique `decidePopup` : https connu/inconnu — dont
  context7 —, `about:blank`, casse du schéma, schémas refusés, URL illisible),
  `test/main-window-security.test.js` (popup https inconnue ouverte dans l'app,
  jamais `openExternal` ; `about:blank` autorisé ; fenêtre enfant `did-create-window`
  couverte avec sa voie d'erreur), `test/claude-integration.test.js` (structure).
  Couverture 100 % lignes/branches/fonctions maintenue sur `lib/popup-guard.js`.

## Issue #275 — analyse de ZIP sans shell (21/10/2026)

### Sécurité
- **Injection de commande corrigée.** `analyzeCompleteness` (appelée à la fin
  de chaque téléchargement de `.zip`) passait le chemin du ZIP et le nom de
  l'entrée FEATURES.md à `unzip` / PowerShell par concaténation : un nom de
  fichier ou d'entrée contenant `$(…)` était exécuté. Reproduit sur `dev`
  (fichier preuve créé), plus reproductible.

### Modifié
- `lib/lecture-zip.js` : lecture du ZIP en JavaScript (répertoire central,
  `zlib` pour « deflate »), sur Linux, macOS et Windows ; plus de `unzip`,
  de PowerShell ni de dossier temporaire. Taille extraite bornée à 1 Mio,
  taille et CRC-32 vérifiés ; ZIP64, multi-volumes et chiffrement refusés.
- `FEATURES.md` reconnu par son nom exact (casse ignorée), dans n'importe
  quel dossier, espaces compris (auparavant jamais trouvé avec une espace).
- Une archive illisible est journalisée dans l'activité (échec silencieux
  auparavant, par exemple sans `unzip` installé).

### Tests
- `test/lecture-zip.test.js` (22 tests, archives fabriquées octet par
  octet) ; `test/scheduler-completeness-coverage.test.js` : tests PowerShell
  simulé remplacés par « aucune commande lancée » (Linux et Windows), nom
  hostile, cause journalisée. Couverture 100 % maintenue.

## Issue #206, lot 4 — faire parler les chiffres (20/10/2026)

### Ajouté
- **Cartes** « Réponses » et « Temps de réponse médian » dans les totaux
  (6 cartes sur deux lignes).
- **Évolution du temps de réponse médian** : histogramme SVG sur les mêmes
  tranches que le temps actif (24 heures ou un jour par barre), échelle en
  secondes sous la minute (paliers 5 à 30 s). `evolutionReponses()` dans
  `lib/stats.js`.
- **Comptes souvent bloqués par un quota** (3 quotas ou plus sur la
  période), avec les comptes à privilégier pour répartir l'usage (les moins
  utilisés, hors comptes bloqués). `comptesSurcharges()`.
- **Export JSON** : réponses et quotas joints (`reponses`, `quotas`, avec le
  nom du compte) ; format `iao-stats-1` inchangé pour les anciens lecteurs.
- 6 libellés traduits dans les 29 langues, dont 2 pluriels (générés par IA,
  relecture humaine attendue) ; 0 entrée floue.
- Tests : `test/stats-lot4.test.js`, scénario Electron C11.6 (avec captures
  si `IAO_CAPTURES_DIR` est défini).
## Issues #52, #58, #59 — diagnostic publiable et carte graphique (20/10/2026)

### Ajouté
- `scripts/diagnostic-demarrage.sh --publier <n>` : après le rapport, demande
  confirmation puis le publie en commentaire de l'issue `<n>` avec `gh`.
  Sans `gh` ou sans connexion, le rapport reste à coller à la main.
- Section « Carte graphique » (lspci, vainfo, `LIBVA_DRIVER_NAME`) et
  compteur « vaInitialize failed » au lancement, pour l'erreur VA-API de #52.
- Options inconnues refusées (code 2).
- Tests : `test/diagnostic-demarrage.test.js` (faux `gh`).
## Issue #206 — temps de réponse et quotas dans la page Statistiques (20/10/2026)

### Ajouté
- **Tableau « Temps de réponse »** par compte et service : nombre de
  réponses, médiane, plus rapide, plus lente (tâches programmables et
  messages envoyés à la main). Colonnes triables.
- **Tableau « Quotas atteints »** par compte et service : nombre de fois et
  heure habituelle (heure locale la plus fréquente).
- Les deux suivent la période choisie (jour, semaine, mois, tout) et sont
  vidés par la remise à zéro.
- 10 libellés traduits dans les 29 langues (générés par IA, relecture
  humaine attendue) ; 0 entrée floue.
- Test : scénario Electron C11.5.
## Issue #206 — temps de réponse des messages envoyés à la main (20/10/2026)

### Ajouté
- **Mesure dans les onglets** : un petit script injecté à chaque chargement
  (`lib/mesure-reponse.js`) note l'heure d'envoi (Entrée dans la zone de
  saisie ou clic sur le bouton d'envoi) et l'heure de fin de génération
  (indicateur « en cours » ou bouton Stop disparu depuis 600 ms). L'appli
  relève ces horodatages toutes les 3 s et les range dans
  `stats/reponses.jsonl`. Seuls des horodatages sortent de la page, jamais
  le texte des questions ni des réponses.
- Services couverts : Claude, ChatGPT, Gemini, Perplexity, Grok, Zeta,
  Mistral, DeepSeek, Qwen. Sélecteurs à valider sur machine réelle
  (`npm run start:debug` journalise « réponse mesurée », catégorie stats).
- Tests : `test/mesure-reponse.test.js`, scénario Electron C13.1.
## Issue #51 — chaînes ajoutées et supprimées dans le rapport CI (20/10/2026)

### Ajouté
- **Résumé du job i18n des PR** : tableau « chaînes avant / après /
  nouvelles / supprimées » et liste des chaînes concernées (contexte et
  pluriel compris), en comparant le `.pot` de la branche cible et celui de
  la PR. Module `lib/i18n-pot-diff.js`, commande `scripts/i18n-diff.js`.
- Test : `test/i18n-pot-diff.test.js`.
## Issue #51 — vrais pluriels gettext (20/10/2026)

### Modifié
- **Compteurs** : les libellés « compte(s) exporté(s) », « tâche(s) »,
  « popup(s) », « service(s) hors cooldown », « 1 jour / {n} jours »… et les
  périodicités des tâches passent par `ngettext` (nouvel assistant `_n()`
  dans `assets/app.js`, mot-clé xgettext `_n:1,2`). Chaque langue applique
  sa règle `Plural-Forms` : russe 1 / 2-4 / 5+ (« 21 день »), arabe 6
  formes (« كل دقيقتين »), polonais, tchèque, roumain…
- « tous les 1 minutes » devient « chaque minute » ; « 1 compte(s) » devient
  « 1 compte sélectionné ».
- 15 pluriels traduits dans les 29 langues (formes générées par IA,
  relecture humaine attendue) ; 0 entrée floue.
- Test : `test/i18n-pluriels.test.js` (nombre de formes = `nplurals`,
  marqueurs de la forme générale, formes choisies dans les `.mo` compilés).

## Issue #7 — signature GPG des sommes de contrôle (20/10/2026)

### Ajouté
- **`release.yml`** : si le secret `IAO_GPG_PRIVATE_KEY` (clé privée
  armurée, `IAO_GPG_PASSPHRASE` facultatif) est défini, `SHA256SUMS.txt` est
  signé (`SHA256SUMS.txt.asc`) et la clé publique `IAO-signature.asc` est
  publiée avec la release. Sans secret, l'étape passe sans signer. Trousseau
  GPG temporaire, supprimé en fin d'étape (runner auto-hébergé intact).
- Test : `test/release-signature.test.js`.

### Reste
- Signature Authenticode de `IAO.exe` (SmartScreen) : certificat payant ou
  Azure Trusted Signing, décision du propriétaire du dépôt.

## Issues #52, #58, #59 — script de diagnostic de démarrage (20/10/2026)

### Ajouté
- **`scripts/diagnostic-demarrage.sh`** : rapport Markdown à coller dans
  l'issue (système, versions, commit, fichiers du dossier de données
  n'appartenant pas au compte courant, lancement contrôlé avec comptage des
  « Failed to delete the database », test de la seconde instance, extrait de
  `iao.log`). Option `--sans-lancer` pour analyser le journal existant. Ne
  modifie rien dans `~/.config/ai-manager`.
- Test : `test/diagnostic-demarrage.test.js`.

## Issue #3 — recette d'install.bat sur Windows en CI (20/10/2026)

### Ajouté
- **Workflow `install-windows.yml`** (runner `windows-latest`, VM GitHub
  vierge) : exécute `scripts/test-install-windows.ps1`, qui enchaîne
  auto-build, installation utilisateur, lancement réel du binaire installé,
  `/desktop`, réinstallation, `/system`, `/uninstall` (données
  `%APPDATA%\ai-manager` préservées), `/uninstall /system`, `/help` et
  option inconnue. Tableau des contrôles dans le résumé du job.
- `test-electron/smoke-packaged.js` fonctionne aussi sous Windows (journal
  lu dans `%APPDATA%\ai-manager`, arrêt par `TerminateProcess` toléré).

### Corrigé
- **PATH utilisateur** : `setx PATH "%PATH%;…"` recopiait le PATH système
  dans le PATH utilisateur et le tronquait à 1024 caractères. Le PATH
  utilisateur est désormais lu et écrit dans le registre (sans doublon), et
  `/uninstall` retire l'entrée IAO.
- **Bureau redirigé (OneDrive)** : `/uninstall` supprime aussi le raccourci
  dans le vrai dossier Bureau de l'utilisateur.
## Issue #51 — vérification visuelle RTL dans le harnais (20/10/2026)

### Ajouté
- **Scénario C7.5 du harnais Electron** (`test-electron/rtl-visuel.js`) :
  l'interface est rendue en français puis en arabe, et le test vérifie :
  - que chaque zone (panneau des comptes, espace de travail, zone IA,
    marque, statistiques, titre, première carte) occupe la position
    miroir avec la même largeur, à 8 px près ;
  - que les libellés gardent le même retrait depuis leur bord de départ ;
  - qu'aucun défilement horizontal ni nouvel élément hors fenêtre
    n'apparaît ;
  - que la poignée éditeur ↔ IA, tirée vers la gauche, élargit le panneau
    en rtl (et le rétrécit en ltr) ;
  - que le profil de luminance par colonne de la capture arabe, retourné,
    ressemble à celui du français (corrélation ≥ 0,8 et supérieure au
    profil non retourné).
- Captures `ui-fr.png`, `ui-ar.png` et `rtl-rapport.json` écrites dans
  `IAO_CAPTURES_DIR`, publiées par la CI dans l'artefact `captures-rtl`.
- Tests unitaires du module de comparaison : `test/rtl-visuel.test.js`.

### Corrigé (défauts trouvés par ce contrôle)
- En arabe, les **notifications** restaient en haut à droite et masquaient
  le panneau des comptes : `inset-inline-end`, entrée animée par la gauche.
- **Bordures, marges et alignements** : passage aux propriétés logiques
  (`border-inline-end`, `margin-inline-start`, `text-align: start/end`…)
  pour le panneau des comptes, la marque, l'éditeur, l'explorateur, les
  tableaux de statistiques, les notifications et les pastilles d'état.
- **Poignées de redimensionnement inversées en rtl** : le sens du glisser
  suit désormais la direction du document.
- Corrélation des captures avant/après correction : 0,418 → 0,944.

## Issue #51 — mise en page de droite à gauche (20/10/2026)

### Ajouté
- **`dir="rtl"` pour l'arabe, l'hébreu, le persan…** : `lib/i18n.js`
  expose `textDirection(locale)` (liste `RTL_LANGUAGES` : ar, he, fa, ur,
  ps, sd, yi, dv, ckb, ug ; sous-tag de région ignoré), appliqué à `<html>`
  par `assets/app.js` au chargement du catalogue.
- L'éditeur de code et les champs e-mail/URL restent écrits de gauche à
  droite (`direction: ltr` sous `[dir="rtl"]`).
- Tests : `test/i18n.test.js` (sens par locale, valeurs invalides) et
  harnais C7.4 (`IAO_LANG=ar` → `rtl`, éditeur `ltr`, retour `ltr` en anglais).
## Tests — attente des jobs sans délai fixe (20/10/2026)

### Corrigé
- **Test instable en CI** : `test/scheduler-automation.test.js` attendait
  2 s fixes la fin d'un job ; sur des runners chargés, le job était encore
  `RUNNING` (échec vu sur la PR #247, sans rapport avec son contenu). Les 7
  attentes fixes sont remplacées par `attendreFinJob()` : interrogation
  toutes les 25 ms jusqu'à la sortie de `RUNNING`, bornée à 15 s. Les tests
  sont aussi plus rapides quand la machine est libre.
## Issue #206 — statistiques d'utilisation, lot 3 (19/10/2026)

### Livré
- **Évolution du temps actif** : histogramme SVG maison (sans dépendance) ;
  24 barres horaires pour « Aujourd'hui », une barre par jour local sinon
  (7 / 30 / 90). Sessions réparties au prorata entre les tranches ;
  graduation ronde (1, 2, 5, 10, 15, 30 min, 1 h…). Libellés échappés.
- **Export CSV / JSON** (historique + onglets ouverts, avec le nom du compte) :
  dialogue d'enregistrement côté process principal (`stats:export`). CSV
  séparé par des points-virgules (Excel en français), guillemets RFC 4180,
  BOM UTF-8 ; cellules commençant par `= + - @`
  préfixées d'une apostrophe (pas d'injection de formule). JSON versionné
  (`format: iao-stats-1`).
- **Remise à zéro** (`stats:reset`) après confirmation : sessions,
  instantané, temps de réponse et quotas (lot 2a, #231) vidés, onglets ouverts relancés à partir de maintenant
  (`suivi.recommencer()`). L'historique des tâches n'est pas touché. La
  confirmation passe désormais au-dessus des autres modales.
- Tests : `test/stats-lot3.test.js` (100 %), main-harness (`stats:export`),
  harnais Electron C11.4 ; traductions en/de/es/it/pt.

## Issue #51 — contrôle réel des marqueurs {…} (revue #229, 20/10/2026)

### Corrigé (suite à la revue des retouches #229 fusionnées)
- **Le contrôle des marqueurs {…} des traductions était sans effet** : il
  comparait le msgid à lui-même. Remplacé par un vrai test permanent
  (`test/i18n-marqueurs.test.js`) : analyseur .po (msgid/msgstr,
  continuations multilignes, échappements) + comparaison des ensembles de
  marqueurs {…} (quantités comprises) sur TOUS les catalogues.
  Le test s'auto-vérifie : un marqueur renommé, supprimé, dupliqué ou
  ajouté est détecté (4 cas couverts).
- **pt : « Converse, redige… » corrigé en « Conversa, redige… »** (la
  correction précédente cherchait une chaîne commençant par « Converse »
  alors que le msgstr complet commence par « O assistente generalista… » —
  le remplacement n'avait pas pris, silencieusement). « Conversa » est la
  3e personne de « conversar », cohérente avec l'italien et l'espagnol.
- `lang/pt.po` + `.mo` recompilé.

## Issue #228 — durcissement du nettoyage Service Worker (revue #223, 20/10/2026)

### Corrigé (suite à la revue du correctif #228 fusionné)
- **`Partitions/` LUI-MÊME peut être un lien symbolique** vers un dossier
  externe : ses enfants sont de vrais répertoires (de la cible) et
  passaient le contrôle unitaire — le nettoyage serait sorti du dossier de
  données. Désormais, un `Partitions/` lié ignore TOUT le scan des
  partitions (seule la fenêtre principale reste couverte).
- **Test d'arborescence réelle avec témoins** : `Partitions` lié vers un
  dossier externe ET une partition enfant liée vers un autre dossier, chacun
  contenant un vrai dossier Service Worker avec fichier témoin — les
  témoins doivent rester (aucune fuite du périmètre).
- **Échec sur le PREMIER dossier** : le dossier récalcitrant est désormais
  testé en TÊTE de liste (fenêtre principale) — preuve que le nettoyage
  continue après l'erreur, pas seulement quand l'erreur arrive en dernier.
- **Commentaire honnête** : le nettoyage a lieu « avant createWindow() » ;
  l'absence d'ouverture de base Chromium plus précoce n'est pas démontrée
  (l'ancien « avant que Chromium ne réouvre ses bases » était trop fort).
- 3 tests ajoutés ; couverture 100 %.

## Issue #206 — lot 2a : durcissement de la mesure (revue, 20/10/2026)

### Corrigé (2 passes de revue sur le lot 2a fusionné, #231)
- **La mesure ne compte que le NOUVEAU texte généré, terminé** :
  - la base de comparaison est capturée AVANT l'envoi (runClaudeJob INJECTE
    le prompt — une réponse rapide peut déjà être présente à la fin de
    l'injection, une baseline post-envoi l'ignorerait jusqu'au délai) ;
  - une réponse est acceptée seulement si (1) différente de la base ET
    (2) génération TERMINÉE : le script de collecte signale `streaming`
    via l'attribut data-is-streaming de Claude.ai (présent pendant la
    génération — même en pause —, retiré à la fin). La stabilité du texte
    seule ne prouvait rien : le texte est tronqué à 5 000 caractères et un
    préfixe identique masquerait une suite qui croît ;
  - une réponse partielle ou un délai dépassé ne produisent jamais de
    « temps de réponse réussi ».
- **Périmètre explicite** : la mesure couvre les envois passant par
  `_executeAutomation` (tâches et relances) ; les appels IPC directs
  `run-claude-job` et les envois manuels dans la webview ne sont pas
  instrumentés.
- **Lecture non destructive** : seule l'absence du fichier (ENOENT) vaut
  « historique vide » ; toute autre erreur de lecture (EIO…) se PROPAGE —
  sinon la notation suivante réécrivait le fichier avec le seul nouvel
  événement et détruisait l'historique (sessions ET événements du lot 2).
  Test : lecture EIO -> notation rejetée, fichier intact, réessai OK.
- **Écritures sérialisées** : reponses.jsonl et quotas.jsonl partent de
  chaînes de promesses distinctes (lecture → réécriture complète) — des
  notations simultanées ne s'écrasaient plus mutuellement (test : 24
  événements notés en parallèle, aucun perdu).
- **Conservation 90 jours tenue** : la purge est PERSISTÉE au chargement
  (fichier réécrit) — un événement expiré restait physiquement dans le
  fichier tant qu'aucune notation n'avait lieu.
- **Quotas : la métrique est un PLAFONNEMENT des détections** (au plus une
  par compte et par heure glissante — la boucle wait_quota re-diagnostique
  le même blocage sans envoyer). Ce n'est ni un comptage d'épisodes réels,
  ni une mesure de durée : `classerComptes` (surchargés) compte des
  détections plafonnées, pas des blocages.
- **Récupération réessayable** : un échec de la récupération des sessions
  (disque plein) n'est plus mémoïsé sur son rejet — sinon tous les appels
  suivants échouaient jusqu'au redémarrage de l'app.
- Délais de poll injectables via la config (`responseTimeoutMs`,
  `responsePollIntervalMs`) : tests rapides et déterministes.
- 8 tests discriminants (concurrence, EIO non destructive, purge persistée,
  échec réessayé, réponse rapide post-injection, texte croissant, préfixe
  5 000 caractères stable, délais dépassés) ; couverture 100 %.

## Issue #206 — statistiques d'utilisation, lot 2 (19/10/2026)

### Livré
- **Heures de pointe** : carte de chaleur jour × heure (heure locale, lundi en
  premier) du temps actif, réparti au prorata des tranches horaires couvertes.
- **Série** de jours consécutifs d'utilisation (en cours et record) ; une
  session à cheval sur minuit compte pour les deux jours.
- **Comptes inutilisés** sur la période, avec la dernière utilisation connue.
- **Tâches programmables par compte** (lien avec #199) : envoyées, quotas,
  erreurs (erreur + non connecté), exécutions, dernier quota et heure de fin
  rapportée. Source : l'historique des tâches (`taches:history`, 200 dernières
  exécutions). Depuis le retrait du bouton « Épuiser » (#136), plus rien
  n'alimente `cooldowns` : les quotas ne viennent que de cet historique.
- **Tri par colonne** de tous les tableaux (clic sur l'en-tête, second clic = sens
  inverse, `aria-sort`).
- `lib/stats.js` : `heuresDePointe`, `comptesInutilises`, `serieJours`,
  `resultatsTaches`, `trierLignes` (100 %, `test/stats-lot2.test.js`) ;
  harnais C11.3 ; traductions en/de/es/it/pt.

## Issue #206 — lot 2a : mesure des temps de réponse et des quotas (20/10/2026)

### Livré
- **La mesure laissée en « reste » par le lot 2** : temps de réponse et quotas.
  - temps de réponse Claude : envoi du prompt -> fin de la génération,
    mesuré dans `_executeAutomation` (le poll de réponse existant) ;
  - quotas atteints : notés quand `runClaudeJob` détecte le quota
    (cooldown) — couvre jobs ET tâches programmables ;
  - tout reste local (`<userData>/stats/reponses.jsonl` et
    `quotas.jsonl`, 90 jours, plafond 130 000 événements par type,
    jamais bloquants pour l'envoi).
- `lib/stats.js` (pur, testé) : `normaliserReponse`/`normaliserQuota`,
  `agregerReponses` (médiane/min/max par compte et service),
  `agregerQuotas` (répartition par heure de la journée),
  `classerComptes` (sous-utilisés / **surchargés** — la moitié
  « surchargés », alimentée par les quotas, est nouvelle) ;
  `purger` généralisé (champ `fin` ou `date`), `parserJsonl` typé.
  (`carteHeures` retirée : doublon de `heuresDePointe` du lot 2.)
- IPC : `stats:noter-reponse`, `stats:noter-quota`, `stats:reponses`,
  `stats:quotas` ; `scheduler.statsStore` câblé dans `main.js`.

## Issue #206 — statistiques d'utilisation, lot 1 (19/10/2026)

### Livré
- **Mesure locale** des sessions d'onglet : durée d'ouverture et **temps actif**
  (onglet au premier plan ET fenêtre IAO au focus), par compte (profil) et par
  service. `lib/stats.js` (pur, 100 %) : suivi, agrégation, JSONL, conservation.
- **Persistance** dans `<userData>/stats/` : `sessions.jsonl` (90 jours, purgé au
  démarrage, lignes abîmées ignorées une à une) et `en-cours.json` (instantané
  des onglets ouverts, synchronisé à chaque fermeture d'onglet et toutes les
  minutes). Fermeture brutale ou page rechargée : les sessions ouvertes sont
  versées à l'historique, perte maximale d'une minute, sans doublon (par id).
- **Page Statistiques** (bouton « graphique » de la barre du haut) : périodes
  Aujourd'hui / 7 / 30 / 90 jours ; totaux (temps actif, durée ouverte,
  sessions) ; tableaux par compte (dernière utilisation) et par service (part
  du temps actif). Une session à cheval sur le début de période n'y compte que
  pour sa partie incluse. Noms échappés (`escapeHtml`).
- Aucune télémétrie, aucun appel réseau ; canaux IPC `stats:sync` et
  `stats:load`. Icône Font Awesome Free 6.5.0 `chart-simple`.
- Tests : `test/stats.test.js` (100 %), harnais Electron C11.1/C11.2 ;
  traductions anglaises.

### Reste (lots suivants de #206)
- Lot 2 : messages envoyés et tâches programmables (lien avec #199).
- Lot 3 : graphiques d'évolution, export CSV/JSON, remise à zéro depuis l'interface.
## Fermeture d'onglet : bandeau « Invalid guestInstanceId » (19/10/2026)

- Fermer un onglet IA chargé affichait le bandeau rouge « IAO a rencontré un
  problème — Invalid guestInstanceId ». Bug d'Electron (suppression d'une
  `<webview>` chargée, electron/electron#54089), corrigé en 43.7.4 : Electron
  passe de 43.7.2 à **43.8.0** (même branche majeure).
- Test de non-régression : harnais Electron C12.1.

## Issue #184 (suite) : nettoyage des Service Worker des partitions (19/10/2026, durci)

### Livré
- **Piste de #184 mise en œuvre (mesure d'atténuation, cause exacte non
  démontrée)** : `cleanupServiceWorkerStorage()` ne nettoyait que le dossier
  `Service Worker` de la fenêtre principale — chaque partition d'onglet
  (`persist:<profile>`, `Partitions/<profile>/`) a le sien. Les partitions
  n'étaient pas couvertes par le nettoyage.
- `dossiersServiceWorkerANettoyer()` (`lib/startup-storage.js`, pur, testé —
  ne lève jamais) : liste les dossiers `Service Worker` existants (fenêtre
  principale + une entrée par partition **réelle**). `main.js` les supprime
  tous AVANT la création de la fenêtre (donc avant l'ouverture des bases
  Chromium) ; journal : une ligne par dossier nettoyé.
- **Durcissement (revue)** : une erreur sur un dossier n'interrompt pas les
  autres (`nettoyerDossiersServiceWorker()`, testé) ; les liens symboliques
  et entrées illisibles de `Partitions/` sont ignorés (périmètre garanti au
  dossier de données) ; un dossier `Local Storage`/`Cookies` n'est jamais
  touché (test sur arborescence réelle).
- **À valider sur la machine de #58/#59** : les rafales doivent disparaître.
  Si elles persistent, la cause est ailleurs (droits — voir #197 — ou verrou
  d'instance) : joindre `logs/iao.log`.

## Issue #51 — i18n : allemand, espagnol, italien, portugais complets (19/10/2026)

### Livré
- **403/403 messages traduits** dans `lang/de.po` (#224), `lang/es.po`
  (#225 — espagnol ajouté aux locales, 30e langue), `lang/it.po` (#226) et
  `lang/pt.po` (#227), lot 4 des tâches (#199) inclus.
- Traductions produites par l'agent (docker25200), chaîne par chaîne,
  terminologie UI cohérente, placeholders `{…}` préservés — **relecture
  humaine attendue** (convention #51, mentionnée dans chaque en-tête de
  catalogue et chaque PR).
- Test LINGUAS mis à jour (30 locales). `msgfmt --check` propre,
  `i18n:check` vert, interface vérifiée dans chaque langue au lancement
  (`IAO_LANG=de|es|it|pt`).

## Issue #199 — lot 4 : interface des tâches programmables (19/10/2026)

### Livré
- **Modale ordonnanceur** : l'interface des tâches remplace le bandeau « en
  cours de développement » du lot 1 — liste des tâches (nom échappé, comptes,
  répartition, périodicité, prochaine exécution, boutons Activer/Désactiver,
  Exécuter maintenant, Modifier, Supprimer avec confirmation), historique
  borné aux 200 derniers événements (libellés traduits : lancée, envoyée,
  quota, heures calmes, non connecté, aucun compte éligible, erreur).
- **Formulaire de création/édition** : nom, comptes (tous ou sélection,
  seuls les comptes avec Claude sont proposés), répartition (tous avec
  espacement en secondes, ou rotation), nouvelle session, prompt,
  programmation (unique `datetime-local` ou périodique N unités), actif.
  Erreurs du service affichées dans le formulaire sans le fermer ; la saisie
  survit au rafraîchissement de 4 s (le formulaire n'est jamais reconstruit
  par le polling). L'édition préserve l'état d'exécution (le service garde
  `derniereExecution`/`indexRotation`) ET les valeurs exactes des champs
  inchangés : un espacement en ms non rond (90050) ou une date à la
  milliseconde ne sont ni arrondis ni tronqués (`preserverValeursNonModifiees`,
  testé). Sous-titre de la modale adapté au flux actif ; dates formatées
  dans la langue active (`document.documentElement.lang`).
- `lib/taches-ui.js` (pur, testé par `test/taches-ui.test.js`) : conversions
  sans perte à la seconde près `datetime-local` <-> ISO (heure locale, jamais
  `toISOString().slice()`), espacement secondes <-> ms, mapping
  formulaire <-> tâche, descripteurs de programmation et résultats. Codes
  d'erreur (pas de français dans le helper) traduits côté app par des
  appels `N_()`/`_()` littéraux.
- **« Exécuter maintenant »** : même chemin que la minuterie — la garde du
  moteur est prise AVANT l'appel au service (`taches:run-now` marque la tâche
  côté service), plan construit par le service (même forme que
  `taches:dues`), exécuté par `creerMoteur` (`lib/taches-runner.js`) :
  minuterie et exécution manuelle partagent la même garde, jamais deux plans
  en même temps. Le résultat arrive par l'historique (`taches:report`),
  jamais fabriqué par l'interface (toast neutre).
- Harnais Electron C10 (8 scénarios) : interface visible, création avec nom
  HTML (échappé), saisie préservée au polling, édition, bascule d'activation,
  exécution manuelle avec envoi réel simulé (canal `scheduler:run-claude-job`
  remplacé côté main, tout le reste réel) jusqu'à l'historique, suppression
  avec confirmation, erreurs de prévalidation ET du service affichées sans
  fermer le formulaire.
- i18n : 79 nouveaux msgid extraits, catalogues régénérés (29 langues,
  nouvelles chaînes non traduites par défaut — à traduire au fil de l'eau).

## Issue #201 — comptes en série, côté IAO (18/10/2026)

### Livré
- **Réglages** : préfixe et domaine des adresses e-mail, adresse du webmail
  (Roundcube) ; normalisés dans `lib/settings.js` (invalide -> non configuré,
  URL http/https seulement).
- **Création en série** (bouton « personnes » de la liste des comptes) : 1 à 50
  comptes, nom = numéro suivant le plus grand existant (noms numériques et
  profils `profil_<n>`), profil `profil_<n>`, e-mail `<préfixe><n>@<domaine>`,
  tous les services ; `lib/comptes-serie.js` (pur, 100 %).
- **Mot de passe de messagerie** : 20 caractères aléatoires
  (`crypto.getRandomValues`, tirage sans biais, sans caractères ambigus),
  généré pour chaque compte de la série ou à la demande (bouton clé) ; masqué
  dans la fenêtre du compte, bouton œil pour l'afficher. Stocké par
  `lib/coffre-secrets.js` : chiffré par `safeStorage` (trousseau du système),
  `<userData>/secrets.json` en 0600, **jamais en clair** ; refusé si le
  chiffrement n'est pas disponible (Linux sans trousseau : backend `basic_text`),
  avec un message.
- **Webmail** : bouton enveloppe sur chaque carte quand l'URL est réglée ;
  copie l'adresse du compte et ouvre le webmail dans le navigateur. Le process
  principal n'ouvre **que l'URL des réglages** (`app:open-webmail`, jamais une
  URL fournie par l'interface).
- Le clic sur l'e-mail copiait déjà l'adresse (#138).
- Icônes Font Awesome Free 6.5.0 ajoutées : `eye`, `eye-slash`, `key`,
  `envelope`, `users`.
- Tests : `comptes-serie`, `coffre-secrets` (100 %), réglages, harnais Electron
  C8.1/C8.2 ; traductions anglaises.

### Reste
- Création des boîtes sur le serveur de messagerie (docker-mailserver, sans
  API HTTP) : petite API à créer dans un autre dépôt, puis appel depuis IAO.

## Issue #203 — état du dossier de données au démarrage (18/10/2026)

Le journal `<userData>/logs/iao.log` existait déjà (#52, #162). Cette ligne y est
écrite à chaque démarrage, **hors mode debug**, pour les bugs signalés avec
journal (#184, #186). Elle complète #196 (comptes lus au démarrage) et #197
(fichiers appartenant à un autre utilisateur) sans les dupliquer.

### Livré
- `lib/startup-storage.js` (pur, fs injecté, 100 %) : dossier utilisé, Local
  Storage (fichiers, octets), partitions et partitions ayant un dossier
  `Service Worker` ; erreurs d'inspection en avertissements, jamais levées.
- Piste #184 : `cleanupServiceWorkerStorage()` ne nettoie que le dossier
  `Service Worker` de la fenêtre principale ; le compte des partitions qui en
  ont un dira s'il faut étendre le nettoyage.
- Tests : `test/startup-storage.test.js`, `main-debug` (#203), harnais Electron
  C1.1b (ligne présente dans le vrai `iao.log`).

## Issue #199 — lot 3 : exécution des tâches programmables (18/10/2026)

### Livré
- `scheduler/taches-service.js` (process principal, 100 % couvert) : tâches dans
  `<userData>/scheduler/taches.json` (écriture atomique), historique borné à 200
  entrées (`taches-historique.json`), création/remplacement/suppression/activation ;
  `dues(comptes)` remet le plan des tâches dues et les marque **exécutées aussitôt**
  (jamais deux départs) ; **heures calmes** 15h–20h30 : rien ne part, la tâche
  reste due ; « Exécuter maintenant » ; comptes exclus notés (service absent,
  profil introuvable) ; canaux IPC `taches:*`.
- `lib/taches-runner.js` (renderer, 100 % couvert) : minuterie toutes les 30 s,
  un plan et un compte à la fois, délais d'espacement, ouverture de l'onglet
  (nouvelle session `claude.ai/new`, rechargée si l'onglet existait), envoi par
  l'automatisation Claude existante (`scheduler:run-claude-job` : diagnostic,
  quota, délai anti-détection), jusqu'à 6 tentatives espacées de 10 s tant que
  la page n'est pas prête, compte rendu (envoyé, quota, heures calmes, non
  connecté, erreur).
- Une tâche ne s'exécute que si IAO est ouvert ; une exécution manquée est
  rattrapée **une fois** à l'ouverture suivante.

### Reste
- lot 4 : interface (liste, édition, « Exécuter maintenant », historique, i18n).

## Issue #199 — lot 1 : ancien ordonnanceur désactivé (18/10/2026)

### Livré
- L'ancien flux (détection des ZIP, jobs, projets) est **désactivé par défaut** :
  `Scheduler.setEnabled(true)` est refusé et journalisé, aucune partition n'est
  surveillée (`will-download`). Le panneau « Ordonnanceur IA » affiche un bandeau
  et masque le bouton Démarrer et les sections de l'ancien flux ; le journal
  d'activité reste visible.
- `IAO_ORDONNANCEUR_ANCIEN=1` (`true`, `yes`, `on`) le réactive (retour arrière,
  tests du code conservé). Code, `jobs.json` et `projects.json` sont conservés.
- `getState()` expose `ancienFlux`. Tests : `test/scheduler-ancien-flux.test.js`,
  harnais Electron C3.4 réécrit (bandeau, refus par IPC) ; les tests de l'ancien
  flux le réactivent explicitement.

## Issue #199 — tâches programmables, lot 2 : cœur pur (18/10/2026)

Remplacement prévu de l'ordonnanceur (ZIP, jobs, projets) par des **tâches
programmables** dans le menu « Ordonnanceur ». Conception validée dans #199.

### Livré
- `scheduler/taches.js` (fonctions pures, 100 % couvert, `test/scheduler-taches.test.js`) :
  - registre **modulaire** de fournisseurs (`enregistrerFournisseur`), Claude seul
    pour commencer (nouvelle session `https://claude.ai/new`) ;
  - `normaliserTache` : nom, fournisseur, comptes (« tous » ou liste de profils),
    répartition (« tous » espacés de N ms, ou « rotation » : un compte par exécution
    à tour de rôle), nouvelle session, prompt, programmation, **inactive à la création** ;
  - programmation « unique » (date/heure) ou « periodique » (toutes les N
    minutes/heures/jours/semaines/mois, minimum 5 minutes) ; `prochaineEcheance` :
    **une** exécution de rattrapage après une absence, jamais de rafale ; mois
    calendaires (31 janvier + 1 mois → fin février) ;
  - `comptesEligibles` (service absent, profil introuvable), `planExecution`.
- Inventaire de couverture (#101) : `scheduler/taches.js` ajouté.

### Reste (lots suivants de #199)
- lot 3 : exécution (minuterie, onglet nouvelle session, envoi du prompt par
  l'automatisation Claude existante, heures calmes 15 h – 20 h 30, historique) ;
- lot 4 : interface (liste, édition, « Exécuter maintenant », historique, i18n 29 langues).

## Issue #187 — mode debug accessible depuis l'application (17/10/2026)

### Livré
- Canal `app:relaunch-debug` (fenêtre principale uniquement) : `app.relaunch()` avec les mêmes
  arguments plus `--iao-debug` (`debugRelaunchArgs()`, `lib/startup-diagnostics.js`), puis
  `app.exit(0)`. Canal `app:log-path` : chemin du journal.
- Bandeau d'erreur de démarrage : bouton « Relancer en mode debug » et chemin du journal.
- Barre du workspace : bouton « Redémarrer en mode debug », masqué quand le mode debug est actif.
- Documentation (README, section Dépannage reprise par MkDocs) : relance depuis l'application,
  que joindre à une issue.
- Tests : unitaires (couverture 100 %), harnais main.js, scénario Electron C6.5.

## Issue #184 — diagnostic du propriétaire des fichiers de données (17/10/2026)

### Hypothèse
`Failed to delete the database: Database IO error` et `Could not open the quota database,
resetting` signifient que Chromium ne peut ni supprimer ni rouvrir ses bases. Hors seconde
instance (déjà empêchée depuis #52), la cause connue est un fichier que le compte courant
ne peut pas modifier, par exemple créé par un lancement en root. Ce cas expliquerait aussi
la perte des comptes de #186.

### Livré
- `lib/data-dir-check.js` (testé, système de fichiers injecté) : parcours borné du dossier de
  données (20 000 entrées, profondeur 6, caches Chromium ignorés), sans aucune modification.
- `main.js` : au démarrage, un `warning` dans `iao.log` donne le nombre de fichiers concernés,
  des exemples et la commande `sudo chown -R "$USER": <dossier>`.
- README (section Dépannage, reprise dans la doc MkDocs).

## Issue #185 — pas de bandeau rouge sur une navigation remplacée (17/10/2026)

### Cause
Sur un service sans compte, le site redirige vers sa page de connexion pendant le
premier chargement. Chromium interrompt la navigation (`ERR_ABORTED`, code -3) et la
promesse interne de la `<webview>` est rejetée sans être rattrapée : le bandeau
« Une opération asynchrone a échoué au démarrage » s'affichait pour une situation normale.

### Livré
- `lib/startup-diagnostics.js` : `isNavigationAbort(err)` reconnaît `ERR_ABORTED` (-3),
  et seulement lui (`ERR_NAME_NOT_RESOLVED`, certificat, hors ligne restent signalés).
- `assets/boot-guard.js` : un rejet `ERR_ABORTED` n'affiche plus de bandeau ; une ligne
  `console.info` est écrite (recopiée dans `logs/iao.log` en mode debug).
- `assets/app.js` : le retour à l'accueil d'un onglet rattrape le rejet de `loadURL()`.
- Tests : unitaires (couverture 100 %), scénario Electron C0.3 (rejet `ERR_ABORTED`
  sans bandeau, vraie erreur réseau avec bandeau).

### Écart avec l'issue
L'issue prévoyait une ligne `info` toujours présente dans le journal. `main.js` ne recopie
le niveau `info` du renderer qu'en mode debug (règle de #162) ; la ligne n'apparaît donc
dans `iao.log` qu'avec `--iao-debug`. Changer cette règle sortirait du périmètre.

## Documentation MkDocs (13/10/2026)

Règle d'équipe Mathilde-Team : documentation navigable MkDocs sur le modèle de Netcross.

### Livré
- `mkdocs.yml` (thème Material, français, navigation explicite, sans `site_url`).
- Pages sous `docs/` : accueil, installation, données et dépannage, langue,
  développement, contexte du projet, travaux à faire, historique.
- Sans copie : les pages incluent des sections du README, `FEATURES.md` et
  `CHANGES.md` (`pymdownx.snippets`, repères invisibles sur GitHub) ; une section
  disparue fait échouer la construction.
- CI : job « Construction (mkdocs build --strict) » sur les runners maison, site
  publié en artefact.
- README : lien « dernière release » en URL absolue (valable dans la doc et sur GitHub).

## Issue #186 — comptes absents au démarrage : journal et restauration (17/10/2026)

### Constat
Journal de #58 (12/10/2026) : au lancement, l'ordonnanceur connaissait ~70 profils
(`<userData>/scheduler/accounts-snapshot.json`), alors que l'interface n'en lisait aucun
dans son `localStorage`. Ensuite, l'interface renvoyait sa liste vide à l'ordonnanceur
et effaçait l'instantané : un import devenait la seule issue. La cause de la perte du
`localStorage` n'est pas reproduite dans le bac à sable.

### Livré
- `lib/accounts-recovery.js` (pur, testé) : `accountsFromSnapshot()` reconstruit les
  comptes (id, nom, profil, automatisation ; doublons de profil écartés) ;
  `startupAccountsReport()` écrit la ligne de journal et décide de la proposition.
- Ordonnanceur : `reportStartupAccounts()` et canal `scheduler:accounts-startup`. La ligne
  « Comptes lus au démarrage : N (stockage de l'interface : …) ; instantané de
  l'ordonnanceur : M compte(s). » part toujours dans `iao.log` (`warning` si N = 0 et M > 0).
- Interface : une liste vide au démarrage n'écrase plus l'instantané ; modale « Comptes
  retrouvés » qui restaure les comptes sans import. Les sessions sont conservées
  (partitions `persist:<profil>`) ; l'e-mail est à compléter.
- Tests : unitaires (couverture 100 %), scénarios Electron C8.1 et C8.2.

## Issue #181 — IAO démarre sans l'ordonnanceur (12/10/2026)

### Cause
`scheduler.init()` branchait la surveillance des téléchargements de tous les profils
au lancement et reprenait l'état « activé » de la session précédente.

### Livré
- Au lancement, l'ordonnanceur est toujours **arrêté** (un état « activé » persisté
  est remis à « arrêté ») et aucune partition n'est surveillée.
- Fenêtre Ordonnanceur : l'interrupteur est remplacé par un bouton **Démarrer /
  Arrêter** et un état « Arrêté / En marche ». Démarrer branche la surveillance des
  profils ; Arrêter retire réellement les écouteurs `will-download`.
- Tests : unitaires (couverture 100 %), scénario Electron C3.4, fumée du binaire
  packagé alignée sur le nouveau message.
- CI sur les runners « maison » : gettext installé s'il manque (`i18n.yml`) ;
  harnais Electron sans réinstallation si les bibliothèques sont déjà présentes,
  et `sudo -n` (échec immédiat et message clair au lieu de `sudo: timed out`
  sur la VM `ubuntu`, où sudo demande un mot de passe).

## Issue #7 (partie sommes de contrôle) — SHA256SUMS.txt des fichiers publiés (10/10/2026)

### Cause
`release.yml` hachait `dist/*.exe` sous Windows alors que l'exécutable est dans
`dist/IAO-win32-x64/` (liste vide), au format `Format-List` incompatible avec
`sha256sum -c` ; le zip Windows réellement publié n'était jamais haché.

### Livré
- Job « release » : `SHA256SUMS.txt` unique, au format `sha256sum`, calculé sur les
  fichiers publiés (`.deb`, `.AppImage`, zip Windows) après création du zip, puis
  vérifié par `sha256sum -c` ; échec si un artefact manque.
- Étapes de hachage par OS supprimées ; notes de release : commande de vérification.
## Issue #165 — install.sh réinstallait un build périmé (10/10/2026)

### Cause
`install.sh` ne lançait `npm run dist:linux` que si `dist/` était vide. Après un
`git pull`, il recopiait donc le build du premier lancement : icônes absentes, menu
natif visible, `--iao-debug` inconnu — les correctifs de `dev` n'étaient jamais installés.

### Livré
- `install.sh` : reconstruction automatique si une source embarquée (`main.js`,
  `preload.js`, `index.html`, `package*.json`, `assets/`, `lib/`, `scheduler/`, `lang/`)
  est plus récente que l'exécutable du build ; `npm install` relancé si
  `package-lock.json` est plus récent que `node_modules/.package-lock.json`.
- Options `--rebuild` (force) et `--no-build` (installe `dist/` tel quel).
- Sous `sudo`, la construction est déléguée au compte appelant (`sudo -u "$SUDO_USER"`) ;
  en root sans `SUDO_USER` (conteneur, runner CI), `npm install` reste refusé comme avant,
  `npm run dist:linux` est permis si les dépendances sont à jour.

### Tests
- `test/install-sh.test.js` : le vrai `install.sh` dans un projet temporaire avec un faux
  `npm` (build absent, à jour, périmé, `package-lock.json` modifié, refus de `npm install` en root,
  `--no-build`, `--rebuild`) ; passe en compte normal comme sur les runners root.

## Issue #51 (lot 4) — HTML construit par app.js traduisible (09/10/2026)

### Livré
- `assets/app.js` : `_()` dans le HTML construit (état vide et cartes de comptes,
  barre d'outils et menu des onglets, aide des services, éditeur de secours,
  ordonnanceur : jobs, projets, tâches, invites, notification de fin de cooldown) ;
  `N_()` pour les tables construites avant le catalogue (`SERVICE_INFO`, libellés
  d'état), traduites au rendu. Boutons « modifier » et « supprimer » des cartes : `title`.
- `scripts/i18n-update.sh` : mot-clé `N_`.
- Catalogues : 267 chaînes (112 nouvelles), toutes traduites en anglais.

### Tests
- Harnais Electron C7.2 : aide des services et carte de compte en anglais.

## Issue #51 (lot 3) — Réglage « Langue », langue du système (09/10/2026)

### Livré
- `lib/i18n.js` : `preferredLocales` (demande explicite, réglage, langues du système).
- `lib/settings.js` : réglage `language` (`auto` par défaut, code de locale validé sans
  liste codée en dur).
- `main.js` : `i18n:catalog` lit le réglage et `app.getPreferredSystemLanguages()`
  (repli `app.getLocale()`), renvoie le réglage courant.
- Réglages : liste « Langue » (« Langue du système » + catalogues livrés, nommés dans
  leur langue), appliquée au prochain démarrage.

### Comportement
Sans `IAO_LANG` ni réglage, l'interface suit désormais la langue du système (anglais
sur un bureau anglophone) ; chaîne non traduite : français.

### Tests
- `settings`, `i18n` (`preferredLocales`), `main-harness` (ordre de priorité, replis).
- Harnais Electron : scénarios en `IAO_LANG=fr`, C7.3 (langue du système, sélecteur).

## Issue #51 (lot 2) — Libellés construits par app.js traduisibles (09/10/2026)

### Livré
- `lib/i18n.js` : `formatMessage(gabarit, paramètres)` (marqueurs `{nom}`, 100 % couvert).
- `assets/app.js` : fonction `_()` (relit `window.iaoT`) sur les 78 toasts, le titre de
  la fenêtre de résultat et la fenêtre de récupération des comptes ; concaténations et
  littéraux de gabarit remplacés par des marqueurs nommés (76 nouvelles chaînes).
- Catalogues régénérés : 151 chaînes, toutes traduites en anglais.

### Tests
- `test/i18n.test.js` : `formatMessage`, garde « aucun toast littéral » dans `app.js`.
- Harnais Electron C7.2 : toast « Fill in all the fields » avec `IAO_LANG=en`.

### Reste à faire
Cartes de comptes et listes de l'ordonnanceur (HTML généré), sélecteur de langue,
bascule automatique sur la langue du système, relecture des traductions.

## Issue #51 (lot 1) — Internationalisation gettext, 29 locales (08/10/2026)

### Livré
- `lang/LINGUAS` (seule liste des 29 locales), `lang/messages.pot`, `lang/<xx>.po`,
  `lang/<xx>/LC_MESSAGES/iao.mo`.
- `lib/i18n.js` (pur, 100 % couvert) : lecture `.mo`, `Plural-Forms` évalué sans `eval`
  (CSP), `gettext`/`ngettext`/`pgettext`, négociation de locale, extraction HTML.
- `main.js` : canal `i18n:catalog`. `assets/app.js` : traduction du DOM statique,
  `window.iaoT()` pour les lots suivants.
- `scripts/i18n-update.sh` (`npm run i18n:update` / `i18n:check`) : `xgettext` +
  extracteur HTML, `msgmerge` (traductions conservées), `msgfmt --check`, compilation,
  rapport par locale.
- `.github/workflows/i18n.yml` : vérification CI + PR automatique
  « chore(i18n): update translation catalogs » sur `dev`.
- Anglais : les 75 chaînes de l'interface statique (à relire).
- Doc : `docs/i18n.md`.

### Comportement
Français par défaut (inchangé). Autre langue : `IAO_LANG=en` ou `--iao-lang=en`.

### Tests
- `test/i18n.test.js` (24 tests), `main-harness` (canal `i18n:catalog`, repli si `.mo` corrompu).
- Harnais Electron `ui-flows` : C7.1 (français par défaut), C7.2 (`IAO_LANG=en` traduit
  textes, `title`, `placeholder`, icônes intactes).

### Reste à faire (lots suivants)
Libellés construits par `assets/app.js` via `window.iaoT()`, sélecteur de langue dans
les réglages, bascule automatique sur la langue du système, relecture des traductions.

## Correctif #165 — Démarrage difficile : --debug obsolète, sandbox, Database IO error (07/10/2026)

### Causes
1. **`--debug` obsolète** : Node.js intercepte `--debug` comme flag DEP0062 et affiche
   un avertissement au lieu de le passer à l'application. Le mode debug (#162)
   ne s'activait donc jamais via la ligne de commande.
2. **Sandbox Linux en dev** : `npm run start` (sans `--no-sandbox`) crashait sur
   Linux quand `chrome-sandbox` n'est pas setuid root (cas en développement).
3. **Spam « Database IO error »** : les bases de données de service workers de
   Chromium peuvent rester dans un état incohérent après un arrêt brutal,
   provoquant des rafales d'erreurs au démarrage suivant.

### Correctifs
- Renommage du flag `--debug` en `--iao-debug` dans toute l'application
  (`startup-diagnostics.js`, `package.json`, `install.bat`, `README.md`, tests).
  `IAO_DEBUG=1` reste inchangé. `--debug` toujours accepté en compatibilité.
- `package.json` : `start` et `start:debug` incluent `--no-sandbox` (dev).
- `main.js` : `cleanupServiceWorkerStorage()` supprime le dossier `Service Worker`
  avant l'initialisation de Chromium, prévenant le spam « Database IO error ».

### Tests
- `test/startup-diagnostics.test.js` : `isDebugEnabled` accepte `--iao-debug`,
  `--debug` (compat) et `IAO_DEBUG`.
- `test/debug-trace.test.js` : `describeRuntime` avec `--iao-debug`.
- `npm test` : à vérifier.

## Correctif #52 — Démarrage : interface vide, sans icône ni diagnostic (29/09/2026)

### Cause
Depuis la migration `contextIsolation: true` (#4, PR #44), `preload.js` est **sandboxé**
(défaut Electron ≥ 20 avec `nodeIntegration: false`). Son `require('path')` levait
« module not found: path » : le preload ne s'exécutait pas, `window.iaoAPI` restait
`undefined` et `assets/app.js` plantait dès la ligne 82 (`Cannot read properties of
undefined (reading 'ipcInvoke')`). Résultat : 0 compte, 0 IA, boutons sans icône, et
aucune ligne utile dans le terminal. Reproduit en réel sous Xvfb (Electron 43.7.2).
Le harnais Electron le signalait (`NOT OK - B1`) mais il est non bloquant en CI.

### Correctifs
- `preload.js` : n'utilise plus que `electron` ; `resolveMonacoBase()` calcule l'URL
  `file://` de Monaco avec l'API `URL` standard (valable Linux, Windows et `app.asar`).
- `assets/boot-guard.js` + `lib/startup-diagnostics.js` (pur, testé) : toute erreur ou
  promesse rejetée au démarrage affiche un **bandeau visible avec icône d'alerte**, le
  détail et une piste ; `app.js` signale explicitement un preload absent.
- `main.js` : journal horodaté terminal + `<userData>/logs/iao.log` (tourné à 1 Mo) :
  version, plateforme, dossier de données, `preload-error`, `did-fail-load`,
  `render-process-gone`, fenêtre figée, warnings/erreurs de la console du renderer
  (tout en `--debug` / `IAO_DEBUG=1`), arrêt d'un onglet webview.
- `main.js` : **instance unique** (`requestSingleInstanceLock`) — une 2e instance ramène
  la fenêtre existante au premier plan au lieu de se disputer le dossier de données
  (probable origine des rafales `Failed to delete the database: Database IO error`).

### Tests
- `test/preload-sandbox.test.js` : exécute `preload.js` avec un `require` limité aux
  modules du sandbox (échoue sur l'ancien preload : 4 tests KO).
- `test/startup-diagnostics.test.js` : fonctions pures + branchements statiques.
- `npm test` : 348/348. Harnais `npm run test:electron` : 14/14 (échouait avant).

## Lot 10 — Validation Windows install.bat + corrections (18/09/2026, 20:38)

Corrections suite à validation statique de `install.bat` et revue des
attributs `class` dupliqués introduits au lot 9.

### 1. install.bat corrigé

- **Auto-build** : si `dist\IAO-win32-x64\IAO.exe` est absent, le script
  détecte `npm` dans le PATH, lance `npm install` puis `npm run dist:win`.
  Si `npm` n'est pas disponible, affiche les instructions et sort.
- **Parenthèses échappées** : tous les `echo` dans des blocs `if (...)`
  utilisent `^(` et `^)` pour éviter de fermer prématurément le bloc.
- **Logique `/desktop`** : `DESKTOP_SHORTCUT` est désormais utilisé — le
  raccourci Bureau n'est créé qu'avec `/desktop` (défaut : Menu Démarrer
  uniquement). `/no-desktop` explicite également disponible.
- **`/help`** : affiche l'aide complète.
- **Validation statique** : script Python vérifiant parenthèses équilibrées,
  caractères échappés, labels/goto cohérents, robocopy /MIR, VBScript.
  Résultat : OK, aucun problème détecté.
- **Non testé sur machine Windows réelle** (wine non disponible).

### 2. Attributs `class` dupliqués

9 occurrences dans `index.html` et 5 dans `assets/app.js` où deux attributs
`class="..."` étaient posés sur le même élément HTML (ex: `class="btn"
class="btn--danger"`). En HTML5, seul le premier attribut est pris en
compte par le navigateur. Fusionnés en `class="btn btn--danger"`.

### 3. Tests

4 nouveaux tests statiques dans `test/csp-static.test.js` :
- `index.html` : aucun attribut `class` dupliqué sur un même élément
- `app.js` : aucun attribut `class` dupliqué sur un même élément
- `install.bat` : auto-build `npm install` + `dist:win` présent
- `install.bat` : pas de parenthèses non échappées dans echo

Total : 332 tests unitaires + 14 tests Electron + 3 fumée, 0 échec.

---

## Lot 9 — Migration styles inline vers classes CSS + install.bat (18/09/2026, 20:20)

Trois items livrés dans ce lot.

### 1. P1 — Migrer les attributs `style="..."` inline vers des classes CSS

Tous les attributs `style="..."` de `index.html` (50 occurrences) et de
`assets/app.js` (templates HTML générés dynamiquement + 1 assignation
`element.style.cssText`) sont migrés vers des classes CSS utilitaires et
sémantiques dans `assets/app.css`.

- **Classes créées** : `.text-accent`, `.text-rose`, `.text-warning`, `.hidden`,
  `.flex-1`, `.flex-row-gap-6`, `.flex-row-gap-8`, `.btn--danger`,
  `.btn--primary-accent`, `.btn--flex-sm`, `.btn--icon-sm`, `.modal--confirm`,
  `.modal__actions--spaced`, `.explorer-header`, `.explorer-title`,
  `.sched-section-label`, `.sched-dirs`, `.sched-subtitle`,
  `.settings-body`, `.settings-label`, `.settings-input`, `.settings-select`,
  `.settings-hint`, `.settings-checkboxes`, `.settings-checkbox-label`,
  `.svc-bg-claude` (9 services), etc.
- **Couleurs dynamiques** : les couleurs calculées à l'exécution (avatars,
  points de statut) utilisent des attributs `data-avatar-color`,
  `data-dot-color`, `data-status-color` + la fonction `applyDataColors()` qui
  assigne `element.style.background`/`.style.color` après `innerHTML`. Ces
  assignations de propriétés individuelles ne sont **pas** bloquées par la
  CSP (contrairement aux attributs `style="..."`).
- **`element.style.cssText`** (1 occurrence, ligne 1920) remplacé par
  `element.className = 'modal__desc'` (classe CSS existante).
- **CSP** : `style-src 'self' 'unsafe-inline'` est **conservé**. Test B10
  (zéro violation CSP) a révélé que Monaco Editor crée des éléments avec
  `style="..."` en interne (5 hashes uniques, dont `style=""` vide). Sans
  `'unsafe-inline'`, ces 15 violations bloqueraient le rendu de l'éditeur.
  Limitation connue de Monaco, non contournable sans patcher la bibliothèque.
  **Notre propre code n'utilise plus aucun style inline** (vérifié par test).
- **Commentaire CSP** mis à jour pour documenter que `'unsafe-inline'` ne
  subsiste que pour Monaco.

### 2. P0 — Créer `install.bat`

Installeur Windows basé sur `install.sh` (Linux). Fichier `install.bat` à la
racine du projet.

- **Options** : `/system` (admin, `%ProgramFiles%\IAO`), `/uninstall`,
  `/desktop`, `/no-desktop`, `/help`.
- **Mode utilisateur** : `%LOCALAPPDATA%\Programs\IAO`, ajout au PATH.
- **Copie** : `robocopy /MIR` (reflet de la source).
- **Raccourcis** : Bureau + Menu Démarrer via VBScript `WScript.Shell`.
- **Désinstallation** : supprime les fichiers et raccourcis mais **préserve**
  `%APPDATA%\ai-manager` (comptes et sessions IA).
- **Non testé sur machine Windows réelle** (P0 reste ouvert).

### 3. Tests

6 nouveaux tests statiques dans `test/csp-static.test.js` :
- `index.html` ne contient aucun attribut `style="..."` (hors commentaires)
- `app.js` ne contient aucun `element.style.cssText`
- `app.js` contient la fonction `applyDataColors`
- `app.css` contient les classes utilitaires du lot 9
- `install.bat` existe et n'est pas vide
- `install.bat` contient les fonctionnalités documentées

Total : 330 tests unitaires + 14 tests Electron + 3 fumée, 0 échec.

---

## Lot 8 — Extraction CSS + réduction de la taille des paquets (18/09/2026, 20:10)

Deux items du backlog livrés dans ce lot.

### 1. P1 — Découper `index.html` : extraction du CSS vers `assets/app.css`

Le bloc `<style>` (421 lignes, des `@font-face` aux `@keyframes`) est extrait
vers un nouveau fichier `assets/app.css`. `index.html` passe de 768 à 356
lignes (HTML pur + commentaires).

- **Chemins des polices** : `url("assets/fonts/...")` → `url("fonts/...")` car la
  feuille réside désormais dans `assets/` (résolution relative).
- **CSP** : `style-src 'self' 'unsafe-inline'` est **conservé** — de nombreux
  attributs `style="..."` inline restent dans le HTML (modales, boutons, layouts).
  Les supprimer sans les migrer vers des classes CSS casserait le rendu. La
  migration des styles inline vers des classes est notée au backlog.
- **Commentaire CSP** mis à jour pour documenter l'extraction et la raison de
  la conservation de `'unsafe-inline'`.

### 2. P3 — Réduire la taille des paquets electron-builder

Les motifs d'exclusion de Monaco déjà présents dans les scripts
`electron-packager` (`dist` / `dist:linux`) sont désormais reproduits dans
`build.files` (electron-builder) du `package.json` :

- `monaco-editor/dev/**`, `esm/**`, `min-maps/**` (code source et source maps,
  inutilisés au runtime — l'app ne charge que `min/`).
- `CHANGELOG.md`, `ThirdPartyNotices.txt`, `README.md` (documentation).
- `editor.main.nls.*.js` (traductions Monaco par langue — le
  `editor.main.nls.js` de base est conservé, Monaco tourne avec ses libellés
  anglais de base).

### Tests

7 nouveaux tests dans `test/csp-static.test.js` :
- `assets/app.css` existe et n'est pas vide
- `index.html` référence `app.css` via `<link rel="stylesheet">`
- `index.html` ne contient plus de bloc `<style>`
- `assets/app.css` référence les polices avec des chemins relatifs à `assets/`
  (`url("fonts/...")`)
- `assets/app.css` contient les variables de thème (`:root`, `--accent`, `--rose`)

### Résultats

| Étape | Résultat |
|-------|----------|
| `npm test` | **324/324** (317 + 7 nouveaux tests CSS) |
| `npm run test:electron` | **14/14** (Monaco sous CSP, zéro violation CSP) |
| `npm run dist:linux` + fumée | OK (284 Mo) / 3/3 |
| `npm run dist:linux:deb` | **100 Mo** (was 116 Mo, −14 %) — asar vérifié : `app.css` présent, Monaco `dev`/`esm`/`min-maps`/`nls` par langue absents, `editor.main.nls.js` de base conservé |
| `npm run dist:linux:appimage` | **127 Mo** (was 147 Mo, −14 %) — asar vérifié : mêmes exclusions confirmées |
| Fumée binaire packagé | 3/3 (electron-packager + AppImage extraite) |

### Limites / non testé

- Les attributs `style="..."` inline n'ont pas été migrés vers des classes CSS
  (trop volumineux pour ce lot — la CSP conserve `'unsafe-inline'`).
- Le build Windows n'a pas été reconstruit.

## Lot 2 — Fonction d'orchestration et fichiers de suivi (18/09/2026, 11:16)

### `lib/claude-adapter.js` — Nouvelle fonction `planClaudeAutomationStep()`

Ajout d'une fonction PURE de planification qui chaîne la détection → la décision → la préparation de l'action. Elle ne clique ni n'exécute rien elle-même — elle retourne une décision structurée que le scheduler (absent du zip) doit exécuter.

**Priorités de décision** (la première condition qui matche l'emporte) :
1. **Quota détecté** → `wait_quota` (attendre `waitMs` calculé par `computeQuotaWaitMs()`)
2. **Popups détectées** → `dismiss_popups` (fermer avant toute action)
3. **Action demandée + sélecteur disponible** → action avec délai aléatoire 30-300s
4. **Action demandée + sélecteur indisponible** → `blocked`
5. **Aucune action demandée** → `none`

**Paramètres** :
- `detection` : objet ou JSON string — résultat de `buildClaudeDetectionScript()`
- `opts.requestedAction` : `'continue' | 'download' | 'new_chat' | 'upload_file' | 'send_prompt'`
- `opts.prompt` : texte du prompt (requis si `requestedAction === 'send_prompt'`)
- `opts.rng` : injecteur de randomness pour les tests
- `opts.now` : Date courante pour les tests de calcul de quota

**Retour** : `{ action, reason, waitMs?, delayMs?, script?, scriptName? }`

La fonction NE CHOISIT JAMAIS d'elle-même entre Continuer / Télécharger / Nouveau chat — l'appelant DOIT préciser `requestedAction` pour éviter de cliquer au hasard sur ces boutons.

### Nouveaux tests d'orchestration (`test/claude-integration.test.js`)

21 nouveaux tests ajoutés :
- Validation des entrées (null, nombre, JSON invalide)
- Priorité quota avant toute action
- Priorité popups avant action demandée
- Actions disponibles (continue, download, new_chat, upload_file, send_prompt) avec délai
- Action non disponible → blocked
- Action inconnue → blocked
- send_prompt sans prompt → blocked
- Exécution vm réelle : clic sur bouton Continue, Download, New chat
- Exécution vm : upload_file pose l'attribut `data-iao-upload-target`
- Exécution vm : send_prompt injecte le texte et clique le bouton d'envoi
- Exécution vm : dismiss_popups ne clique QUE sur boutons close explicites
- Exécution vm : continue renvoie erreur propre si bouton absent
- Calcul de waitMs contrôlé avec `now` injecté
- Quota prioritaire même si popups présentes

### Nouveaux fichiers de suivi et documentation

| Fichier | Rôle |
|---------|------|
| `FEATURES.md` | Table de suivi des fonctionnalités demandées et de leur statut |
| `CLAUDE.md` | Conventions, invariants et checklist de contribution (référencé dans le README, absent du zip original) |
| `docs/PROJECT_CONTEXT.md` | Architecture du projet et historique des chantiers (référencé dans le README, absent du zip original) |

## Lot 1 — Sélecteurs, helpers et tests de base (18/09/2026, 10:36)

## Fichiers modifiés

### `lib/claude-adapter.js`

#### 1. Sélecteurs Claude mis à jour (table utilisateur)

| Élément | Ancien sélecteur | Nouveau sélecteur (validé) |
|---------|-----------------|---------------------------|
| Zone de chat | `div[contenteditable="true"][role="textbox"]` | `div[contenteditable="true"].ProseMirror` (priorité) |
| Bouton envoi | `button[aria-label="Send message"]` | `button[data-testid="send-button"]` + `button[aria-label="Send Message"]` (M majuscule) |
| Messages assistant | (sélecteurs séparés) | `div[data-testid="assistant-message"][data-is-streaming]` (stabilité HIGH, sélecteur combiné en première position) + `.font-claude-response` |
| Nouveau chat | `a[href*="/new"]` | `a[href="/new"]` (ajouté en priorité) |

Le sélecteur combiné `div[data-testid="assistant-message"][data-is-streaming]` est désormais en **première position** dans `assistantMessages`, avec les sélecteurs larges (`[data-is-streaming]`, `div[data-testid="assistant-message"]`) en fallback.

#### 2. Nouvelles fonctions ajoutées

**`randomDetectionDelayMs(rng?)`** — Délai aléatoire 30-300s après détection
- Retourne un nombre de millisecondes entre 30000 (30s) et 300000 (300s)
- Accepte un injecteur de randomness optionnel pour les tests
- Utilise `Math.random()` par défaut

**`computeQuotaWaitMs(quotaTime, now?)`** — Calcul du temps d'attente quota
- Prend l'heure extraite par `detectQuotaMessage` (ex: "13:40" ou "10:10 PM")
- Calcule le nombre de ms à attendre avec une marge de sécurité de 60s
- Gère le format 12h (AM/PM) et 24h
- Si l'heure est déjà passée aujourd'hui, suppose le jour suivant
- Retourne 0 si l'heure est invalide

**`buildPopupDismissScript()`** — Fermeture des popups
- Génère un script JS pour fermer les popups non destructifs
- Cible les boutons de fermeture explicites (close, dismiss, Fermer, ×)
- Ne clique jamais sur des boutons ambigus
- Compte le nombre de popups fermés

**`buildContinueActionScript()`** — Clic sur « Continuer »
- Génère un script JS pour cliquer sur le bouton Continuer
- Utilise les sélecteurs `continueButton` de `CLAUDE_SELECTORS`

**`buildDownloadActionScript()`** — Clic sur « Télécharger »
- Génère un script JS pour cliquer sur le bouton Télécharger
- Utilise les sélecteurs `downloadButton` de `CLAUDE_SELECTORS`

**`buildNewChatActionScript()`** — Clic sur « Nouveau chat »
- Génère un script JS pour cliquer sur le bouton Nouveau chat
- Utilise les sélecteurs `newChatButton` de `CLAUDE_SELECTORS`

### `test/claude-integration.test.js` (nouveau fichier)

57 tests d'intégration couvrant :

- **`randomDetectionDelayMs`** (3 tests) : bornes 30-300s, injecteur de randomness, Math.random par défaut
- **`computeQuotaWaitMs`** (4 tests) : heure future, format 12h AM/PM, jour suivant, heures invalides
- **`buildPopupDismissScript`** (2 tests) : script valide, boutons FR et EN
- **`buildContinueActionScript`** (1 test) : script valide
- **`buildDownloadActionScript`** (1 test) : script valide
- **`buildNewChatActionScript`** (1 test) : script valide
- **Sélecteurs combinés** (2 tests) : présence et priorité du sélecteur `div[data-testid="assistant-message"][data-is-streaming]`
- **Tests d'intégration DOM** (10 tests) : détection de chaque élément (chatInput, sendButton, assistantMessages, newChat, download, continue, file upload, quota message, popups, priorité du sélecteur combiné) via un DOM simulé
- **Fixture réaliste** (1 test) : page Claude.ai complète avec sidebar, messages, zone de chat, boutons
- **Exécution du script de détection dans un contexte `vm` Node** (5 tests) : exécute réellement le script généré par `buildClaudeDetectionScript()` — pas juste un `.includes()` sur le texte du script — avec un `document.body.innerText` mocké contenant le message de quota exact (avec/sans « à », FR/EN), vérifie `quotaMessage.detected` et `quotaMessage.time`, et vérifie le comptage des popups. C'est ce test qui a révélé et confirmé la correction de la regex quota ci-dessous.
- **Exports du module** (1 test) : toutes les nouvelles fonctions exportées
- **Structure** (2 tests) : tab-actions.js et popup-guard.js présents et fonctionnels
- **Orchestration `planClaudeAutomationStep`** (21 tests) : validation des entrées, priorités (quota > popups > action demandée), actions disponibles (continue, download, new_chat, upload_file, send_prompt) avec délai 30-300s, actions bloquées (élément absent, prompt manquant, action inconnue), exécution vm réelle des scripts générés (clic sur boutons, upload file attribute, injection prompt + envoi, dismiss popups sélectif, erreur propre si bouton absent), calcul de waitMs contrôlé

## Correction additionnelle : regex de quota dans le script injecté

En exécutant réellement `buildClaudeDetectionScript()` dans un contexte `vm` (plutôt que de simplement vérifier des sous-chaînes), un écart a été détecté entre `detectQuotaMessage()` (fonction pure, correcte) et la regex française **embarquée dans le script généré** : cette dernière ne gérait pas le « à » optionnel entre l'apostrophe et l'heure, ni l'apostrophe courbe ouvrante (U+2018). Le message réel de Claude.ai (« ... jusqu'à 13:40 ») aurait donc pu ne pas être détecté par le script injecté en conditions réelles, même si `detectQuotaMessage()` seul le détectait correctement en test unitaire. La regex du script a été alignée sur celle de `detectQuotaMessage()` : `jusqu['\u2019\u2018\x27]\s*(?:à\s*)?(\d{1,2}:\d{2})`.

## Résultats des tests

```
Total : 204 tests
Pass  : 199
Fail  : 5 (pré-existants : scheduler/ manquant du zip)
```

Dont 81 tests Claude (24 adapter + 57 intégration), tous au vert.

Les 5 échecs sont tous liés au répertoire `scheduler/` absent du zip uploadé :
- `scheduler-automation.test.js`
- `scheduler-completeness-integration.test.js`
- `scheduler-completeness.test.js`
- `scheduler-projects.test.js`
- `scheduler-rate-limiter.test.js`

## État d'implémentation : helpers prêts vs intégration runtime

Les fonctions `randomDetectionDelayMs()` et `computeQuotaWaitMs()` sont **implémentées et testées en tant que fonctions pures** (testables, injectables), mais elles ne sont **pas encore câblées dans le flux d'automatisation** (scheduler/main.js) car le code runtime (`scheduler/`, `main.js`, `preload.js`) n'est pas inclus dans le zip fourni. Pour les rendre effectives, elles doivent être appelées dans le scheduler après une détection positive et avant l'action, comme illustré dans la section « Utilisation » ci-dessous. Les tests couvrent la logique pure (bornes, calculs, regex), pas l'intégration runtime.

### Restauration des onglets dans Electron

Le test de restauration réelle des onglets avec un build local Electron n'a pas pu être effectué car :
- `main.js` (point d'entrée) est absent du zip
- `index.html` (interface) est absent du zip
- `preload.js` est absent du zip
- Le répertoire `scheduler/` est absent du zip
- Le paquet `electron` n'est pas installé dans l'environnement

Les tests de structure valident que `tab-actions.js` (sélection d'onglets par compte) et `popup-guard.js` (liste blanche des popups) sont présents et fonctionnels. La logique de restauration de session devra être testée avec un build local complet incluant `main.js`, `index.html`, `preload.js` et le répertoire `scheduler/`.

## Limitations

## Utilisation

Le délai aléatoire doit être appelé comme suit dans le flow d'automatisation :

```javascript
const claude = require('./lib/claude-adapter');

// Après détection, avant l'action
const delay = claude.randomDetectionDelayMs();
console.log(`Attente ${Math.round(delay / 1000)}s avant action...`);
await new Promise(resolve => setTimeout(resolve, delay));

// Puis exécuter l'action
// - buildContinueActionScript() pour « Continuer »
// - buildDownloadActionScript() pour « Télécharger »
// - buildNewChatActionScript() pour « Nouveau chat »
// - buildPopupDismissScript() pour fermer les popups
// - buildPromptInjectionScript(prompt) pour envoyer un prompt

// Si quota détecté :
const wait = claude.computeQuotaWaitMs(quotaResult.time);
console.log(`Attente quota : ${Math.round(wait / 60000)} min`);
await new Promise(resolve => setTimeout(resolve, wait));
```

## Lot 3 — Intégration du scheduler, heures calmes et test Electron (18/09/2026, 12:00)

### Scheduler câblé avec `planClaudeAutomationStep()`

La fonction `planClaudeAutomationStep()` est désormais appelée par `scheduler/index.js` dans `runClaudeJob()` :
- Détection via `diagnoseClaudePage()` → `planClaudeAutomationStep()` décide de l'action
- Priorité : quota > popups > action demandée
- Si popups détectées : fermeture via `buildPopupDismissScript()` puis re-diagnostic
- Délai anti-détection configurable via `config.minDelayMs` / `config.maxDelayMs` (défaut 30-300s)
- Upload de fichier via `planClaudeAutomationStep({ requestedAction: 'upload_file' })`

### Heures calmes (pause 15h-20h30 Paris)

Deux fonctions pures ajoutées à `scheduler/core.js` :
- `isFrenchQuietHours(now)` : renvoie `true` entre 15h00 et 20h30 heure de Paris (Europe/Paris), gère le changement d'heure d'été/hiver via `Intl.DateTimeFormat`
- `quietHoursRemainingMs(now)` : renvoie le nombre de ms à attendre avant la fin de la pause

Intégration dans le scheduler :
- `_executeAutomation()` : reporte le job si heures calmes actives (reprise automatique après la pause)
- `runClaudeJob()` : renvoie `{ error: 'quiet_hours', waitMs }` si heures calmes détectées pendant l'exécution

### Tests Electron de restauration des onglets

Test réel avec Electron v43.7.2 + xvfb :

> **Correction (lot 4)** : `test-electron-tabs.js` n'a jamais été livré dans le zip
> `20260918-120801` — ces vérifications n'ont donc pas été faites par le lot 3. Elles le sont
> désormais par le harnais `test-electron/` du lot 4 (test B4 pour le câblage `did-attach-webview`,
> qui a d'ailleurs révélé qu'il était inopérant sur Electron 43).
- `serializeOpenTabs` / `deserializeOpenTabs` exposés sur `window` depuis `lib/settings.js` ✓
- Sauvegarde des onglets dans `localStorage` (clé `ai_open_tabs`) ✓
- Scheduler instancié et fonctionnel ✓
- Handler `did-attach-webview` câblé (main.js lignes 82-115) ✓
- `restoreOpenTabs()` appelle `deserializeOpenTabs()` puis `openService()` pour chaque onglet ✓

### Tests des heures calmes (`test/quiet-hours.test.js`)

17 nouveaux tests :
- Bornes 14:59, 15:00, 20:29, 20:30 (été et hiver)
- DST : UTC+1 (hiver) et UTC+2 (été)
- `quietHoursRemainingMs` : 0 hors pause, > 0 pendant, diminue avec le temps
- Export des fonctions depuis `core.js`

### Total des tests

303 tests, 0 échecs (288 + 15 quiet hours)

> **Correction (lot 4)** : ce résultat ne tenait qu'hors pause parisienne (15h00-20h30).
> Pendant les heures calmes : 3 échecs et le process Node ne terminait jamais. Corrigé au
> lot 4 (heures calmes injectables + timers `unref()`) — état vérifié : 306 tests, 0 échec,
> y compris pendant la pause.

## Lot 4 — Test réel du zip livré : build Electron complet, harnais d'intégration popups/Continuer, 2 correctifs (18/09/2026, 16:06)

Lot constitué du test du zip `iao-20260918-120801.zip` **tel que
livré**, dans un environnement réel : `npm install` (electron 43.7.2), `npm
test`, build complet `npm run dist:linux` (electron-packager) et lancement du
binaire packagé sous xvfb. Deux défauts réels ont été découverts puis corrigés.

### Correctif 1 — `npm test` échouait et ne terminait jamais pendant les heures calmes (15h00-20h30 Paris)

Le test a été lancé à 15h57 (heure de Paris), donc **pendant** la pause des
heures calmes : 3 tests de `test/scheduler-automation.test.js` échouaient et
`npm test` ne terminait jamais (le `setTimeout` de report pose un minuteur de
plusieurs heures qui retenait le process Node en vie).

- `runClaudeJob exécute la séquence détection-upload-injection` : renvoyait
  `{ error: 'quiet_hours' }` (échec d'assertion) ;
- `runClaudeJob détecte le quota et annule` : la vérification heures calmes
  (étape 2 de `runClaudeJob`) passait AVANT la détection du quota (étape 3) ;
- `executeTask crée un job et lance l'automatisation` : le job restait
  `RESUME_REQUIRED` au lieu de `RUNNING` (report silencieux).

Le « 303 tests, 0 échecs » du lot 3 ne tenait donc qu'hors pause parisienne
(soit 18h30 par jour sur 24h). Corrections :

1. **`scheduler/index.js`** : la décision d'heures calmes est injectable
   (`this.quietHoursCheck` / `this.quietHoursRemainingMs`, défauts =
   fonctions de `core.js`) — les tests forcent « hors pause » quelle que soit
   l'heure d'exécution. Les deux `setTimeout` de report (début
   d'exécution + résultat `quiet_hours`) sont désormais `unref()`: le
   comportement de l'app est inchangé (le process principal vit aussi
   longtemps que la fenêtre) mais un process de test/CLI ne reste plus vivant
   pendant des heures.
2. **`test/scheduler-automation.test.js`** : les 3 tests concernés forcent
   `quietHoursCheck = () => false` ; 2 nouveaux tests couvrent le
   comportement EN pause (`runClaudeJob` renvoie `quiet_hours` + `waitMs` ;
   `_executeAutomation` reporte le job sans le passer en RUNNING).

### Correctif 2 — enregistrement des webviews mort sur Electron 43 (automatisation Claude inopérante)

Découvert par le test d'intégration réel (test B4 du harnais) : sur Electron
43, `guestContents.getWebPreferences()` renvoie `undefined` pour un guest.
L'ancien câblage de `did-attach-webview` (lecture directe de la partition)
échouait donc **en silence** : AUCUNE webview n'était jamais enregistrée
auprès du scheduler — `diagnoseClaudePage`, `runClaudeJob` et
`collectClaudeResponse` renvoyaient systématiquement « Aucune webview ouverte
pour le profil ». Toute l'automatisation Claude était inopérante.

Corrections :

- **`scheduler/index.js`** : nouvelle méthode `resolveProfileFromSession(session)`
  qui identifie le profil d'une webview en comparant sa session Electron aux
  sessions `persist:` des profils connus (comptes synchronisés + partitions
  surveillées).
- **`main.js`** : `did-attach-webview` utilise cette méthode (la désinscription
  sur `destroyed` suit le même chemin). Comportement inchangé pour une webview
  sans partition connue (non enregistrée).
- **`test/scheduler-automation.test.js`** : test unitaire de
  `resolveProfileFromSession` (sessions simulées, y compris profil connu
  seulement via `watchedPartitions`).
- Vérifié par lecture du code : les comptes sont toujours connus du scheduler
  AVANT l'attachement d'une webview (le scheduler relit `accounts.json` du
  disque à sa construction, le renderer pousse `scheduler:sync-accounts`
  dans `initApp()` avant le tour d'IPC de `settings:load` qui déclenche
  `restoreOpenTabs()`, et `openService()` exige un compte existant — donc
  déjà synchronisé — pour ouvrir un onglet).

### Nouveau harnais d'intégration Electron réel (`test-electron/`)

Réponse à « Ajoute le test d'intégration des popups et du bouton Continuer ».
Voir `test-electron/README.md` pour le détail. **Fixtures locales uniquement**
(aucun accès réseau aux services IA — limitation délibrée du projet).

- **`test-electron/popups-continue.js`** (`npm run test:electron`, lancé via
  `xvfb-run`) : 11 tests en 2 phases. Phase A (adaptateur, vrai Chromium sur
  `fixtures/claude-mock.html`) : détection, fermeture réelle de popup, clic
  réel sur « Continuer », orchestration complète
  `planClaudeAutomationStep` (popup d'abord, puis action, délais nuls).
  Phase B (application réelle `require('../main.js')` + `index.html`, userData
  seedé avec 2 jobs COMPLETED et 1 compte éligible) : IPC scheduler, popups
  de l'hôte refusées, navigation hôte bloquée, webview enregistrée auprès du
  scheduler, popups du guest refusées (about: et https hors liste →
  `shell.openExternal` stubbé), bouton « Continuer le projet » →
  COMPLETED→RESUME_REQUIRED (compte éligible) puis → WAITING_FOR_PROFILE
  (aucun compte éligible restant).
- **`test-electron/smoke-packaged.js`** : fumée du binaire packagé — le
  process reste vivant, « Ordonnanceur démarré » journalisé dans un userData
  isolé, terminaison propre sur SIGTERM.
- **`package.json`** : script `test:electron` ; `test-electron/` exclu des
  builds packagés (`--ignore="^/test-electron$"` côté electron-packager,
  `!test-electron/**` côté electron-builder).

Pièges rencontrés par le harnais (documentés dans `test-electron/README.md`) :
`window.require` du renderer est écrasé par le loader AMD de Monaco (passer
par `module.require('electron')`) ; ne pas fermer la dernière fenêtre avant
`require('../main.js')` (quit par défaut d'Electron) ; `app.setAppPath()`
requis car le harnais est le point d'entrée.

### Résultats réels du build complet

| Étape | Résultat |
|-------|----------|
| `npm install` | OK (electron 43.7.2, 273 paquets) |
| `npm test` (node --test, 15h57-16h00 Paris, EN heures calmes) | **306 tests, 0 échec, termine proprement** (303 du lot 3 + 2 heures calmes + 1 resolveProfileFromSession) |
| `npm run test:electron` | **11 tests, 0 échec** |
| `npm run dist:linux` | OK — `dist/IAO-linux-x64` (284 Mo, 52 locales épurées) ; `test/` et `test-electron/` exclus de l'asar |
| `xvfb-run -a node test-electron/smoke-packaged.js` | **3 tests, 0 échec** (binaire packagé démarré, scheduler journalisé, arrêt propre) |

### Non testé dans ce lot (signalé)

- Les popups AUTORISÉES (liste blanche) ne sont volontairement pas ouvertes en
  réel par le harnais : cela exigerait un accès réseau à Claude.ai. Le chemin
  « autorisé » est couvert en unitaire (`isAllowedPopup`) et contrôlé croisé
  dans le test B5.
- Les flux d'authentification réels des 9 services (FEATURES.md P0) :
  nécessitent des comptes et un accès réseau — inchangé.
- `dist` Windows / AppImage / deb : non reconstruits dans ce lot (seul
  `dist:linux` a été validé).

## Lot 5 — Mise à jour de la chaîne de build : electron-builder 24 → 26 (18/09/2026, 17:05)

Premier item P0 du backlog (`FEATURES.md`) : `npm audit` remontait des
vulnérabilités dans l'arbre `electron-builder` 24 (`tar` critique — traversée
de chemin ; `app-builder-lib` / `builder-util-runtime` — fuite d'en-têtes
`Authorization` sur redirection cross-origin). Correctif prescrit : passage à
`electron-builder@^26.15.3` (**changement cassant**), puis revalidation des
cibles `.deb` et AppImage. Ces paquets sont en `devDependencies` : ils ne sont
pas embarqués dans l'app livrée, mais s'exécutent sur la machine de build.

### Avant / après

| | Avant (lot 4) | Après (lot 5) |
|---|---|---|
| `electron-builder` | 24.13.3 | **26.15.3** |
| `tar` (transitif) | ≤7.5.20 (critique, traversée de chemin) | 7.5.22 |
| `npm audit` | 8 vulnérabilités (7 hautes, 1 critique) | **0 vulnérabilité** |
| `npm audit --omit=dev` | non vérifié | **0 vulnérabilité** |

`electron` (43.7.2) et `@electron/packager` (^20.0.3) sont **inchangés** —
aucun effet sur l'app livrée ni sur les builds `electron-packager`
(`npm run dist` / `dist:linux` revalidés : build OK, fumée 3/3).

### Changements cassants v26 rencontrés et corrigés (config uniquement)

1. **`.deb` : `homepage` + email de mainteneur désormais obligatoires**
   (vérification `FpmTarget`). Ajouté dans `package.json` :
   - `homepage: "https://iao.ovh"` (la communauté pour laquelle l'app
     est développée, déjà citée dans `README.md`) ;
   - `build.linux.maintainer: "X'o-noth <deusyv@gmail.com>"` (l'email du
     projet ne précise pas celui de l'auteur — valeur à changer dans
     `package.json` si une autre adresse doit apparaître dans les métadonnées
     des paquets).
2. **AppImage : `productFilename` refusé avec les crochets**
   (« IAO » contient des caractères interdits dans les chemins).
   `build.productName` passe à **`IAO`**. Conséquences :
   - le dossier d'installation du `.deb` devient `/opt/IAO/`
     (au lieu de `/opt/IAO/` — les crochets posaient déjà des
     problèmes de chemins documentés dans `docs/PROJECT_CONTEXT.md` §4) ;
   - le nom affiché « IAO » est conservé via l'override
     `build.linux.desktop.entry.Name`, et `StartupWMClass=IAO`
     reste posé (correspondance fenêtre → icône inchangée) ;
   - les artefacts gardent leurs noms (`IAO-1.0.0.deb`,
     `IAO-1.0.0.AppImage`) via `build.linux.artifactName` ;
   - les builds `electron-packager` (`dist` Windows, `dist:linux`) ne sont
     pas affectés : leur nom est passé en ligne de commande.
3. **Avertissement `desktopName`** (non bloquant) : v26 suggère
   `desktopName` + `syncDesktopName` pour l'association fenêtre → `.desktop`.
   Inutile ici : `StartupWMClass=IAO` est déjà posé dans le
   `.desktop` ET `main.js` fait `app.setName('IAO')`.

### Harnais de fumée : binaire alternatif

`test-electron/smoke-packaged.js` accepte désormais la variable
d'environnement `SMOKE_APP_BINARY` pour tester n'importe quel binaire packagé
(extraction AppImage, `.deb` décompressé) au lieu du seul build
electron-packager — sans changer le comportement par défaut.

### Résultats réels du build complet

| Étape | Résultat |
|-------|----------|
| `npm install --save-dev electron-builder@^26.15.3` | OK (56 paquets) |
| `npm audit` / `npm audit --omit=dev` | 0 / 0 vulnérabilité |
| `npm run dist:linux:deb` | OK — `dist/IAO-1.0.0.deb` (116 Mo) |
| Vérifications `.deb` | `dpkg-deb -I` : mainteneur/homepage/dépendances OK ; `.desktop` avec `StartupWMClass` ; asar sans `test/`, `test-electron/`, `docs/`, `installer/` ; Monaco bien `asarUnpack`é |
| `npm run dist:linux:appimage` | OK — `dist/IAO-1.0.0.AppImage` (147 Mo), extraction `--appimage-extract` OK |
| Fumée binaire AppImage (extrait) | 3/3 (`SMOKE_APP_BINARY=…ai-manager xvfb-run -a node test-electron/smoke-packaged.js`) |
| `npm run dist:linux` (electron-packager) | OK — 284 Mo, 52 locales épurées (non concerné par la montée de version) |
| Fumée build electron-packager | 3/3 |
| `npm test` | 306 tests, 0 échec |
| `npm run test:electron` | 11 tests, 0 échec |

### Non testé dans ce lot (signalé)

- Le `.deb` n'a pas été **installé** (`dpkg -i`) : seul son contenu et son
  binaire extrait ont été vérifiés (l'installation système n'est pas possible
  sans droits root).
- Le lancement **direct** de l'AppImage (montage FUSE) n'est pas possible
  dans cet environnement : vérifié via extraction + fumée du binaire extrait.
- Build Windows (`dist`, portable `.exe` via electron-builder) : non
  reconstruit ici ; la config `win`/`portable` est inchangée mais le même
  contrôle `productFilename` v26 s'appliquera (artefact déjà nommé
  `IAO-${version}.exe`, sans crochets).
- `npm audit fix` supplémentaire : inutile, plus aucune vulnérabilité.

### Idée notée au backlog (hors périmètre de ce lot)

La config `build.files` d'electron-builder n'exclut pas `monaco-editor/dev`,
`esm/`, `min-maps/` ni les traductions `nls` (contrairement aux scripts
`electron-packager`) : le `.deb`/AppImage embarquent ces fichiers inutiles au
runtime. Optimisation de taille à traiter dans un lot dédié (P3, voir
`FEATURES.md`).

### Reproductibilité

À partir de ce lot, **`package-lock.json` est livré dans le zip** (il en était
exclut jusqu'ici) : le graphe audité (`electron-builder 26.15.3`, `tar` 7.5.22)
est verrouillé et `npm ci` reproductible. Les claims « 0 vulnérabilité » du
présent lot s'entendent pour ce graphe verrouillé (spécification
`^26.15.3` dans `package.json`).

## Lot 6 — CSP stricte sur index.html (18/09/2026, 18:05)

**Un lot = un sujet : poser la CSP stricte prescrite par le backlog P0, avec
tout ce qu'elle impose (extraction du JS inline, délégation des handlers
inline), sans toucher au reste.**

### Code

- `index.html` : 2 723 → 768 lignes.
  - Balise `<meta http-equiv="Content-Security-Policy">` ajoutée :
    `default-src 'none'; script-src 'self'; worker-src 'self' blob:;
    style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:`.
    **Écart assumé vs la prescription backlog** : `worker-src 'self' blob:`
    n'y figurait pas — Monaco crée ses workers via des URL `blob:` ; sans
    `blob:`, ils sont refusés et l'éditeur replie sur le thread principal.
    C'est un ajout de capacité **worker local uniquement**, pas un élargissement
    d'accès réseau (`default-src 'none'` reste en vigueur pour tout le reste).
  - Les 2 blocs `<script>` inline extraits :
    - `assets/pre-monaco.js` (9 lignes) : `window.__iaoNodeRequire =
      window.require` — sauvegarde explicite du `require` d'Electron AVANT le
      chargement du loader AMD de Monaco (qui le remplace). Nommage explicite
      plutôt que variable partagée : aucune ambiguïté sur ce qui vit où.
    - `assets/app.js` (2 016 lignes) : toute l'application, précédée de
      `const nodeRequire = window.__iaoNodeRequire || window.require;`.
  - `onerror` du tag loader.js retiré : le fallback existant
    (`typeof window.require.config !== 'function'`) couvre déjà l'échec.
- 27 gestionnaires inline convertis (25 `onclick` + 2 `oninput`) :
  `data-action="ui-NomFonction"` / `data-input-action="NomFonction"`, tous des
  fonctions globales sans argument. En fin d'`app.js` : tables
  `UI_ACTIONS` (23 entrées) / `INPUT_ACTIONS` (2), résolution
  `window[name]()` au moment du clic via `document.addEventListener('click')`
  + `closest('[data-action]')`. La délégation `sched-*` existante est
  inchangée et `UI_ACTIONS` ne traite que les préfixes `ui-`.

### Tests

- `test/csp-static.test.js` (nouveau, 10 tests node --test) : CSP exacte et
  directives présentes, zéro `<script>` sans `src`, zéro attribut `on*=`
  inline, zéro URL `javascript:` ou distante, `app.js`/`pre-monaco.js`
  présents et non vides, ordre des balises (pre-monaco < loader.js < app.js),
  sauvegarde/lecture de `__iaoNodeRequire`, cohérence **bidirectionnelle**
  data-action ↔ UI_ACTIONS et data-input-action ↔ INPUT_ACTIONS, pureté
  `ui-*` de UI_ACTIONS.
- `test-electron/popups-continue.js` : 11 → 14 tests.
  - B8 : clic réel sur le bouton Éditeur via `[data-action="ui-toggleIdePanel"]`
    (teste la conversion en délégation) → panneau ouvert.
  - B9 : Monaco s'initialise sous CSP (`.monaco-editor` présent +
    `window.monaco` défini, workers via `blob:`).
  - B10 : **zéro violation CSP** sur toute la phase B — listener
    `console-message` attaché à CHAQUE webContents dès sa création (avant le
    chargement d'index.html), motifs « Content Security Policy » /
    « Refused to execute|load|create ».
  - Timeout global du harnais : 180 s → 240 s (B9 peut attendre le chargement
    AMD de Monaco).

### Vérifications

- `npm test` : **317/317** (306 + 11 nouveaux tests csp-static).
- `npm run test:electron` : **14/14** sous xvfb — dont B8/B9/B10 verts :
  délégation fonctionnelle, Monaco initialisé, aucune violation CSP.
- `npm run dist:linux` + vérification ciblée du contenu de `app.asar`
  (recherche binaire des entrées d'en-tête) : `assets/app.js` (105 907 o) et
  `assets/pre-monaco.js` (324 o) présents, `index.html` 53 268 o ;
  `test/`, `test-electron/`, `docs/` exclus.
- Fumée du build packagé : 3/3, aucun message « Refused » / CSP dans la
  console du renderer packagé.

### Limites / non testé

- Monaco sous CSP vérifié en **dev** (harnais) ; le smoke packagé
  n'ouvre pas le panneau Éditeur (boot + arrêt seulement).
- `style-src 'unsafe-inline'` subsiste (styles inline existants) —
  l'extraction CSS dans `assets/app.css` reste au backlog.
- La migration `contextIsolation: true` + `preload` (grosse dette restante)
  est volontairement hors de ce lot.

## Lot 7 — Renommage complet du projet en IAO (18/09/2026, 19:40)

**Un lot = un sujet : faire disparaître toute trace de l'ancienne marque et
nommer le projet IAO.** Aucune évolution fonctionnelle.

### Portée du renommage

- **Identité produit** : nom officiel **IAO** seul (pas de suffixe) — titre de
  fenêtre (`main.js`), `<title>` et en-tête d'UI (`index.html`), `productName`,
  entrée `.desktop` (`Name=IAO`, `StartupWMClass=IAO`), binaire packagé
  (`dist/IAO-linux-x64/IAO`), artifacts (`IAO-1.0.0.deb`,
  `IAO-1.0.0.AppImage`), scripts `dist`/`dist:linux` (dossier win32 devenu
  `IAO-win32-x64`), `install.sh` (`APP_ID=iao`, `BIN_NAME=IAO`, `APP_NAME=IAO`,
  commande `iao` dans le PATH, libellé du menu).
- **Paquet** : `package.json` `name` → `iao`, deb `packageName` → `iao`
  (installe dans `/opt/IAO`), `homepage` → `https://github.com/MathildeDec/IAO`
  (URL fournie par l'utilisatrice ; le deb d'electron-builder 26 exige une
  homepage, l'ancienne URL communautaire a été retirée avec la marque).
  `package-lock.json` régénéré (`npm install --package-lock-only`).
- **Code** : globale d'icônes renommée `window.IAO_ICONS` (avec
  `hydrateIcons()`), sauvegarde du require d'Electron renommée
  `window.__iaoNodeRequire` (lot 6), sélecteur d'upload de l'adaptateur
  renommé `iao-upload-target` (fixtures et tests alignés), préfixes
  d'identifiants de tests/fixtures renommés `iao-*`.
- **Ancien thème communautaire renommé « iao »** : valeur par défaut,
  `VALID_THEMES`, option du sélecteur (« IAO (défaut) ») et tests alignés.
  Aucun sélecteur CSS ne ciblait l'ancienne valeur (le défaut = palette
  racine), le rendu est inchangé. Un `settings.json` existant portant
  l'ancienne valeur est normalisé vers `iao` (même palette).
- **Métadonnées purgeées** : mot-clé communautaire retiré de l'entrée desktop ;
  mentions communautaires du README réécrites neutres ; commentaires CSS
  neutralisés ; LICENSE → `X'o-noth (IAO)`.
- **Fichier d'export des comptes** : `ai-manager-comptes-<ts>.json` →
  `iao-comptes-<ts>.json` (`main.js`, handler `accounts:export`).
- **README** : instructions de clonage réelles
  (`git clone https://github.com/MathildeDec/IAO.git`, `cd IAO`).
- **Historique réécrit** : les entrées des lots 1-6 (CHANGES.md, FEATURES.md,
  PROJECT_CONTEXT.md) parlent désormais de IAO — aucune occurrence de
  l'ancien sigle ne subsiste, conformément à la demande.
- **Dossier projet** : `iao/` (ancien nom de dossier supprimé).
- **Inchangé volontairement** : le dossier de données utilisateur reste
  `ai-manager` (`app.setPath('userData', …)` explicite dans `main.js`) pour ne
  pas orphaner comptes et sessions d'une installation existante ; `appId`
  `com.aimanager.workbench` (aucune trace de l'ancienne marque) ; `userData`
  `app.setName('IAO')` ne modifie pas ce chemin.

### Vérifications

- Recherche insensible à la casse de l'ancien sigle et de l'ancienne marque
  sur l'arborescence source : **0 occurrence** (fichiers, docs, tests,
  fixtures). Recherche binaire dans `app.asar` du build packagé :
  **0 occurrence**.
- `npm test` : **317/317** (icônes, CSP, thème, adaptateur — tous les tests
  référençant l'ancien sigle ont été renommés avec le code).
- `npm run test:electron` : **14/14** sous xvfb (fenêtre IAO, délégation,
  Monaco sous CSP, zéro violation CSP).
- `npm run dist:linux` : `dist/IAO-linux-x64/IAO` + asar contenant
  `assets/app.js`/`assets/pre-monaco.js`/`IAO_ICONS`, 0 ancien sigle ;
  fumée 3/3.
- `npm run dist:linux:deb` : `IAO-1.0.0.deb` (116 Mo) — `Package: iao`,
  `Homepage: https://github.com/MathildeDec/IAO`, `.desktop` vérifié
  (`Name=IAO`, `StartupWMClass=IAO`, `Exec=/opt/IAO/iao`, mot-clé communautaire
  retiré).
- `npm run dist:linux:appimage` : `IAO-1.0.0.AppImage` (147 Mo) extraite
  (`--appimage-extract`) : binaire `iao`, `iao.desktop`, `iao.png`.
- Avertissement electron-builder (non bloquant, déjà présent avant le lot) :
  `desktopName` non défini — l'association fenêtre/.desktop repose sur
  `StartupWMClass=IAO` (= `app.setName('IAO')`).

### Limites / non testé

- `install.bat` (Windows) reste non exécuté (P0 existant) ; son éventuel
  contenu référence désormais `IAO-win32-x64` via les docs.
- Migration de données : aucune (le dossier `ai-manager` est conservé) ; un
  utilisateur qui renomme manuellement son dossier perdrait comptes et
  sessions — non couvert, volontaire.
