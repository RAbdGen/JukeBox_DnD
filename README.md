# 🎵 JukeBox DnD 🎲

Application desktop de gestion de musique d'ambiance pour les sessions de jeu de rôle. Chargez vos pistes, organisez-les en playlists et passez entre différentes *versions* d'une même musique (ex : `calm`, `combat`, `tension`) avec des transitions crossfade fluides.

![Electron](https://img.shields.io/badge/Electron-37+-47848F?style=flat&logo=electron)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=node.js)
![Howler.js](https://img.shields.io/badge/Howler.js-2.2.4-E85D75?style=flat)
![Vitest](https://img.shields.io/badge/Vitest-4+-6E9F18?style=flat)

## ✨ Fonctionnalités

- 🎵 **Multi-versions** — une piste peut avoir plusieurs ambiances (`calm`, `combat`, `tension`…) avec crossfade
- 📂 **Bibliothèque persistante** — les pistes et playlists sont sauvegardées entre les sessions
- 🔄 **Modes de lecture** — Normal, Boucle sur une piste, Tout répéter
- 🎚️ **Volume global + par piste** — contrôle fin de l'audio via Howler.js
- 💾 **Restauration automatique** — reprend la dernière playlist et la dernière position au démarrage
- 🖥️ **Desktop multiplateforme** — Linux (AppImage) et Windows (portable .exe)
- 🧪 **Tests unitaires** — couverture backend avec Vitest (76 tests)

## 🚀 Installation

```bash
git clone https://github.com/RAbdGen/JukeBox_DnD.git
cd JukeBox_DnD
make install
```

## 💻 Utilisation

```bash
make dev          # Mode développement (Vite :3000 + Electron)
make start        # Lance l'application en production
make build        # Compile Vite + package Electron
make test         # Lance la suite de tests
```

> Sur Linux si l'app refuse de démarrer (sandbox) : `make dev-nosandbox`

## 🛠️ Toutes les commandes

```bash
make help
```

| Commande | Description |
|---|---|
| `make install` | Installe les dépendances |
| `make dev` | Mode développement |
| `make dev-nosandbox` | Mode dev (fix sandbox Linux) |
| `make start` | Lance en production |
| `make build` | Build complet (Vite + Electron) |
| `make build-linux` | AppImage Linux |
| `make build-win` | Portable Windows |
| `make test` | Suite de tests Vitest |
| `make test-watch` | Tests en mode watch |
| `make lint` | Vérification ESLint |
| `make audit` | Audit de sécurité npm |
| `make clean` | Supprime node_modules, dist, build |
| `make reset` | clean + install |
| `make status` | État du projet |
| `make info` | Versions Node/Electron/npm |

## 📁 Structure du projet

```
JukeBox_DnD/
├── electron/
│   ├── main.cjs          # Processus principal (IPC handlers, BrowserWindow)
│   └── preload.cjs       # contextBridge → window.electronAPI
├── backend/              # Modules ESM (Node.js)
│   ├── AudioManager.js   # Orchestration audio, playlist, crossfade
│   ├── Track.js          # Piste individuelle avec versions Howl
│   ├── DatabaseManager.js# Persistance lowdb (data.json)
│   └── FileManager.js    # Copie/suppression des fichiers audio
├── frontend/
│   ├── index.html        # Interface principale
│   ├── renderer.js       # Logique UI + appels IPC
│   └── styles.css        # Thème "Grimoire sonore" (dark, doré, IM Fell English)
├── tests/
│   ├── AudioManager.test.js
│   ├── DatabaseManager.test.js
│   └── FileManager.test.js
├── scripts/
│   └── dev-electron.cjs  # Script de lancement dev (contournement sandbox)
├── vitest.config.js
├── vite.config.js
├── Makefile
└── package.json
```

Les données utilisateur (pistes, playlists, `data.json`) sont stockées dans `app.getPath('userData')`.

## 🔧 Stack technique

| Rôle | Outil |
|---|---|
| Framework desktop | Electron |
| Audio | Howler.js (sprites, crossfade, html5 mode) |
| Persistance | lowdb 7 (JSON file) |
| Build frontend | Vite (ESM, target es2020) |
| Tests | Vitest |
| Module system | ESM (`"type": "module"`) — sauf les `.cjs` Electron |

## 🧪 Tests

```bash
make test          # Lancement unique
make test-watch    # Relance à chaque modification
```

76 tests couvrant :
- **FileManager** — génération d'IDs, formatage de taille, copie/suppression de fichiers
- **DatabaseManager** — CRUD bibliothèque et playlists, settings, export/import JSON
- **AudioManager** — clamping de volume, modes de lecture, navigation playlist, callbacks

## 🏗️ Distribution

Les builds sont manuels depuis le dual-boot (pas de cross-compilation) :

```bash
# Depuis Linux
make build-linux   # → dist/*.AppImage

# Depuis Windows
make build-win     # → dist/*.exe (portable)
```

## 📄 Licence

Projet personnel — usage libre.
