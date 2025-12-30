# 🎵 JukeBox DnD 🎲

Application de jukebox pour vos parties de Donjons & Dragons, construite avec **Electron.js** et **Howler.js**.

![Electron](https://img.shields.io/badge/Electron-37.2.5-47848F?style=flat&logo=electron)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=node.js)
![Howler.js](https://img.shields.io/badge/Howler.js-2.2.4-E85D75?style=flat)

## 📋 Table des matières

- [Fonctionnalités](#-fonctionnalités)
- [Installation rapide](#-installation-rapide)
- [Utilisation](#-utilisation)
- [Commandes Makefile](#-commandes-makefile)
- [Structure du projet](#-structure-du-projet)
- [Technologies](#-technologies)
- [Développement](#-développement)

## ✨ Fonctionnalités

- 🎵 **Lecture audio** avec Howler.js (MP3, OGG, WAV, etc.)
- ⚡ **Interface moderne** avec effets glassmorphisme
- 🎮 **Contrôles complets** : Play, Pause, Stop, Volume
- 📊 **Statut en temps réel** avec indicateurs colorés
- 🖥️ **Application desktop** multiplateforme (Windows, macOS, Linux)
- 🔄 **Hot-reload** en mode développement

## 🚀 Installation rapide

```bash
# Cloner le projet
git clone <votre-repo>
cd JukeBox_DnD

# Installer les dépendances
make install

# Lancer en mode développement
make dev
```

## 💻 Utilisation

### Démarrage rapide

```bash
# Mode développement (avec hot-reload)
make dev

# Mode production
make start

# Compiler l'application
make build
```

### Ajouter vos propres musiques

1. Créer un dossier pour vos fichiers audio :
   ```bash
   mkdir -p public/audio
   ```

2. Copier vos fichiers MP3/OGG dans `public/audio/`

3. Modifier `src/renderer.js` pour charger vos fichiers :
   ```javascript
   sound = new Howl({
     src: ['/audio/votre-fichier.mp3'],
     loop: true,
     volume: 0.5,
   });
   ```

## 🛠️ Commandes Makefile

Pour voir toutes les commandes disponibles :
```bash
make help
```

### Commandes principales

| Commande | Description |
|----------|-------------|
| `make help` | Affiche l'aide complète avec toutes les commandes |
| `make install` | Installe toutes les dépendances |
| `make dev` | Lance en mode développement (Vite + Electron) |
| `make start` | Lance l'application Electron |
| `make build` | Compile le frontend et build l'app Electron |
| `make lint` | Vérifie la qualité du code |
| `make clean` | Nettoie le projet (node_modules, dist, build) |
| `make info` | Affiche les informations du projet |
| `make status` | Vérifie le statut du projet |

### Commandes de développement

```bash
make lint          # Vérifier le code
make lint-fix      # Corriger automatiquement les erreurs
make audit         # Audit de sécurité
make audit-fix     # Corriger les vulnérabilités
make update        # Mettre à jour les dépendances
```

### Commandes de nettoyage

```bash
make clean-cache   # Nettoyer uniquement le cache
make clean         # Nettoyage complet
make reset         # Reset : nettoyer + réinstaller
```

## 📁 Structure du projet

```
JukeBox_DnD/
├── electron/              # Processus Electron
│   ├── main.js           # Main process
│   └── preload.js        # Preload script
├── frontend/             # Code source de l'interface
│   ├── index.html        # HTML principal
│   ├── renderer.js       # Renderer process (Howler.js)
│   ├── styles.css        # Styles CSS
│   └── assets/           # Ressources (images, audio)
│       └── audio/        # Vos fichiers audio
├── backend/              # (Optionnel) Backend Express
│   └── server.cjs        # Serveur API
├── dist/                 # Build de production (généré)
├── package.json          # Configuration npm
├── Makefile             # Commandes simplifiées
├── vite.config.js       # Configuration Vite
└── README.md            # Ce fichier
```

## 🔧 Technologies

- **[Electron.js](https://www.electronjs.org/)** - Framework pour applications desktop
- **[Howler.js](https://howlerjs.com/)** - Bibliothèque audio JavaScript
- **[Vite](https://vitejs.dev/)** - Build tool et dev server
- **[React](https://react.dev/)** - UI framework (optionnel)
- **[Tailwind CSS](https://tailwindcss.com/)** - Framework CSS (optionnel)

## 👨‍💻 Développement

### Prérequis

- **Node.js** 20+ 
- **npm** 9+
- **Make** (généralement préinstallé sur Linux/macOS)

### Mode développement

```bash
# Démarrer le serveur de développement
make dev
```

Cela lance :
1. **Vite** sur `http://localhost:3000` avec hot-reload
2. **Electron** qui se connecte automatiquement à Vite

### Mode production

```bash
# Compiler et lancer
make build
make start
```

### Structure des commandes npm

Si vous préférez utiliser npm directement :

```bash
npm start              # Lance Electron
npm run dev            # Mode développement
npm run dev:vite       # Vite uniquement
npm run dev:electron   # Electron uniquement
npm run build          # Build complet
npm run lint           # Vérification ESLint
```

## 📝 Scripts disponibles

Voir `package.json` pour tous les scripts npm, ou utilisez simplement le Makefile pour une expérience simplifiée !

## 🎨 Personnalisation

### Modifier l'apparence

Éditez `src/styles.css` pour personnaliser :
- Couleurs et gradients
- Effets glassmorphisme
- Animations
- Layout responsive

### Ajouter des fonctionnalités

- **Playlist** : Gérer plusieurs fichiers audio
- **Visualiseur** : Ajouter un visualiseur audio
- **Raccourcis** : Implémenter des raccourcis clavier
- **Thèmes** : Créer plusieurs thèmes visuels

## 📄 Licence

Projet personnel - Libre d'utilisation

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.

---

**Fait avec ❤️ pour les maîtres du jeu** 🎲
