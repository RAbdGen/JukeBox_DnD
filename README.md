# 🎵 Jukebox JDR 🎲

Application desktop de musique d'ambiance pour les sessions de jeu de rôle. Une musique peut avoir plusieurs *versions* (`calm`, `combat`, `tension`…) : le MJ passe de l'une à l'autre en fondu, sans quitter le jeu des yeux, et la musique reprend au même moment (ou sur le même temps de la mesure).

En anglais, l'application s'appelle **Jukebox RPG**.

![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat&logo=electron)
![Node.js](https://img.shields.io/badge/Node.js-24_LTS-339933?style=flat&logo=node.js)
![Howler.js](https://img.shields.io/badge/Howler.js-2.2.4-E85D75?style=flat)
![Vitest](https://img.shields.io/badge/Vitest-256_tests-6E9F18?style=flat)

## 📥 Installer l'application

Télécharger la dernière version sur la page [Releases](https://github.com/RAbdGen/JukeBox_DnD/releases/latest) :

- **Windows** : `Jukebox.JDR-Setup-x.y.z.exe`, un installeur sans droits administrateur. Une mise à jour s'installe par-dessus l'ancienne version.
- **Linux** : `Jukebox.JDR-x.y.z.AppImage`, à rendre exécutable puis à lancer.

Les données (bibliothèque, playlists, réglages et fichiers audio copiés) sont conservées entre les versions, dans `%APPDATA%\jukebox\` sous Windows et `~/.config/jukebox/` sous Linux. La désinstallation n'y touche pas.

## ✨ Fonctionnalités

### Musique et versions
- 🎵 **Plusieurs versions par musique**, avec un fondu réglable par piste (de 0,5 à 10 s)
- ✂️ **Onglet Découpage** : on découpe un seul fichier en versions à la main, sur une waveform zoomable. Le fichier d'origine n'est jamais modifié
- 🥁 **Synchronisation au tempo** (mode avancé) : avec un BPM et un premier temps par version, le changement reprend sur le même temps de la mesure
- 🎯 **Version de lancement** : choisie par piste, d'un clic sur son nom de version
- ⏯️ **Pause et reprise en fondu**, et **mute d'urgence** progressif

### Pendant la session
- ⌨️ **Raccourcis globaux**, actifs même quand l'app est en arrière-plan :
  - lecture/pause, piste suivante et précédente avec les touches média ;
  - mute : `Ctrl+Alt+M` ;
  - version suivante : `Ctrl+Alt+V` ; versions 1 à 3 : `Ctrl+Alt+1..3`, modifiables dans Réglages.
- 🔁 **Modes de lecture** : Une fois, Boucle sur une piste, Tout répéter
- 📍 **Barre de progression manipulable** à la souris (glisser) et au clavier

### Bibliothèque
- 📚 **Grimoire** (la bibliothèque) avec tags, recherche et bouton d'écoute
- 📋 **Playlists** : réordonner les pistes, les retirer, annuler une suppression
- 🎚️ **Volume par piste**, indépendant du volume général
- 💾 **Export et import** de toute la bibliothèque (sauvegarde ou changement de machine)
- 🔄 **Reprise de la dernière playlist** au démarrage

### Interface
- 🌙 **8 thèmes** : nuit, grimoire, taverne, arcane, forêt, sang, givre, parchemin (le seul clair). Le contraste des textes est vérifié automatiquement (WCAG AA)
- 🇫🇷 🇬🇧 **Français et anglais**, y compris les fenêtres système
- ♿ **Utilisable au clavier** :
  - bulles d'aide, curseurs, menu des playlists et fenêtres sur le modèle des composants shadcn/Radix ;
  - le clavier reste dans une fenêtre ouverte, et Échap la ferme ;
  - les animations sont réduites quand le système le demande.

## 🧑‍💻 Développement

### Prérequis

- **Node 24 LTS**, fixé par `mise.toml`. Avec [mise](https://mise.jdx.dev), la bonne version est prise automatiquement dans le dossier. Évitez Node 26 : l'installeur d'Electron 37 y échouait en silence, et Node 24 reste la version testée.
- `make` (facultatif : chaque commande a son équivalent `npm`).

```bash
git clone https://github.com/RAbdGen/JukeBox_DnD.git
cd JukeBox_DnD
make install
make dev          # Vite sur :3000 + Electron, rechargé à chaque modification
```

Le binaire Electron n'est pas téléchargé par `npm install` mais au premier lancement de `make dev` (ou à la main avec `npx install-electron --no`).

> Sous Linux, si l'app refuse de démarrer à cause du sandbox : `make dev-nosandbox`

### Commandes

| Commande | Description |
|---|---|
| `make dev` | Mode développement |
| `make dev-nosandbox` | Mode développement, sandbox désactivé (Linux) |
| `make start` | Lance l'application à partir du build |
| `make test` / `make test-watch` | Tests Vitest, une fois ou en continu |
| `make lint` | ESLint (règles recommandées, `eslint.config.js`) |
| `make build` | Build complet (Vite + electron-builder) |
| `make build-linux` | AppImage Linux |
| `make build-win` | Installeur NSIS Windows |
| `make audit` | Audit de sécurité npm |
| `make clean` / `make reset` | Nettoyage, ou nettoyage + réinstallation |
| `make info` / `make status` | Versions et état du projet |
| `make help` | Toutes les commandes |

### Structure

```
JukeBox_DnD/
├── electron/
│   ├── main.cjs            # Processus principal : fenêtre, IPC, raccourcis globaux, dialogues
│   └── preload.cjs         # contextBridge → window.electronAPI
├── backend/                # Modules ESM partagés (logique pure testée)
│   ├── AudioManager.js     # Playlist, lecture, changements de version
│   ├── Track.js            # Une musique et ses versions Howler (fondus, pause, positions)
│   ├── DatabaseManager.js  # Persistance lowdb (data.json)
│   ├── FileManager.js      # Copie et suppression des fichiers audio
│   ├── ImportManager.js    # Fusion d'une bibliothèque importée
│   ├── segments.js         # Versions découpées
│   ├── tempo.js            # Synchronisation au tempo
│   ├── shortcuts.js        # Raccourcis de version (validation, conflits)
│   └── i18n.js             # Traductions français / anglais
├── frontend/
│   ├── index.html
│   ├── renderer.js         # Interface et appels IPC
│   ├── cutterView.js       # Onglet Découpage (waveform.js, segmentModel.js)
│   ├── tooltip.js, listbox.js, modal.js, progressSlider.js, rangeFill.js
│   ├── styles.css          # Point d'entrée : uniquement des @import (ordre = cascade)
│   └── styles/             # base, thèmes, lecteur, bibliothèque, modals, curseurs…
├── tests/                  # 25 fichiers Vitest
├── docs/superpowers/       # Specs et plans des grosses fonctionnalités
├── .github/workflows/release.yml
├── eslint.config.js        # Règles par environnement (navigateur, Node, CommonJS)
├── Makefile
└── mise.toml               # Node 24
```

Les conventions du projet (thèmes, i18n, pièges de Howler, règles d'interface) sont détaillées dans [`CLAUDE.md`](CLAUDE.md), identique à [`AGENTS.md`](AGENTS.md).

### Stack

| Rôle | Outil |
|---|---|
| Desktop | Electron 44 |
| Audio | Howler.js (mode HTML5, sprites pour les versions découpées) |
| Persistance | lowdb 7 (`data.json`) |
| Interface | JavaScript et CSS natifs, sans framework, bundlés par Vite |
| Tests | Vitest |
| Modules | ESM (`"type": "module"`), sauf les `.cjs` d'Electron |

### Tests

```bash
make test
```

256 tests, dont :
- **Lecture** : fondus et actions pendant un fondu, pause et reprise en fondu, positions au changement de version, avec un faux Howler qui reproduit le comportement HTML5 ;
- **Données** : bibliothèque, playlists, versions découpées, import et export, migrations ;
- **Logique pure** : tempo, raccourcis, découpage, waveform, placement des bulles d'aide, navigation au clavier ;
- **Interface** : contraste de chaque texte dans les 8 thèmes, parité des traductions, plus aucun `title` natif, modals en `<dialog>`, style unique des curseurs et des barres de défilement.

## 🏗️ Publier une version

Les installeurs sont produits par GitHub Actions, sans passer par le dual-boot :

```bash
npm version x.y.z --no-git-tag-version   # met à jour package.json
git commit -am "chore(release): x.y.z" && git push
git tag -a vx.y.z -m "Jukebox JDR x.y.z" && git push origin vx.y.z
```

Le tag `v*` lance la compilation Linux (AppImage) et Windows (NSIS), puis crée la Release avec les deux fichiers. Un lancement manuel du workflow (`workflow_dispatch`) teste la compilation sans rien publier.

## 📄 Licence

Projet personnel — usage libre.
