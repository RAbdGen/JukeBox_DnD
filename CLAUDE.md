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
- Un `Track` peut avoir plusieurs versions audio avec crossfade
- `webSecurity: false` dans BrowserWindow pour les `file://` URLs
- Dev : `make dev` ou `npm run dev` (Vite sur :3000 + electronmon)

---

## Performances — Optimisation Electron (prioritaire)

L'application peut mettre plusieurs dizaines de secondes à s'ouvrir sous Windows. Avant d'envisager une migration vers Tauri, **épuiser toutes les optimisations Electron** — les gains peuvent être suffisants et évitent un chantier de migration majeur.

### Optimisations à appliquer dans l'ordre

1. **`show: false` + événement `ready-to-show`** sur la BrowserWindow — ne jamais afficher une fenêtre blanche qui freeze, attendre que le renderer soit prêt
2. **Lazy loading des modules backend** — ne pas importer `AudioManager`, `DatabaseManager`, `FileManager` tous en même temps au démarrage ; charger uniquement ce qui est nécessaire au boot initial
3. **Désactiver les devtools en production** — `webContents.openDevTools()` ne doit jamais être appelé dans un build prod
4. **Build Vite optimisé** — vérifier que l'ami tourne bien sur un build prod (`npm run build`) et non en mode dev ; le mode dev est significativement plus lent
5. **Réduire les IPC au démarrage** — limiter les appels IPC synchrones dans la séquence d'init ; préférer un seul appel `init` qui retourne toutes les données nécessaires plutôt que plusieurs appels successifs
6. **`backgroundThrottling: false`** si l'app tourne en arrière-plan pendant les sessions

### Indicateur de succès
Temps d'ouverture < 3 secondes sur la machine de l'ami (Windows). Si après toutes ces optimisations le temps reste > 5 secondes, envisager la migration Tauri.

### Migration Tauri — option conditionnelle
Si les optimisations Electron ne suffisent pas, Tauri est l'alternative. Tauri utilise le WebView natif de l'OS (WebView2 sur Windows) au lieu d'embarquer Chromium (~150 Mo), ce qui réduit drastiquement le démarrage.

**Contraintes si migration :**
- Builds manuels uniquement depuis le dual-boot (pas de cross-compilation Linux→Windows avec Tauri)
- Le développeur a des bases Rust (peut lire, pas expert) → minimiser le code Rust custom, utiliser les plugins officiels
- Le frontend Vite et Howler.js sont compatibles Tauri sans modification

| Electron | Tauri équivalent |
|---|---|
| `ipcMain` / `ipcRenderer` | `#[tauri::command]` + `invoke()` |
| `app.getPath('userData')` | `tauri::api::path::app_data_dir()` |
| `fs` Node.js | Plugin `tauri-plugin-fs` |
| `dialog.showOpenDialog` | Plugin `tauri-plugin-dialog` |
| `webSecurity: false` | asset protocol natif Tauri |

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

### Règles UI à respecter
- Scrollbar custom ou masquée (le bug de scrollbar visible à droite doit être réglé)
- Inputs avec labels clairs et taille de texte lisible (bug de l'input trop petit pour nom de version/musique)
- Popup d'ajout de musique modale propre, pas inline
- Pas de layout qui "saute" quand une modal s'ouvre

---

## Bugs connus à corriger

Traiter dans cet ordre de priorité :

1. **Bug lecture Windows** — Une piste ne se lance qu'au deuxième clic. Probablement un timing Howler.js / IPC non résolu au premier `play()`. Investiguer `onload` vs `onplay` et s'assurer que le son est bien chargé avant `play()`.

2. **Input trop petit** — Les champs nom de version et nom de musique ont une taille inadaptée. Revoir le sizing CSS de tous les `<input>` dans les modals et formulaires inline.

3. **Scrollbar visible à droite** — Masquer la scrollbar native sur le conteneur principal tout en conservant le scroll fonctionnel. CSS : `scrollbar-width: none` (Firefox) + `::-webkit-scrollbar { display: none }` (Chromium/WebView2).

4. **Version 1 par défaut au changement de piste** — Quand on change de musique active, toujours remettre la version index 0 comme version courante dans `AudioManager.js`.

5. **Transitions en % plutôt qu'en secondes** — Dans `Track.js`, remplacer la durée de crossfade absolue (secondes) par un pourcentage de la durée totale de la piste. Nécessite de récupérer `Howl.duration()` après chargement.

---

## Fonctionnalités à implémenter

### Prioritaire — Découpe de piste en versions
Permettre de prendre un fichier audio unique et de le découper en segments temporels pour créer les différentes versions d'un Track (ex : 0:00–1:30 = `calm`, 1:30–3:00 = `combat`).

- UI : dans la modal d'édition d'un Track, afficher une waveform simplifiée ou une timeline avec des marqueurs déplaçables
- Backend : stocker les segments comme `{ version: "combat", start: 90, end: 180 }` dans le schema DB
- Lecture : utiliser `Howl` avec `sprite` pour lire uniquement le segment défini
- Ne pas modifier/couper le fichier source sur le disque — tout est géré en mémoire/metadata

### À venir (backlog, pas de spec complète)
- Fonctionnalités supplémentaires à définir au fil des sessions de dev

---

## Workflow Claude Code

### Principe général
- **Tâches simples / bugs isolés / optimisations** → Claude Code travaille en autonomie, commit direct
- **Refactorings larges / nouvelles features / migration Tauri éventuelle** → itératif : plan d'abord, validation avant exécution, commits intermédiaires

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
6. Migration Tauri (seulement si les perfs Electron restent insatisfaisantes après optimisation)

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

# Build Tauri (si migration décidée)
npm run tauri build   # Vite + cargo build --release
```

**Distribution manuelle (pas de CI) :**
- Linux : build depuis le système Linux du dual-boot → AppImage
- Windows : build depuis le système Windows du dual-boot → NSIS installer ou portable .exe
- Si migration Tauri : cross-compilation Linux→Windows non supportée, toujours builder sur l'OS cible

---

## Notes importantes

- `webSecurity: false` est une dette technique — à éliminer si migration Tauri (utiliser l'asset protocol à la place), sinon documenter et ne pas aggraver
- Howler.js est le seul moteur audio, ne pas le remplacer — il gère bien les sprites et le crossfade
- Le fichier `améliorations.txt` est hors git intentionnellement, son contenu est désormais intégré dans ce CLAUDE.md
