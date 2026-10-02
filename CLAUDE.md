# CLAUDE.md — JukeBox_DnD

## Vue d'ensemble du projet

**JukeBox_DnD** est une application desktop de gestion de musique d'ambiance pour des sessions de jeu de rôle (D&D et autres). Elle permet de charger des pistes audio, de les organiser en playlists, et de gérer des *versions* d'une même piste (ex : `calm`, `combat`, `tension`) avec transitions crossfade. L'application est utilisée en live pendant les sessions, donc la fiabilité et la réactivité sont critiques.

**Utilisateurs cibles :** le développeur (Linux + Windows, dual-boot) et un ami joueur (Windows uniquement).

---

## Stack technique actuelle (Electron)

```
electron/main.cjs       → Processus principal (CJS, IPC handlers, BrowserWindow)
electron/preload.cjs    → contextBridge → window.electronAPI
backend/*.js            → Modules ESM : AudioManager, Track, DatabaseManager, FileManager
frontend/               → Vanilla JS ESM, bundlé par Vite → dist/
```

- `"type": "module"` dans package.json → ESM par défaut, sauf les `.cjs` d'Electron
- Données persistées dans `app.getPath('userData')` : `data.json` + dossier `music/`
- DB schema v2.0 : `library[]` (pistes) + `playlists[]` (IDs de tracks)
- Champs optionnels sur un track (ajout additif, pas de migration requise) : `tags: string[]` — toujours lire via `track.tags || []`
- Durée de fondu d'un track (depuis #28) : `crossfadeDurationSeconds` (0,5–10 s, défaut 5 s, voir `backend/crossfadeDuration.js`). L'ancien `crossfadeDurationPercent` (#17) n'est plus écrit, seulement lu pour migrer : sa conversion exige la durée réelle du fichier (absente de `data.json`), donc elle se fait au premier chargement Howler de la piste (`Track._migrateLegacyCrossfade` → persistée via `updateTrack`, qui retire l'ancien champ) ou à l'ouverture de la modal d'édition (métadonnées audio). Même calcul que l'ancien fondu (% × durée, borné 0,5–5 s) : la durée entendue ne change pas
- Versions découpées (depuis #24) : `segments: { version: { start, end } }` (secondes), toujours lu via `track.segments || {}`. Toutes les versions découpées pointent sur le même fichier (`music/<id>_source<ext>`) : ne supprimer un fichier que si `isPathSharedByOtherVersion` (`backend/segments.js`) est faux. Lecture par sprite Howler `segment` ; temps/durée/seek de `Track` relatifs au segment ; un fondu vers une version découpée démarre au début de son segment
- Version de lancement (depuis #25) : `launchVersion` optionnel, lu via `resolveLaunchVersion()` (`backend/launchVersion.js`) : la version choisie si elle existe encore, sinon la première. Choisie en cliquant le libellé de version d'une ligne de playlist, ou un bouton de version du lecteur à l'arrêt. **`defaultVersion` n'est plus lu** : il vaut « calm » par défaut même sans version calm, le réutiliser changerait silencieusement la version de démarrage des pistes existantes
- Synchronisation BPM (depuis #18) : `tempo: { version: { bpm, offsetMs } }` optionnel, réglé dans la section « Avancé » de la modal d'édition, nettoyé par `sanitizeTempo()` (`backend/tempo.js`). Si les deux versions d'un changement en ont un, la reprise vaut `Z2 = (Z1 − Y1) × (X1 / X2) + Y2` (`beatSyncedPosition()`), ce qui prime sur « début du segment » (#24) et « même timecode ». Point d'entrée unique : `Track._startPositionFor()` (fondu, pause, fondu terminé avant chargement). Le tempo ne fait pas partie de la signature de piste : le changer ne recharge rien
- Un `Track` peut avoir plusieurs versions audio avec crossfade
- `webSecurity: false` dans BrowserWindow pour les `file://` URLs
- Dev : `make dev` ou `npm run dev` (Vite sur :3000 + electronmon)
- Electron **44** (depuis #37). Le binaire n'est plus téléchargé à `npm install` mais au premier `require('electron')` (lancement de `npm run dev`) ; à la main : `npx install-electron --no`
- Node **24** LTS, fixé par `mise.toml` (et `node-version` de `.github/workflows/release.yml`, à garder alignés). Electron 44 exige Node >= 22.12. Electron 37 ne s'installait pas sous Node 26 (`extract-zip`, electron/electron#51619), corrigé depuis la mise à jour
- Dialogues natifs : depuis Electron 43, sans `defaultPath` ils s'ouvrent toujours sur Téléchargements. Toujours passer par `showOpenDialog()` de `electron/main.cjs`, qui retient le dernier dossier choisi pendant la session

---

## Performances — Optimisation Electron (prioritaire)

L'application peut mettre plusieurs dizaines de secondes à s'ouvrir sous Windows. Épuiser toutes les optimisations Electron afin de réduire ce délai.

### Optimisations à appliquer dans l'ordre

1. **`show: false` + événement `ready-to-show`** sur la BrowserWindow — ne jamais afficher une fenêtre blanche qui freeze, attendre que le renderer soit prêt
2. **Lazy loading des modules backend** — ne pas importer `AudioManager`, `DatabaseManager`, `FileManager` tous en même temps au démarrage ; charger uniquement ce qui est nécessaire au boot initial
3. **Désactiver les devtools en production** — `webContents.openDevTools()` ne doit jamais être appelé dans un build prod
4. **Build Vite optimisé** — vérifier que l'ami tourne bien sur un build prod (`npm run build`) et non en mode dev ; le mode dev est significativement plus lent
5. **Réduire les IPC au démarrage** — limiter les appels IPC synchrones dans la séquence d'init ; préférer un seul appel `init` qui retourne toutes les données nécessaires plutôt que plusieurs appels successifs
6. **`backgroundThrottling: false`** si l'app tourne en arrière-plan pendant les sessions

### Indicateur de succès
Temps d'ouverture < 3 secondes sur la machine de l'ami (Windows).

---

## UI — Direction et principes

### Contexte d'usage
L'application est utilisée dans une ambiance tamisée, en soirée, pendant une session de JDR. L'interface doit être **lisible dans le noir, sans distraire**, mais avec une identité forte qui colle à l'univers fantasy/medieval.

### Direction artistique cible
**Thème : "Grimoire sonore"** — dark, organique, légèrement médiéval-fantastique sans être kitsch. Penser parchemin noir, encre dorée, runes discrètes. Pas de néon gaming, pas de flat design générique.

- **Palette :** fonds très sombres (presque noirs, pas noirs purs), accents dorés/ambrés (`#C9A84C`, `#E8C96A`), texte crème (`#F0E6C8`)
- **Typographie :** une font display avec caractère (ex : *Cinzel*, *IM Fell English*, *Philosopher*) pour les titres/labels importants ; une font lisible pour le corps
- **Effets :** légères textures (grain, vignette), transitions douces, pas d'animations agressives (l'app tourne en arrière-plan pendant une session)
- **Layout :** 2 panneaux principaux (Player | Bibliothèque), navigation sobre, modals claires

### Système de thèmes (depuis #19)
8 palettes sélectionnables dans Réglages, persistées dans `settings.theme`, appliquées via `document.documentElement.dataset.theme` + variables CSS (`[data-theme="x"]` dans `frontend/styles/themes.css`) : **nuit** (défaut), **grimoire**, **taverne**, **arcane**, **forêt**, **sang**, **givre**, **parchemin** (seul thème clair — le reste suit la direction "sombre, lisible dans le noir" ci-dessus).

Toute nouvelle palette doit garantir `--bone-dim` et `--gold-2` >= 4.5:1 (WCAG AA) contre `--ink-2` (le fond le plus clair où ils apparaissent réellement — cartes/panneaux) — c'est le pire cas, passer ce seuil garantit le reste. Vérifier par calcul (pas à l'oeil) ; `tests/theme-contrast.test.js` revérifie automatiquement les 8 thèmes existants à partir de tout le CSS, à étendre si une palette est ajoutée. Penser aussi à redéfinir `--ink-dark/warm/mid/top` (vignettage) et `color-scheme` dans le nouveau bloc — oubliés une fois, ça fait hériter du vignettage de "nuit" à la place du sien.

**Tous les textes (depuis #27)** : `tests/theme-contrast.test.js` vérifie aussi *chaque* couleur de texte du CSS, composée sur son fond, à >= 4.5:1 dans les 8 thèmes, et une taille minimale de 0.7rem (glyphes décoratifs `::before`/`::after` et contrôles `:disabled` exemptés). Conséquences :
- **Jamais de couleur de texte en dur** dans une règle : passer par une variable, redéfinie par thème si besoin (`--calm-*`, `--combat-*`, `--tension-*`, `--danger-*` existent déjà, avec des variantes claires dans « parchemin »)
- **`--bone-faint` (12 % d'opacité) est réservé au décor** (bordures, séparateurs, contrôles désactivés) — jamais comme couleur de texte : ~1.3:1. Texte secondaire = `--bone-dim`
- Un texte sur fond propre (bouton, pastille) se mesure contre ce fond : l'ajouter à la liste `withOwnBackground` du test

### Système d'internationalisation (depuis #22)
Français/anglais, fichiers maison (pas de lib i18n) dans `backend/i18n.js` — un seul module partagé par le renderer (`import`) et le processus main (`import()` dynamique dans `initManagers()`, comme `DatabaseManager`/`FileManager`). Le nom de l'app change avec la langue (`app.name` : "Jukebox JDR" / "Jukebox RPG"), pas juste le contenu.

- **Clés** : `zone.sousClé` en camelCase, `t(lang, key, vars)` interpole `{placeholder}` et retombe sur le français puis sur la clé brute si absente — jamais un écran vide.
- **HTML statique** : attributs `data-i18n` / `data-i18n-placeholder` / `data-i18n-tooltip`, appliqués par `applyTranslations()` (`frontend/renderer.js`) au chargement et à chaque changement de langue. Toute nouvelle chaîne d'UI statique doit être taguée ainsi plutôt que codée en dur.
- **Texte dynamique** (toasts, statuts, messages d'erreur) : passer par le wrapper local `t(key, vars)` de `renderer.js`, jamais une chaîne française codée en dur.
- **Piège classes CSS ⇄ texte traduit** : `updateStatus()` prend une clé stable (`'playing'|'paused'|'stopped'`) et non le texte affiché — le nom de classe CSS (`.status.playing` etc. dans `frontend/styles/player.css`) ne doit **jamais** dépendre du texte traduit, sinon changer de langue casse le style. Même piège à surveiller pour toute future dérivation classe-depuis-texte.
- **Sélecteur `.theme-card`** : réutilisé à la fois par la grille de thèmes (`#theme-grid`) et la grille de langue (`#language-grid`) pour le style — toujours scoper les listeners JS (`#theme-grid .theme-card` / `#language-grid .theme-card`), jamais `.theme-card` seul, sous peine de croiser les deux (`applyTheme(undefined)` sur un clic de langue).
- **Dialogues natifs Electron** (`dialog.showOpenDialog`) : langue suivie séparément dans `electron/main.cjs` (variable `currentLanguage`, mise à jour par `settings:save`) car les handlers `dialog:openFiles`/`dialog:openFolder` n'attendent pas `managersReadyPromise` et ne peuvent pas relire `dbManager.getSettings()` à la demande.
- `tests/i18n.test.js` vérifie que les deux dictionnaires ont exactement le même jeu de clés (parité fr/en) — à garder au vert : une clé oubliée dans une langue retombe silencieusement sur l'autre plutôt que de planter, donc seul ce test l'attrape.

### Règles UI à respecter
- Modals (depuis #41) : `<dialog class="modal" aria-labelledby>` ouvertes par `openModal()` / fermées par `closeModal()` (`frontend/modal.js`), jamais par la classe `hidden` ni `body.style.overflow`. Le navigateur gère l'arrière-plan inerte, Échap et `aria-modal` ; le premier champ porte `autofocus`. **Pas de fermeture au clic sur le fond** (perte de réglages en session). Si la fermeture déclenche un rechargement qui recrée le bouton d'origine, passer `closeModal(d, { restoreFocusAfter: promesse })`. Le tooltip se déplace dans la modal ouverte (couche supérieure). Vérifié par `tests/modals.test.js`
- Menu des playlists (depuis #40) : `currentPlaylistId` est la **seule** source de la playlist sélectionnée (plus de `<select>` caché), `playlistsCache` donne les noms. Liste accessible via `createListbox()` (`frontend/listbox.js`, modèle Select shadcn/Radix) : `aria-expanded`, `listbox`/`option`, ↑/↓/Début/Fin, recherche par lettre, Entrée/Espace, Échap/Tab. Entrée active repérée par `data-id`, jamais par nom (`markActivePlaylist()`)
- Curseurs (depuis #39) : un seul style `input[type="range"]` dans `frontend/styles/sliders.css` (vérifié par `tests/sliders.test.js`). La partie remplie suit `--fill`, tenu à jour par `initRangeFill()` (`frontend/rangeFill.js`) : saisie, `.value =` posé par le code (setter remplacé sur chaque curseur) et changement de min/max. `@property --fill` doit garder `inherits: true`, sinon la piste reste vide. La progression est un curseur (`frontend/progressSlider.js`) : un seul seek au relâchement, clavier ←/→ 5 s, PgPréc/PgSuiv 30 s, Début/Fin
- Tooltips (depuis #38) : jamais de `title` natif (bulle système grise qui ignore le thème). HTML statique : `data-tooltip` + `data-i18n-tooltip` ; JS : `setTooltip(el, texte)` (`frontend/tooltip.js`), qui pose aussi `aria-label` sur un élément sans lettre ni chiffre visible (⏮, ✕…). Un seul `#app-tooltip` piloté par délégation : 500 ms au survol, immédiat dans les 300 ms après une fermeture et au focus clavier. Logique pure (placement, minuterie) dans `frontend/tooltipPosition.js` ; `tests/tooltip.test.js` refuse tout retour de `title`
- Mouvement : durées et pulsations via les jetons de `:root` (`frontend/styles/base.css`) : `--duration-fast/base/slow` (150/200/300 ms) et `--pulse-fast/medium/slow` (1,2/2,5/3 s). Jamais de durée en dur ni de `transition: all` : nommer les propriétés que les états changent vraiment. Le garde `prefers-reduced-motion` (fin de `base.css`) rend tout quasi instantané sauf `.toast-progress`. Score transitions-agent : 55 → 84 ; ses deux remarques restantes sur les survols sont voulues (dégradé non animable, largeur de bordure)
- CSS découpé (depuis la passe « motion ») : `frontend/styles.css` ne contient que des `@import` vers `frontend/styles/*.css`, regroupés par Vite. **L'ordre des `@import` est l'ordre de la cascade.** Chaque fichier reste < 40 000 octets (limite au-delà de laquelle transitions-agent ignore un fichier en silence), vérifié par `tests/styles-split.test.js`. Les tests qui lisent le CSS passent par `readStyles()` (`tests/helpers/readStyles.js`), jamais par `readFileSync('styles.css')`
- Scrollbars (depuis #30) : un seul style global dans `frontend/styles/base.css` (`scrollbar-width: thin` + `scrollbar-color` via `--scroll-thumb`/`--scroll-thumb-hover`/`--scroll-track`), jamais masquées ; toute zone `overflow: auto` déclare `scrollbar-gutter: stable` (pas de saut de mise en page). Pas de `::-webkit-scrollbar` : ignoré par le Chromium d'Electron dès que `scrollbar-color` est défini. Vérifié par `tests/scrollbar.test.js`
- Inputs avec labels clairs et taille de texte lisible (bug de l'input trop petit pour nom de version/musique)
- Popup d'ajout de musique modale propre, pas inline (`<dialog>`, voir « Modals »)
- Pas de layout qui "saute" quand une modal s'ouvre

---

## Bugs connus à corriger

Traiter dans cet ordre de priorité :

1. **Bug lecture Windows** — Une piste ne se lance qu'au deuxième clic. Probablement un timing Howler.js / IPC non résolu au premier `play()`. Investiguer `onload` vs `onplay` et s'assurer que le son est bien chargé avant `play()`.

2. **Input trop petit** — Les champs nom de version et nom de musique ont une taille inadaptée. Revoir le sizing CSS de tous les `<input>` dans les modals et formulaires inline.

3. ~~**Scrollbar visible à droite**~~ — remplacé par [#30](https://github.com/RAbdGen/JukeBox_DnD/issues/30) (fait) : scrollbars fines stylées par le thème, plus jamais masquées.

4. **Version 1 par défaut au changement de piste** — Quand on change de musique active, remettre la version index 0 comme version courante dans `AudioManager.js`, **sauf version de lancement choisie** par l'utilisateur (#25, `track.launchVersion`, voir « Stack technique »).

5. ~~**Transitions en % plutôt qu'en secondes**~~ — fait (#17), puis inversé par [#28](https://github.com/RAbdGen/JukeBox_DnD/issues/28) (fait) : la durée de fondu est désormais réglée en **secondes**.

---

## Fonctionnalités à implémenter

### Découpe de piste en versions — fait (#24)
Onglet **Découpage** (à la place d'« Effets ») : un fichier, découpé à la main sur une waveform zoomable, devient une musique à plusieurs versions ; retouche via le bouton ✂ de la bibliothèque. Design : `docs/superpowers/specs/2026-09-28-decoupage-design.md`. Stockage : objet `segments` indexé par version (voir « Stack technique »), pas un tableau. Le fichier source n'est jamais modifié.

### À venir (backlog, pas de spec complète)

- Fonctionnalités supplémentaires à définir au fil des sessions de dev

---

## Workflow des agents

### Synchronisation des instructions d'agents
`CLAUDE.md` et `AGENTS.md` sont deux copies strictement identiques de ces instructions. Toute modification de l'un doit être reportée dans l'autre au cours du même changement, puis leur identité doit être vérifiée.

Cette duplication reste en place tant que les agents Claude ne lisent pas nativement `AGENTS.md`. Les agents doivent lire `AGENTS.md` avant d'intervenir ; les agents Claude qui n'en disposent pas doivent également lire `CLAUDE.md`.

### Principe général
- **Tâches simples / bugs isolés / optimisations** → Claude Code travaille en autonomie, commit direct
- **Refactorings larges / nouvelles features** → itératif : plan d'abord, validation avant exécution, commits intermédiaires

### Synchronisation du repo après chaque changement
Après tout changement (bugfix, feature, correctif de review), maintenir le repo à jour, pas seulement le code :
- **Issues GitHub** — fermer/commenter les issues concernées par le changement (`gh issue close`, `gh issue comment`), en créer une nouvelle si un bug ou une piste d'amélioration est découvert en cours de route
- **Backlog CLAUDE.md** — retirer ou déplacer les items traités, ajouter les nouvelles pistes identifiées
- **Project GitHub** (backlog) — refléter les mêmes mouvements côté Project (statut/priorité des items correspondants) via `gh project item-edit`
- Ces mises à jour font partie de la tâche, pas une étape séparée à demander explicitement

### Suivi GitHub
Le [project « JukeBox_DnD Backlog »](https://github.com/users/RAbdGen/projects/2) répertorie toutes les issues ci-dessous. À chaque changement d'état, mettre à jour l'issue, le project, puis cette liste dans les deux fichiers d'instructions.

**Terminées (`Done`) :**
- [#1 — Undo suppression piste/playlist](https://github.com/RAbdGen/JukeBox_DnD/issues/1)
- [#2 — Raccourcis clavier globaux (play/pause/next/mute)](https://github.com/RAbdGen/JukeBox_DnD/issues/2)
- [#3 — Mute rapide / fade-out d'urgence](https://github.com/RAbdGen/JukeBox_DnD/issues/3)
- [#4 — Normalisation de volume entre pistes](https://github.com/RAbdGen/JukeBox_DnD/issues/4)
- [#5 — Tags/recherche dans la bibliothèque](https://github.com/RAbdGen/JukeBox_DnD/issues/5)
- [#6 — Preview audio au survol d'une piste](https://github.com/RAbdGen/JukeBox_DnD/issues/6)
- [#7 — Export/import de la bibliothèque (backup)](https://github.com/RAbdGen/JukeBox_DnD/issues/7)
- [#8 — Normalisation de volume par piste cassée par plusieurs flux](https://github.com/RAbdGen/JukeBox_DnD/issues/8)
- [#9 — Import de bibliothèque : écrase des fichiers et plante sur données malformées](https://github.com/RAbdGen/JukeBox_DnD/issues/9)
- [#10 — État désynchronisé pendant la fenêtre d'annulation (toast undo)](https://github.com/RAbdGen/JukeBox_DnD/issues/10)
- [#11 — Le timer de preview au survol survit à un re-rendu de la bibliothèque](https://github.com/RAbdGen/JukeBox_DnD/issues/11)
- [#12 — fadeVolume() ignore un ajustement manuel du slider pendant le fondu](https://github.com/RAbdGen/JukeBox_DnD/issues/12)
- [#20 — Temps de démarrage très long sur machine modeste (8Go RAM) + loading screen](https://github.com/RAbdGen/JukeBox_DnD/issues/20) — NSIS + écran de chargement, à reconfirmer sur la machine de l'ami au prochain build
- [#13 — Ajouter une piste à la playlist coupe la lecture en cours](https://github.com/RAbdGen/JukeBox_DnD/issues/13) — `AudioManager.loadPlaylist()` diff-aware, ne stoppe/recharge plus que ce qui a réellement changé
- [#14 — Impossible de réordonner ou supprimer une piste dans une playlist existante](https://github.com/RAbdGen/JukeBox_DnD/issues/14) — boutons ↑/↓/✕ par piste + `reorderPlaylistTracks()`
- [#15 — Gestion des versions d'une piste (réordonner/ajouter/supprimer) dans la modal d'édition](https://github.com/RAbdGen/JukeBox_DnD/issues/15)
- [#16 — Remplacer le preview au survol par un bouton preview](https://github.com/RAbdGen/JukeBox_DnD/issues/16) — bouton explicite ▶/⏸ par piste
- [#17 — Personnalisation : durée de fondu (crossfade) réglable](https://github.com/RAbdGen/JukeBox_DnD/issues/17) — réglage par piste dans la modal d'édition
- [#19 — Contraste de texte insuffisant (tous thèmes)](https://github.com/RAbdGen/JukeBox_DnD/issues/19) — élargi en système de 8 thèmes WCAG AA, voir section "Système de thèmes" plus haut
- [#21 — Renommer l'application « JukeBox & DnD » → « Jukebox JDR »](https://github.com/RAbdGen/JukeBox_DnD/issues/21) — au passage, dossier `userData` figé explicitement (voir section "Build et distribution")
- [#22 — Version anglaise de l'application (« Jukebox RPG »)](https://github.com/RAbdGen/JukeBox_DnD/issues/22) — i18n complète (UI + messages dynamiques + dialogues natifs), voir section "Système d'internationalisation" plus haut
- [#23 — Actions pendant un fondu / switch de musique cassent l'état de lecture (lié au mode de boucle)](https://github.com/RAbdGen/JukeBox_DnD/issues/23) — boucle appliquée à toutes les versions, fondu annulable/terminable, voir « Notes importantes »
- [#28 — Durée de fondu en secondes plutôt qu'en pourcentage](https://github.com/RAbdGen/JukeBox_DnD/issues/28) — `crossfadeDurationSeconds`, migration exacte différée (voir « Champs optionnels sur un track »)
- [#29 — Le mute reprend la durée de fondu de la piste active](https://github.com/RAbdGen/JukeBox_DnD/issues/29) — 300 ms si aucune piste active
- [#31 — Renommer le mode de lecture « Normal » → « Une fois » / « Once »](https://github.com/RAbdGen/JukeBox_DnD/issues/31)
- [#24 — Onglet « Découpage » à la place de « Effets » : découper une musique en versions](https://github.com/RAbdGen/JukeBox_DnD/issues/24) — voir « Découpe de piste en versions » plus haut
- [#32 — Les versions modifiées d'une piste de la playlist active ne sont pas rechargées](https://github.com/RAbdGen/JukeBox_DnD/issues/32) — `loadPlaylist` reconstruit une piste dont les versions/fichiers/segments ont changé
- [#27 — Contraste insuffisant des petits textes (tous thèmes)](https://github.com/RAbdGen/JukeBox_DnD/issues/27) — `--bone-faint` utilisé comme texte (~1.3:1), couleurs en dur illisibles sur « parchemin », tailles < 0.7rem ; test étendu à tous les textes
- [#25 — Choisir la version de lancement en cliquant sur une version](https://github.com/RAbdGen/JukeBox_DnD/issues/25) — `launchVersion` par piste, libellé cliquable dans la liste + boutons du lecteur à l'arrêt
- [#26 — Raccourci clavier personnalisable pour changer de version](https://github.com/RAbdGen/JukeBox_DnD/issues/26) — version suivante + versions 1 à 3, globaux, réglables dans Réglages
- [#30 — Scrollbar intégrée au thème](https://github.com/RAbdGen/JukeBox_DnD/issues/30) — style global via variables du thème, `scrollbar-gutter: stable`
- [#18 — Personnalisation : synchronisation BPM entre versions (mode avancé)](https://github.com/RAbdGen/JukeBox_DnD/issues/18) — `tempo` par version, reprise calée sur les temps, section « Avancé » de la modal d'édition
- [#33 — Découpage : l'écoute continue hors de l'onglet, et ✂ écrase une découpe non enregistrée](https://github.com/RAbdGen/JukeBox_DnD/issues/33)
- [#34 — Pistes découpées : bornes non revalidées côté base, fichier orphelin, import qui recopie le fichier partagé](https://github.com/RAbdGen/JukeBox_DnD/issues/34)
- [#35 — Lecture : petits écarts de position (fondu échoué, seek ≥ 1000 s, fin de segment au-delà du fichier)](https://github.com/RAbdGen/JukeBox_DnD/issues/35)
- [#37 — Mettre à jour Electron 37 → version supportée (≥ 40)](https://github.com/RAbdGen/JukeBox_DnD/issues/37) — Electron 44, dialogues qui retiennent le dernier dossier
- [#38 — Tooltips thémés à la place des title natifs](https://github.com/RAbdGen/JukeBox_DnD/issues/38) — modèle du Tooltip shadcn/Radix, en vanilla
- [#39 — Curseurs thémés + barre de progression manipulable](https://github.com/RAbdGen/JukeBox_DnD/issues/39) — modèle du Slider shadcn, glisser/clavier sur la progression
- [#40 — Liste des playlists accessible + source unique de la playlist sélectionnée](https://github.com/RAbdGen/JukeBox_DnD/issues/40) — corrige au passage la restauration de la dernière playlist au démarrage
- [#41 — Modals accessibles (dialog natif)](https://github.com/RAbdGen/JukeBox_DnD/issues/41) — modèle du Dialog shadcn/Radix, sans fermeture au clic sur le fond

**À faire (`Todo`) :**
- [#42 — Changer de version fait repartir la musique du début (sur certaines pistes)](https://github.com/RAbdGen/JukeBox_DnD/issues/42) — bloquant, patch v2.0.1 ; cause à identifier (piste découpée, BPM ou durées différentes)
- [#43 — Fondu à la pause et à la reprise (durée de fondu de la piste)](https://github.com/RAbdGen/JukeBox_DnD/issues/43) — patch v2.0.1 ; la pause n'a jamais eu de fondu (c'était le mute, #3/#29)
- [#36 — Mesurer la mémoire de l'onglet Découpage avec un fichier d'1 h (machine 8 Go)](https://github.com/RAbdGen/JukeBox_DnD/issues/36) — mesure manuelle sur la machine de l'ami avant la prochaine release

### Conventions de code
- ESM partout sauf les fichiers `.cjs` d'Electron (ne pas toucher au module system sans raison)
- Pas de framework JS côté frontend (Vanilla JS, pas de React/Vue) sauf décision explicite
- Nommage : camelCase pour les variables/fonctions, PascalCase pour les classes
- Commentaires en français ou anglais (le projet mélange les deux, c'est ok)

### Ordre recommandé pour les interventions
1. Corriger les bugs listés ci-dessus
2. Optimisations performances Electron
3. Refonte UI (peut se faire en parallèle des bugfixes frontend)
4. Implémenter la feature de découpe de piste
5. Backlog features

### À ne jamais faire sans validation explicite
- Changer le schema de la DB (`data.json`) sans migration automatique
- Modifier `electron/main.cjs` en profondeur sans avoir vérifié la compatibilité IPC
- Introduire un framework JS frontend (React, Vue, Svelte) sans accord explicite
- Supprimer des fichiers audio de `userData/music/` autrement que via `FileManager.js`

---

## Build et distribution

```bash
# Dev
make dev           # Vite :3000 + electronmon

# Build Electron
npm run build      # Vite d'abord, puis electron-builder

```

**Distribution automatisée via GitHub Actions :**
- `.github/workflows/release.yml` — sur un tag `v*`, build Linux (AppImage) + Windows (installeur NSIS) sur des runners GitHub natifs (pas besoin du dual-boot), publie une GitHub Release avec les deux artefacts
- Déclenchement manuel possible (`workflow_dispatch`) pour tester le build sans créer de release
- Le dual-boot reste utile pour tester l'app en conditions réelles (surtout Windows), mais n'est plus nécessaire pour produire les installeurs
- **Windows : NSIS plutôt que portable** (depuis #20) — le mode portable d'electron-builder auto-extrait toute l'app dans un dossier temp à *chaque* lancement, identifié comme cause probable des dizaines de secondes de démarrage remontées sur une machine modeste. NSIS installe une fois (`oneClick: true`, `perMachine: false` — pas de droits admin nécessaires) puis lance directement le binaire installé. `data.json`/`music/` restent dans `app.getPath('userData')`, indépendant du mode d'installation : une désinstallation NSIS ne touche pas ce dossier par défaut (`deleteAppDataOnUninstall` volontairement non activé)
- **Dossier `userData` figé explicitement** (depuis #21) — `electron/main.cjs` appelle `app.setPath('userData', ...)` avec le nom stable `jukebox` (celui de `package.json`, jamais celui de `productName`/branding). `%APPDATA%\jukebox\` sous Windows, `~/.config/jukebox` sous Linux. But : un futur changement de nom d'affichage (comme #21 qui passe `productName` à "Jukebox JDR") ne doit jamais faire migrer silencieusement `data.json`/`music/` vers un autre dossier — ne jamais changer cette valeur sans plan de migration explicite

---

## Notes importantes

- `webSecurity: false` est une dette technique : la documenter et ne pas l'aggraver
- Howler.js est le seul moteur audio, ne pas le remplacer — il gère bien les sprites et le crossfade
- **Crossfade et actions concurrentes (depuis #23)** — un fondu en cours est un état explicite de `Track` (`_crossfade` : timers + écouteur de chargement), jamais des `setTimeout` orphelins. Règles : nouveau changement de version → le fondu en cours est terminé immédiatement puis on enchaîne ; pause / seek → terminé immédiatement, l'action s'applique à la version cible ; stop / autre piste / `play()` → annulé, rien ne redémarre. Toute nouvelle action de lecture doit choisir explicitement l'un de ces trois comportements
- **Boucle unique** : le mode `loopOne` est porté par `Track.loop` et appliqué à *toutes* les versions (`Track.setLoop()`), sinon la version atteinte par crossfade ne boucle pas et la lecture s'arrête en silence. `nextTrack()` change toujours de piste (action explicite) ; seule la fin naturelle (`onTrackEnd`) respecte la boucle unique. Seule la fin de la version *active* déclenche `onEndCallback` (pas celle de la version sortante d'un fondu)
- **Howler — seek après play** : `stop()` puis `play()` recycle le son (`reset()`, position 0) ; un `seek()` fait avant `play()` est perdu. Toujours `const id = howl.play(…); howl.seek(position, id)`. Getter : `howl.seek()` sans argument (un id périmé serait pris pour une position)
- **Raccourcis globaux** (#2, #26) : fixes (touches média, `Ctrl+Alt+M`) enregistrés par `registerGlobalShortcuts()`, et raccourcis de version personnalisables (`settings.shortcuts`, défauts `Ctrl+Alt+V` / `Ctrl+Alt+1..3`, `null` = désactivé) enregistrés par `registerVersionShortcuts()` depuis les réglages. Logique pure (validation, conflits, frappe → combinaison) dans `backend/shortcuts.js` ; `FIXED_SHORTCUTS` doit rester aligné sur `registerGlobalShortcuts()` (vérifié par `tests/shortcuts.test.js`). Un raccourci global exige Ctrl/Alt/Super, sinon il volerait la touche à toutes les applis. Pendant la capture dans les Réglages, les raccourcis de version sont suspendus (`shortcuts:suspend`/`resume`), sinon le système intercepte la combinaison
- Reprise : passer par `Track.resume()`, jamais `howl.play()` direct — sur un Howl qui joue déjà, `play()` sans id crée une seconde instance superposée
- Le fichier `améliorations.txt` est hors git intentionnellement, son contenu est désormais intégré dans ce CLAUDE.md
