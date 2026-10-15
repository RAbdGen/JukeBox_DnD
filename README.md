# 🎵 Jukebox RPG 🎲

Desktop ambient-music player for tabletop role-playing sessions. A track can have several *versions* (`calm`, `combat`, `tension`…): the game master switches between them with a crossfade, without taking their eyes off the game, and the music picks up at the same moment (or on the same beat of the bar).

In French, the app is called **Jukebox JDR**. The interface is available in both languages.

![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat&logo=electron)
![Node.js](https://img.shields.io/badge/Node.js-24_LTS-339933?style=flat&logo=node.js)
![Howler.js](https://img.shields.io/badge/Howler.js-2.2.4-E85D75?style=flat)
![Vitest](https://img.shields.io/badge/Vitest-346_tests-6E9F18?style=flat)

## 📥 Install

Download the latest version from the [Releases](https://github.com/RAbdGen/JukeBox_DnD/releases/latest) page:

- **Windows**: `Jukebox.JDR-Setup-x.y.z.exe`, an installer that needs no administrator rights. An update installs over the previous version.
- **Linux**: `Jukebox.JDR-x.y.z.AppImage`, to make executable and run.

Your data (library, playlists, settings and the copied audio files) is kept between versions, in `%APPDATA%\jukebox\` on Windows and `~/.config/jukebox/` on Linux. Uninstalling does not touch it.

## ✨ Features

### Music and versions
- 🎵 **Several versions per track**, with a crossfade you can set per track (0 to 10 s, 0 for no fade)
- ✂️ **Split tab**: cut one or more files into versions by hand on a zoomable waveform, one tab per file (e.g. `exploration.mp3` → calm + tension, `boss.mp3` → combat). The ✂ button also adds a split file to an existing track, and a version that was added as a whole file can be split too without leaving the track. Original files are never modified. A one-hour file is analysed in a few seconds without exhausting memory
- 🥁 **Tempo sync** (advanced mode): with a BPM and a first beat per version, a switch resumes on the same beat of the bar, even before the first beat. A **Tap** button measures the BPM for you (average over your last 20 taps)
- 🎯 **Launch version**: chosen per track by clicking its version name
- ⏯️ **Fading pause and resume**, and a gradual **emergency mute**

### During the session
- ⌨️ **Global shortcuts**, active even when the app is in the background:
  - play/pause, next and previous track with the media keys;
  - mute: `Ctrl+Alt+M`;
  - next version: `Ctrl+Alt+V`; versions 1 to 3: `Ctrl+Alt+1..3`, configurable in Settings.
- 🔁 **Play modes**: Once, Loop one track, Repeat all, **Cycle versions** (each version flows into the next as soon as it ends, then back to the first)
- 📍 **Draggable progress bar**, with the mouse or the keyboard

### Library
- 📚 **Grimoire** (the library) with tags, search and a preview button
- 📋 **Playlists**: reorder tracks, remove them, undo a deletion
- 🎚️ **Per-track volume**, independent of the master volume
- 💾 **Export and import** of the whole library (backup or moving to another machine)
- 🔄 **Resumes the last playlist** on startup

### Interface
- 🌙 **8 themes**: night, grimoire, tavern, arcane, forest, blood, frost, parchment (the only light one). Text contrast is checked automatically (WCAG AA). The window title bar follows the theme
- 📐 **Resizable window**: the layout adapts down to a narrow window
- 🇫🇷 🇬🇧 **French and English**, including the system dialogs
- ♿ **Keyboard friendly**:
  - tooltips, sliders, the playlist menu and dialogs follow the shadcn/Radix component patterns;
  - focus stays inside an open dialog, and Esc closes it;
  - animations are reduced when the system asks for it.

## 🧑‍💻 Development

### Requirements

- **Node 24 LTS**, pinned by `mise.toml`. With [mise](https://mise.jdx.dev), the right version is picked up automatically in the folder. Avoid Node 26: the Electron 37 installer failed silently on it, and Node 24 remains the tested version.
- `make` (optional: every command has an `npm` equivalent).

```bash
git clone https://github.com/RAbdGen/JukeBox_DnD.git
cd JukeBox_DnD
make install
make dev          # Vite on :3000 + Electron, reloaded on every change
```

The Electron binary is not downloaded by `npm install` but on the first run of `make dev` (or by hand with `npx install-electron --no`).

> On Linux, if the app refuses to start because of the sandbox: `make dev-nosandbox`

### Commands

| Command | Description |
|---|---|
| `make dev` | Development mode |
| `make dev-nosandbox` | Development mode, sandbox disabled (Linux) |
| `make start` | Run the app from the build |
| `make test` / `make test-watch` | Vitest tests, once or continuously |
| `make lint` | ESLint (recommended rules, `eslint.config.js`) |
| `make build` | Full build (Vite + electron-builder) |
| `make build-linux` | Linux AppImage |
| `make build-win` | Windows NSIS installer |
| `make audit` | npm security audit |
| `make clean` / `make reset` | Clean up, or clean up and reinstall |
| `make info` / `make status` | Versions and project state |
| `make help` | All commands |

### Structure

```
JukeBox_DnD/
├── electron/
│   ├── main.cjs            # Main process: window, IPC, global shortcuts, dialogs
│   └── preload.cjs         # contextBridge → window.electronAPI
├── backend/                # Shared ESM modules (tested, mostly pure logic)
│   ├── AudioManager.js     # Playlist, playback, version switches
│   ├── Track.js            # One track and its Howler versions (fades, pause, positions)
│   ├── DatabaseManager.js  # lowdb persistence (data.json)
│   ├── FileManager.js      # Copying and deleting audio files
│   ├── ImportManager.js    # Merging an imported library
│   ├── segments.js         # Split versions
│   ├── audioScan.js        # Chunked WAV / MP3 analysis for the waveform
│   ├── tempo.js            # Tempo sync and tap tempo
│   ├── shortcuts.js        # Version shortcuts (validation, conflicts)
│   └── i18n.js             # French / English translations
├── frontend/
│   ├── index.html
│   ├── renderer.js         # Interface and IPC calls
│   ├── cutterView.js       # Split tab (waveform.js, segmentModel.js)
│   ├── tooltip.js, listbox.js, modal.js, roving.js, progressSlider.js, rangeFill.js
│   ├── styles.css          # Entry point: @import only (order = cascade)
│   └── styles/             # base, themes, player, library, modals, sliders, responsive…
├── tests/                  # 31 Vitest files
├── docs/superpowers/       # Specs and plans for the larger features
├── .github/workflows/release.yml
├── eslint.config.js        # Rules per environment (browser, Node, CommonJS)
├── Makefile
└── mise.toml               # Node 24
```

Project conventions (themes, i18n, Howler pitfalls, interface rules) are detailed in [`CLAUDE.md`](CLAUDE.md), identical to [`AGENTS.md`](AGENTS.md). Both are written in French.

### Stack

| Role | Tool |
|---|---|
| Desktop | Electron 44 |
| Audio | Howler.js (HTML5 mode, sprites for split versions) |
| Persistence | lowdb 7 (`data.json`) |
| Interface | Plain JavaScript and CSS, no framework, bundled by Vite |
| Tests | Vitest |
| Modules | ESM (`"type": "module"`), except Electron's `.cjs` files |

### Tests

```bash
make test
```

346 tests, including:
- **Playback**: fades and actions during a fade, fading pause and resume, positions on a version switch, using a fake Howler that reproduces HTML5 behaviour;
- **Data**: library, playlists, split versions, import and export, migrations;
- **Pure logic**: tempo and tap tempo, shortcuts, splitting, waveform, tooltip placement, keyboard navigation;
- **Interface**: contrast of every text in the 8 themes, translation parity, no native `title` left, `<dialog>` modals, a single style for sliders and scrollbars, the responsive breakpoints and the custom title bar.

## 🏗️ Publishing a release

Installers are built by GitHub Actions, without going through the dual-boot:

```bash
npm version x.y.z --no-git-tag-version   # updates package.json
git commit -am "chore(release): x.y.z" && git push
git tag -a vx.y.z -m "Jukebox RPG x.y.z" && git push origin vx.y.z
```

The `v*` tag starts the Linux (AppImage) and Windows (NSIS) builds, then creates the Release with both files. Running the workflow by hand (`workflow_dispatch`) tests the build without publishing anything.

## 📄 License

Personal project — free to use.
