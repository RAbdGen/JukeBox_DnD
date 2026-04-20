import { Howler } from 'howler';
import { Track } from './Track.js';

/**
 * Gestionnaire principal pour toutes les pistes audio
 * Gère le chargement, la lecture, et les transitions entre pistes
 */
export class AudioManager {
    constructor() {
        this.tracks = new Map(); // Map<trackId, Track>
        this.currentTrack = null;
        this.globalVolume = 0.5;
        this.callbacks = {
            onTrackChange: null,
            onVersionChange: null,
            onTimeUpdate: null,
        };

        // Playlist
        this.playlist = [];           // Liste ordonnée des pistes
        this.currentTrackIndex = 0;   // Index de la piste actuelle
        this.playMode = 'noLoop';     // 'noLoop', 'loopOne', 'loopAll'
        this.currentVersion = 'calm'; // Version en cours (conservée entre pistes)

        // Configurer le volume global Howler
        Howler.volume(this.globalVolume);
    }

    /**
     * Charger une piste avec ses différentes versions
     * @param {string} trackId - Identifiant unique de la piste
     * @param {string} name - Nom d'affichage
     * @param {Object} versionPaths - Chemins des versions { calm: 'path.mp3', combat: 'path.mp3' }
     */
    loadTrack(trackId, name, versionPaths) {
        console.log(`📥 Chargement de la piste "${name}" (${trackId})`);

        const track = new Track(trackId, name, versionPaths);
        track.loadVersions();

        this.tracks.set(trackId, track);

        console.log(`✅ Piste "${name}" chargée avec ${Object.keys(versionPaths).length} versions`);
    }

    /**
     * Charger plusieurs pistes à partir d'une configuration
     * @param {Object} config - Configuration des pistes
     */
    loadTracks(config) {
        Object.keys(config).forEach(trackId => {
            const { name, versions, defaultVersion } = config[trackId];
            this.loadTrack(trackId, name, versions);

            // Stocker la version par défaut
            const track = this.tracks.get(trackId);
            if (track && defaultVersion) {
                track.defaultVersion = defaultVersion;
            }
        });
    }

    /**
     * Jouer une piste spécifique
     * @param {string} trackId - ID de la piste
     * @param {string} version - Version à jouer (défaut: 'calm')
     */
    play(trackId, version = 'calm') {
        const track = this.tracks.get(trackId);

        if (!track) {
            console.error(`❌ Piste "${trackId}" introuvable`);
            return;
        }

        // Arrêter la piste actuelle si différente
        if (this.currentTrack && this.currentTrack !== track) {
            this.currentTrack.stop();
        }

        // Jouer la nouvelle piste
        track.play(version);
        this.currentTrack = track;

        // Callback
        if (this.callbacks.onTrackChange) {
            this.callbacks.onTrackChange(track.getState());
        }

        console.log(`▶️ Lecture de "${track.name}" - version "${version}"`);
    }

    /**
     * Effectuer un crossfade vers une autre version de la piste actuelle
     * @param {string} toVersion - Version cible
     * @param {number} durationPercent - Durée en fraction de la piste (0.0–1.0, défaut: 0.1 = 10%)
     */
    crossfade(toVersion, durationPercent = 0.1) {
        if (!this.currentTrack) {
            console.warn('⚠️ Aucune piste en cours de lecture');
            return;
        }

        this.currentTrack.crossfade(toVersion, durationPercent);

        // Callback
        if (this.callbacks.onVersionChange) {
            setTimeout(() => {
                this.callbacks.onVersionChange(this.currentTrack.getState());
            }, duration);
        }
    }

    /**
     * Mettre en pause la lecture
     */
    pause() {
        if (this.currentTrack) {
            this.currentTrack.pause();
            console.log('⏸️ Pause globale');
        }
    }

    /**
     * Reprendre la lecture
     */
    resume() {
        if (this.currentTrack) {
            const currentVersion = this.currentTrack.currentVersion;
            if (currentVersion && this.currentTrack.versions[currentVersion]) {
                const howl = this.currentTrack.versions[currentVersion];
                // Restore volume before playing
                howl.volume(this.currentTrack.defaultVolume || this.globalVolume);
                howl.play();
                this.currentTrack.isPlaying = true;
                console.log('▶️ Reprise de la lecture');
            }
        }
    }

    /**
     * Arrêter la lecture
     */
    stop() {
        if (this.currentTrack) {
            this.currentTrack.stop();
            console.log('⏹️ Stop global');
        }
    }

    /**
     * Définir le volume global
     * @param {number} volume - Volume entre 0 et 1
     */
    setVolume(volume) {
        this.globalVolume = Math.max(0, Math.min(1, volume));
        Howler.volume(this.globalVolume);

        if (this.currentTrack) {
            this.currentTrack.setVolume(this.globalVolume);
        }

        console.log(`🔊 Volume global: ${Math.round(this.globalVolume * 100)}%`);
    }

    /**
     * Obtenir le volume global
     * @returns {number} Volume entre 0 et 1
     */
    getVolume() {
        return this.globalVolume;
    }

    /**
     * Obtenir la position actuelle de lecture
     * @returns {number} Position en secondes
     */
    getCurrentTime() {
        return this.currentTrack ? this.currentTrack.getCurrentTime() : 0;
    }

    /**
     * Obtenir la durée de la piste actuelle
     * @returns {number} Durée en secondes
     */
    getDuration() {
        return this.currentTrack ? this.currentTrack.getDuration() : 0;
    }

    /**
     * Aller à une position spécifique dans la piste
     * @param {number} position - Position en secondes
     */
    seek(position) {
        if (this.currentTrack && this.currentTrack.currentVersion) {
            const howl = this.currentTrack.versions[this.currentTrack.currentVersion];
            if (howl) {
                howl.seek(position);
                console.log(`⏩ Seek à ${position.toFixed(1)}s`);
            }
        }
    }

    /**
     * Vérifier si une piste est en cours de lecture
     * @returns {boolean}
     */
    isPlaying() {
        return this.currentTrack ? this.currentTrack.isPlaying : false;
    }

    /**
     * Obtenir l'état complet du gestionnaire audio
     * @returns {Object}
     */
    getState() {
        return {
            currentTrack: this.currentTrack ? this.currentTrack.getState() : null,
            globalVolume: this.globalVolume,
            isPlaying: this.isPlaying(),
            availableTracks: Array.from(this.tracks.values()).map(t => ({
                id: t.id,
                name: t.name,
                versions: Object.keys(t.versions),
            })),
        };
    }

    /**
     * Enregistrer des callbacks pour les événements
     * @param {string} event - Nom de l'événement
     * @param {Function} callback - Fonction de callback
     */
    on(event, callback) {
        if (this.callbacks.hasOwnProperty(`on${event.charAt(0).toUpperCase() + event.slice(1)}`)) {
            this.callbacks[`on${event.charAt(0).toUpperCase() + event.slice(1)}`] = callback;
        }
    }

    /**
     * Obtenir toutes les pistes chargées
     * @returns {Array} Liste des pistes
     */
    getAllTracks() {
        return Array.from(this.tracks.values()).map(track => ({
            id: track.id,
            name: track.name,
            versions: Object.keys(track.versions),
            defaultVersion: track.defaultVersion || 'calm',
        }));
    }

    /**
     * Obtenir une piste spécifique
     * @param {string} trackId - ID de la piste
     * @returns {Track|null}
     */
    getTrack(trackId) {
        return this.tracks.get(trackId) || null;
    }

    // ========================================
    // GESTION DE PLAYLIST
    // ========================================

    /**
     * Charger une playlist complète
     * @param {Array} playlistConfig - Configuration de la playlist
     */
    loadPlaylist(playlistConfig) {
        console.log(`📀 Chargement de la playlist (${playlistConfig.length} pistes)`);

        this.playlist = [];

        playlistConfig.forEach((trackConfig, index) => {
            const { id, title, versions, defaultVersion } = trackConfig;

            // Charger la piste
            this.loadTrack(id, title, versions);

            // Ajouter à la playlist
            this.playlist.push({ id, title, defaultVersion: defaultVersion || 'calm' });

            // Configurer le callback onEnd pour cette piste
            const track = this.tracks.get(id);
            if (track) {
                track.onEndCallback = () => this.onTrackEnd();
            }
        });

        console.log(`✅ Playlist chargée : ${this.playlist.length} pistes`);
    }

    /**
     * Jouer une piste de la playlist par son index
     * @param {number} index - Index de la piste dans la playlist
     */
    playTrackAtIndex(index) {
        if (index < 0 || index >= this.playlist.length) {
            console.error(`❌ Index ${index} hors limites`);
            return;
        }

        this.currentTrackIndex = index;
        const trackConfig = this.playlist[index];
        const track = this.tracks.get(trackConfig.id);

        if (!track) {
            console.error(`❌ Piste "${trackConfig.id}" introuvable`);
            return;
        }

        // Arrêter la piste actuelle
        if (this.currentTrack && this.currentTrack !== track) {
            this.currentTrack.stop();
        }

        // Réinitialiser à la première version disponible de la nouvelle piste
        const availableVersions = Object.keys(track.versionPaths);
        if (availableVersions.length > 0) {
            this.currentVersion = availableVersions[0];
        }

        // Appliquer le mode de loop directement sur le Howl ciblé.
        // On ne passe pas par track.setLoop() car track.currentVersion est encore null ici
        // (la piste n'a pas encore été jouée), ce qui ferait ignorer l'appel.
        if (track.versions[this.currentVersion]) {
            track.versions[this.currentVersion].loop(this.playMode === 'loopOne');
        }

        // Jouer la piste avec la première version
        track.play(this.currentVersion);
        this.currentTrack = track;

        console.log(`▶️ Lecture piste ${index + 1}/${this.playlist.length}: "${track.name}" (${this.currentVersion})`);

        // Callback
        if (this.callbacks.onTrackChange) {
            this.callbacks.onTrackChange(this.getPlaylistState());
        }
    }

    /**
     * Piste suivante
     */
    nextTrack() {
        console.log('⏭️ Piste suivante');

        // En mode loopOne, on reste sur la même piste (elle boucle déjà)
        if (this.playMode === 'loopOne') {
            console.log('ℹ️ Mode loopOne: même piste');
            return;
        }

        // Passer à la piste suivante
        if (this.currentTrackIndex < this.playlist.length - 1) {
            this.playTrackAtIndex(this.currentTrackIndex + 1);
        } else {
            // Fin de playlist
            if (this.playMode === 'loopAll') {
                console.log('🔁 Fin de playlist, recommencer');
                this.playTrackAtIndex(0);
            } else {
                console.log('🏁 Fin de playlist');
                this.stop();
            }
        }
    }

    /**
     * Piste précédente
     */
    previousTrack() {
        console.log('⏮️ Piste précédente');

        if (this.currentTrackIndex > 0) {
            this.playTrackAtIndex(this.currentTrackIndex - 1);
        } else {
            // Début de playlist
            if (this.playMode === 'loopAll') {
                console.log('🔁 Début de playlist, aller à la fin');
                this.playTrackAtIndex(this.playlist.length - 1);
            } else {
                console.log('ℹ️ Déjà au début de la playlist');
            }
        }
    }

    /**
     * Définir le mode de lecture
     * @param {string} mode - 'noLoop', 'loopOne', 'loopAll'
     */
    setPlayMode(mode) {
        const validModes = ['noLoop', 'loopOne', 'loopAll'];

        if (!validModes.includes(mode)) {
            console.error(`❌ Mode invalide: ${mode}`);
            return;
        }

        this.playMode = mode;
        console.log(`🔄 Mode de lecture: ${mode}`);

        // Mettre à jour le loop de la piste actuelle
        if (this.currentTrack) {
            this.currentTrack.setLoop(mode === 'loopOne');
        }
    }

    /**
     * Callback appelé automatiquement à la fin d'une piste
     */
    onTrackEnd() {
        console.log('🏁 Fin de piste détectée');

        // Le mode loopOne est géré directement par Howler (loop: true)
        // On ne fait rien ici car la piste boucle automatiquement

        if (this.playMode === 'loopOne') {
            // La piste boucle déjà, rien à faire
            return;
        }

        // Pour les autres modes, passer à la piste suivante
        this.nextTrack();
    }

    /**
     * Obtenir l'état complet de la playlist
     * @returns {Object}
     */
    getPlaylistState() {
        return {
            playlist: this.playlist,
            currentTrackIndex: this.currentTrackIndex,
            playMode: this.playMode,
            currentVersion: this.currentVersion,
            currentTrack: this.currentTrack ? this.currentTrack.getState() : null,
            totalTracks: this.playlist.length,
        };
    }
}

