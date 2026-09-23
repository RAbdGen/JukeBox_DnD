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
- Un `Track` peut avoir plusieurs versions audio avec crossfade
- `webSecurity: false` dans BrowserWindow pour les `file://` URLs
- Dev : `make dev` ou `npm run dev` (Vite sur :3000 + electronmon)

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

**À faire (`Todo`) :**
- [#13 — Ajouter une piste à la playlist coupe la lecture en cours](https://github.com/RAbdGen/JukeBox_DnD/issues/13) — priorité haute
- [#14 — Impossible de réordonner ou supprimer une piste dans une playlist existante](https://github.com/RAbdGen/JukeBox_DnD/issues/14) — priorité haute
- [#19 — Contraste de texte insuffisant (tous thèmes)](https://github.com/RAbdGen/JukeBox_DnD/issues/19) — priorité haute
- [#15 — Gestion des versions d'une piste (réordonner/ajouter/supprimer) dans la modal d'édition](https://github.com/RAbdGen/JukeBox_DnD/issues/15) — priorité moyenne
- [#16 — Remplacer le preview au survol par un bouton preview](https://github.com/RAbdGen/JukeBox_DnD/issues/16) — priorité moyenne
- [#17 — Personnalisation : durée de fondu (crossfade) réglable](https://github.com/RAbdGen/JukeBox_DnD/issues/17) — priorité moyenne
- [#18 — Personnalisation : synchronisation BPM entre pistes avec décalage](https://github.com/RAbdGen/JukeBox_DnD/issues/18) — priorité basse, faisabilité non étudiée

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
- **Windows : NSIS plutôt que portable** (depuis #20) — le mode portable d'electron-builder auto-extrait toute l'app dans un dossier temp à *chaque* lancement, identifié comme cause probable des dizaines de secondes de démarrage remontées sur une machine modeste. NSIS installe une fois (`oneClick: true`, `perMachine: false` — pas de droits admin nécessaires) puis lance directement le binaire installé. `data.json`/`music/` restent dans `app.getPath('userData')` (`%APPDATA%\JukeBox DnD\` sous Windows), indépendant du mode d'installation : une désinstallation NSIS ne touche pas ce dossier par défaut (`deleteAppDataOnUninstall` volontairement non activé)

---

## Notes importantes

- `webSecurity: false` est une dette technique : la documenter et ne pas l'aggraver
- Howler.js est le seul moteur audio, ne pas le remplacer — il gère bien les sprites et le crossfade
- Le fichier `améliorations.txt` est hors git intentionnellement, son contenu est désormais intégré dans ce CLAUDE.md
