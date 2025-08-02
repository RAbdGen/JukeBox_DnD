# 🎧 Jukebox D&D — Roadmap de développement

## 1. 🟩 Préparation du projet
- Initialiser projet npm
- Installer Electron et Howler.js
- Configurer Electron (main, renderer, index.html)
- Installer un bundler : electron-forge ou electron-builder
- Créer structure de base :
    - /src/index.html
    - /src/renderer.js
    - /src/main.js
    - /src/styles.css
- Script de lancement : `npm start`

## 2. 🟨 Lecture musicale de base
- Charger un fichier audio avec Howler.js
- Boutons Play / Pause / Stop
- Toggle boucle simple
- Affichage du nom de la piste

## 3. 🟧 Multi-version de piste
- Définir structure de piste avec plusieurs versions
- UI pour changer de version (calme/combat...)
- Crossfade entre versions :
    - Fade out de la version actuelle
    - Fade in de la version suivante
    - Synchronisation des points de lecture

## 4. 🟦 Système de playlist
- Créer une structure de playlist (array de pistes)
- Contrôles :
    - Play/Pause
    - Next/Previous
- Gestion des modes :
    - loopOne
    - loopAll
    - shuffle
- Passage automatique à la piste suivante

## 5. 🟫 Persistance locale
- Sauvegarde de playlists en JSON
- Chargement automatique au démarrage
- Interface de gestion :
    - Ajouter/Supprimer des pistes
    - Réorganiser playlist
- Sauvegarde des préférences :
    - Volume
    - Mode de lecture
    - Dernière piste/version lue

## 6. 🟥 Interface utilisateur propre
- Améliorer design UI (CSS, Tailwind ou vanilla)
- Afficher :
    - Piste en cours
    - Version active
    - Mode de lecture
- Slider de volume
- Responsive design

## 7. 🟪 Build & distribution
- Configurer `electron-builder` ou `electron-forge make`
- Générer .exe ou .dmg
- Créer un installeur ou un ZIP
- Tester l'installation sur une autre machine
- Ajouter icône personnalisée

## 8. 🟫 Bonus & polish (optionnel)
- Ajouter effets visuels (progress bar, transitions)
- Tags ou favoris pour les pistes
- Mode "maître du jeu" (remote control ?)
- Support glisser-déposer de fichiers audio
- Logger les erreurs

