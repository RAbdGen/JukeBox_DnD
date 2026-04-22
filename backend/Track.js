import { Howl } from 'howler';

/**
 * Classe représentant une piste musicale avec plusieurs versions
 * (ex: Calme, Combat, Boss, etc.)
 */
export class Track {
    /**
     * @param {string} id - Identifiant unique de la piste
     * @param {string} name - Nom d'affichage de la piste
     * @param {Object} versionPaths - Chemins des différentes versions { calm: 'path.mp3', combat: 'path.mp3' }
     */
    constructor(id, name, versionPaths) {
        this.id = id;
        this.name = name;
        this.versionPaths = versionPaths;
        this.versions = {}; // Contiendra les instances Howl
        this.currentVersion = null;
        this.isPlaying = false;
        this.isCrossfading = false;
        this.defaultVolume = 0.5;
        this.onEndCallback = null; // Callback pour fin de piste (playlist)
    }

    /**
     * Charge toutes les versions de la piste avec Howler.js
     */
    loadVersions() {
        Object.keys(this.versionPaths).forEach(versionName => {
            let path = this.versionPaths[versionName];

            // Convert local path to file:// URL for Electron/Howler.js
            if (path && !path.startsWith('http') && !path.startsWith('file://')) {
                path = `file://${path}`;
            }

            console.log(`📂 Chargement version "${versionName}": ${path}`);

            this.versions[versionName] = new Howl({
                src: [path],
                html5: true, // Use HTML5 Audio for file:// URLs
                loop: false, // Pas de boucle pour permettre la progression de playlist
                volume: 0,
                preload: false, // Chargement à la première lecture, pas au démarrage
                onload: () => {
                    console.log(`✅ Version "${versionName}" de "${this.name}" chargée`);
                },
                onloaderror: (id, error) => {
                    console.error(`❌ Erreur de chargement "${versionName}" (${path}):`, error);
                },
                onplay: () => {
                    console.log(`▶️ Lecture de "${this.name}" - ${versionName}`);
                },
                onend: () => {
                    console.log(`🏁 Fin de "${this.name}" - ${versionName}`);
                    // Appeler le callback de fin de piste si défini
                    if (this.onEndCallback) {
                        this.onEndCallback();
                    }
                },
            });
        });
    }

    /**
     * Démarrer la lecture d'une version spécifique
     * @param {string} versionName - Nom de la version à jouer
     */
    play(versionName = 'calm') {
        if (!this.versions[versionName]) {
            console.error(`❌ Version "${versionName}" introuvable pour "${this.name}"`);
            return;
        }

        const howl = this.versions[versionName];

        // Arrêter toutes les autres versions
        this.stopAllVersions();

        this.currentVersion = versionName;

        const startPlay = () => {
            howl.volume(this.defaultVolume);
            howl.play();
            this.isPlaying = true;
        };

        // Avec html5: true, le fichier peut ne pas être encore chargé au premier clic.
        // On attend l'événement 'load' avant de jouer pour éviter le silence au premier appel.
        if (howl.state() === 'loaded') {
            startPlay();
        } else {
            howl.once('load', startPlay);
            if (howl.state() === 'unloaded') {
                howl.load(); // Déclenche le chargement (preload: false)
            }
        }
    }

    /**
     * Effectuer un crossfade entre deux versions
     * @param {string} toVersion - Version cible
     * @param {number} durationPercent - Durée du crossfade en fraction de la piste (0.0–1.0, défaut: 0.1 = 10%)
     */
    crossfade(toVersion, durationPercent = 0.1) {
        if (!this.currentVersion) {
            console.warn('⚠️ Aucune version en cours, démarrage direct');
            this.play(toVersion);
            return;
        }

        if (this.currentVersion === toVersion) {
            console.log('ℹ️ Déjà sur cette version');
            return;
        }

        if (!this.versions[toVersion]) {
            console.error(`❌ Version "${toVersion}" introuvable`);
            return;
        }

        if (this.isCrossfading) {
            console.warn('⚠️ Crossfade déjà en cours, annulation');
            return;
        }

        // Calcul de la durée réelle : % de la longueur de la piste, encadrée entre 500 ms et 5000 ms
        const trackDurationMs = (this.versions[this.currentVersion].duration() || 30) * 1000;
        const duration = Math.min(Math.max(Math.floor(trackDurationMs * durationPercent), 500), 5000);

        console.log(`🔀 Crossfade: ${this.currentVersion} → ${toVersion} (${duration}ms / ${Math.round(durationPercent * 100)}% de la piste)`);

        this.isCrossfading = true;

        const fromVersion = this.versions[this.currentVersion];
        const toVersionHowl = this.versions[toVersion];

        // 1. Récupérer la position actuelle (en secondes)
        const currentSeek = fromVersion.seek();
        console.log(`⏱️ Position actuelle: ${currentSeek.toFixed(2)}s`);

        // 2. IMPORTANT: Use defaultVolume, not current volume which might be 0
        const fromVolume = this.defaultVolume;
        const toVolume = this.defaultVolume;

        // Ensure fromVersion has the correct volume before fading out
        fromVersion.volume(fromVolume);

        console.log(`📊 État avant crossfade - From: ${fromVolume.toFixed(2)}, To: 0`);

        // 3. Démarrer le fade-out
        console.log(`🔉 Fade-out: ${fromVolume.toFixed(2)} → 0 (${duration}ms)`);
        fromVersion.fade(fromVolume, 0, duration);

        // 4. Configurer la nouvelle version
        toVersionHowl.stop(); // Arrêter complètement si elle jouait
        toVersionHowl.volume(0); // Force le volume à 0
        toVersionHowl.seek(currentSeek);

        // 5. Lancer la nouvelle version
        const playId = toVersionHowl.play();
        console.log(`▶️ Piste "${toVersion}" lancée (ID: ${playId})`);

        // 6. Attendre 50ms puis démarrer le fade-in
        setTimeout(() => {
            // Vérifier que la version joue bien
            if (!toVersionHowl.playing(playId)) {
                console.error(`❌ Erreur: la nouvelle version ne joue pas`);
                this.isCrossfading = false;
                return;
            }

            // Démarrer le fade-in
            console.log(`🔊 Fade-in: 0 → ${toVolume.toFixed(2)} (${duration}ms)`);
            toVersionHowl.fade(0, toVolume, duration, playId);

        }, 50);

        // 7. Arrêter l'ancienne version après le fade complet
        setTimeout(() => {
            fromVersion.stop();
            fromVersion.volume(this.defaultVolume); // Réinitialiser le volume

            this.currentVersion = toVersion;
            this.isCrossfading = false;

            console.log(`✅ Crossfade terminé, maintenant sur "${toVersion}"`);
        }, duration + 100);
    }

    /**
     * Mettre en pause la lecture
     */
    pause() {
        if (this.currentVersion && this.versions[this.currentVersion]) {
            this.versions[this.currentVersion].pause();
            this.isPlaying = false;
            console.log(`⏸️ Pause "${this.name}"`);
        }
    }

    /**
     * Arrêter la lecture
     */
    stop() {
        this.stopAllVersions();
        this.isPlaying = false;
        this.currentVersion = null;
        console.log(`⏹️ Stop "${this.name}"`);
    }

    /**
     * Arrêter toutes les versions
     */
    stopAllVersions() {
        Object.values(this.versions).forEach(version => {
            if (version.playing()) {
                version.stop();
            }
        });
    }

    /**
     * Définir le volume global
     * @param {number} volume - Volume entre 0 et 1
     */
    setVolume(volume) {
        this.defaultVolume = volume;
        if (this.currentVersion && this.versions[this.currentVersion]) {
            this.versions[this.currentVersion].volume(volume);
        }
    }

    /**
     * Activer/désactiver le loop sur la version actuelle
     * @param {boolean} loop - true pour boucler, false sinon
     */
    setLoop(loop) {
        if (this.currentVersion && this.versions[this.currentVersion]) {
            this.versions[this.currentVersion].loop(loop);
            console.log(`🔁 Loop ${loop ? 'activé' : 'désactivé'} pour "${this.name}" - ${this.currentVersion}`);
        }
    }

    /**
     * Obtenir la position actuelle de lecture
     * @returns {number} Position en secondes
     */
    getCurrentTime() {
        if (this.currentVersion && this.versions[this.currentVersion]) {
            return this.versions[this.currentVersion].seek() || 0;
        }
        return 0;
    }

    /**
     * Obtenir la durée totale de la piste
     * @returns {number} Durée en secondes
     */
    getDuration() {
        if (this.currentVersion && this.versions[this.currentVersion]) {
            return this.versions[this.currentVersion].duration() || 0;
        }
        return 0;
    }

    /**
     * Obtenir l'état actuel
     * @returns {Object} État de la piste
     */
    getState() {
        return {
            id: this.id,
            name: this.name,
            currentVersion: this.currentVersion,
            isPlaying: this.isPlaying,
            isCrossfading: this.isCrossfading,
            currentTime: this.getCurrentTime(),
            duration: this.getDuration(),
            availableVersions: Object.keys(this.versions),
        };
    }
}
