import { Howl } from 'howler';
import {
    DEFAULT_CROSSFADE_DURATION_SECONDS,
    legacyPercentToSeconds,
    normalizeCrossfadeDurationSeconds,
} from './crossfadeDuration.js';
import { trackSignature } from './segments.js';
import { beatSyncedPosition } from './tempo.js';

// Nom du sprite Howler d'une version découpée (#24)
const SPRITE_NAME = 'segment';

// Sans tempo saisi, tout se passe comme si chaque version avait le même tempo et
// son premier temps à 0 ms : même position relative dans la cible (#44)
const SAME_TEMPO = { bpm: 1, offsetMs: 0 };

/**
 * Classe représentant une piste musicale avec plusieurs versions
 * (ex: Calme, Combat, Boss, etc.)
 */
export class Track {
    /**
     * @param {string} id - Identifiant unique de la piste
     * @param {string} name - Nom d'affichage de la piste
     * @param {Object} versionPaths - Chemins des différentes versions { calm: 'path.mp3', combat: 'path.mp3' }
     * @param {Object} [segments] - Versions découpées (#24) : { combat: { start, end } } en secondes
     */
    constructor(id, name, versionPaths, segments = {}) {
        this.id = id;
        this.name = name;
        this.versionPaths = versionPaths;
        this.segments = segments || {};
        // Permet à AudioManager de savoir si la piste doit être reconstruite (#32)
        this.signature = trackSignature(versionPaths, this.segments);
        this.versions = {}; // Contiendra les instances Howl
        this.currentVersion = null;
        this.isPlaying = false;
        this.loop = false; // Appliqué à *toutes* les versions (#23)
        this.defaultVolume = 0.5;
        // Durée de fondu en secondes (#28). null tant qu'une piste n'a que l'ancien
        // réglage en % (legacyCrossfadePercent), migré dès que la durée est connue.
        this.crossfadeDurationSeconds = null;
        this.legacyCrossfadePercent = null;
        this.onCrossfadeDurationMigrated = null; // (seconds) => void, pour persister la migration
        this.onEndCallback = null; // Callback pour fin de piste (playlist)

        // Fondu en cours : { fromVersion, toVersion, currentSeek, timers, loadListener, started, complete }
        this._crossfade = null;
        // Lecture en attente de chargement : { howl, listener }
        this._pendingStart = null;
        // Position à laquelle reprendre currentVersion (pause pendant un chargement,
        // changement de version en pause)
        this._resumeSeek = null;
        // Id du dernier son lancé par version : la reprise se fait par id, jamais par
        // play(sprite) qui repartirait du début du segment
        this._soundIds = {};
        // Version mise en pause (son reprenable par son id)
        this._pausedVersion = null;
        // Fondu de sortie d'une pause en cours (#43) : { version, id, timer, startedAt, duration }
        this._pauseFade = null;
        // Synchronisation BPM (#18) : { versionName: { bpm, offsetMs } }, appliqué par AudioManager
        this.tempo = {};
    }

    get isCrossfading() {
        return this._crossfade !== null;
    }

    /**
     * Fin de segment au-delà du fichier réel (MP3 VBR, fichier remplacé) : on la
     * borne dès que la durée est connue, sinon la durée annoncée est trop longue et
     * le minuteur du sprite laisse un silence avant la piste suivante (#35).
     */
    _clampSegmentToFile(versionName) {
        const segment = this._segmentOf(versionName);
        const howl = this.versions[versionName];
        const fileDuration = howl ? howl.duration() : 0;
        if (!segment || !(fileDuration > 0) || segment.end <= fileDuration) return;

        const end = Math.max(segment.start, fileDuration);
        this.segments = { ...this.segments, [versionName]: { start: segment.start, end } }; // copie : la config reste intacte
        // Howler 2.2 n'expose pas de mise à jour de sprite : on corrige sa table
        // interne, lue à chaque play(sprite)
        howl._sprite[SPRITE_NAME] = [segment.start * 1000, (end - segment.start) * 1000];
    }

    _segmentOf(versionName) {
        return this.segments[versionName] || null;
    }

    /** Durée jouée d'une version : son segment, sinon le fichier entier */
    _versionDuration(versionName) {
        const segment = this._segmentOf(versionName);
        if (segment) return segment.end - segment.start;
        const howl = this.versions[versionName];
        return howl ? howl.duration() || 0 : 0;
    }

    /** Position relative au segment → position absolue dans le fichier */
    _toAbsolute(versionName, position) {
        const segment = this._segmentOf(versionName);
        return segment ? segment.start + position : position;
    }

    /**
     * Position (relative) où reprendre `toVersion` quand on quitte `fromVersion`
     * à `position` : calée sur les temps si les deux versions ont un tempo (#18),
     * sinon même position relative, versions découpées comprises (#44 : on ne
     * repart plus du début du segment). Au-delà de la fin de la cible : début de
     * la cible, ou modulo en boucle unique, dans les deux cas.
     */
    _startPositionFor(fromVersion, toVersion, position) {
        const bothHaveTempo = this.tempo[fromVersion] && this.tempo[toVersion];
        return beatSyncedPosition({
            from: bothHaveTempo ? this.tempo[fromVersion] : SAME_TEMPO,
            to: bothHaveTempo ? this.tempo[toVersion] : SAME_TEMPO,
            position,
            targetDuration: this._versionDuration(toVersion),
            loop: this.loop,
        });
    }

    /** Lance un nouveau son (le sprite du segment pour une version découpée) */
    _startSound(versionName) {
        const howl = this.versions[versionName];
        const id = howl.play(this._segmentOf(versionName) ? SPRITE_NAME : undefined);
        this._soundIds[versionName] = id;
        return id;
    }

    /**
     * Place le son `id` de `versionName` à `position` (relative au segment).
     * En HTML5, play() verrouille le Howl (_playLock) jusqu'à ce que la lecture
     * démarre vraiment ; un seek reçu pendant ce verrou part dans la file de
     * Howler et n'en ressort jamais (seul un événement « seek » la viderait) :
     * la version repartait alors du début (#42). On attend donc l'événement
     * « play » de ce son avant de le déplacer.
     */
    _seekSound(versionName, id, position, afterSeek = null) {
        const howl = this.versions[versionName];
        const absolute = this._toAbsolute(versionName, position);
        this._whenStarted(versionName, id, () => {
            // Howler met le son en pause un instant pour le déplacer, ce qui arrête
            // un fondu : celui qui doit suivre attend la fin du déplacement
            if (afterSeek) howl.once('seek', afterSeek, id);
            howl.seek(absolute, id);
        });
    }

    /**
     * Exécute `action` sur le son `id` dès que sa lecture a vraiment démarré.
     * Pendant le _playLock HTML5, Howler met seek, pause et fade en file et ne
     * les rejoue jamais (#42) : on attend alors l'événement « play » de ce son.
     */
    _whenStarted(versionName, id, action) {
        const howl = this.versions[versionName];
        if (!howl._playLock) {
            action();
            return;
        }
        howl.once('play', () => {
            // Le son a pu être remplacé entre-temps (stop, autre version, relance)
            if (this._soundIds[versionName] === id) action();
        }, id);
    }

    /**
     * Réordonne les versions sans recréer les Howl (simple réordonnancement
     * dans la modal d'édition : ne doit pas couper la lecture).
     */
    reorderVersions(names) {
        const known = names.filter(name => Object.hasOwn(this.versions, name));
        this.versionPaths = Object.fromEntries(known.map(name => [name, this.versionPaths[name]]));
        this.versions = Object.fromEntries(known.map(name => [name, this.versions[name]]));
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

            const segment = this._segmentOf(versionName);

            this.versions[versionName] = new Howl({
                src: [path],
                html5: true, // Use HTML5 Audio for file:// URLs
                loop: this.loop, // false par défaut pour permettre la progression de playlist
                volume: 0,
                preload: false, // Chargement à la première lecture, pas au démarrage
                // Version découpée (#24) : ne lire que son segment du fichier partagé
                ...(segment ? { sprite: { [SPRITE_NAME]: [segment.start * 1000, (segment.end - segment.start) * 1000] } } : {}),
                onload: () => {
                    console.log(`✅ Version "${versionName}" de "${this.name}" chargée`);
                    this._clampSegmentToFile(versionName);
                    this._migrateLegacyCrossfade(this._versionDuration(versionName));
                },
                onloaderror: (id, error) => {
                    console.error(`❌ Erreur de chargement "${versionName}" (${path}):`, error);
                },
                onplay: () => {
                    console.log(`▶️ Lecture de "${this.name}" - ${versionName}`);
                },
                onend: () => {
                    // Seule la version active compte : la fin de la version sortante
                    // pendant un fondu ne doit pas faire passer à la piste suivante (#23)
                    const activeVersion = this._crossfade ? this._crossfade.toVersion : this.currentVersion;
                    if (versionName !== activeVersion) return;
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
     * Ancien réglage en % → secondes, dès que la durée réelle est connue (#28).
     * Même calcul que l'ancien crossfade : la durée entendue ne change pas.
     */
    _migrateLegacyCrossfade(trackDurationSeconds) {
        if (this.crossfadeDurationSeconds !== null || this.legacyCrossfadePercent === null) return;
        if (!(trackDurationSeconds > 0)) return;

        this.crossfadeDurationSeconds = legacyPercentToSeconds(this.legacyCrossfadePercent, trackDurationSeconds);
        this.legacyCrossfadePercent = null;
        console.log(`🔁 Fondu de "${this.name}" migré : ${this.crossfadeDurationSeconds}s`);
        if (this.onCrossfadeDurationMigrated) this.onCrossfadeDurationMigrated(this.crossfadeDurationSeconds);
    }

    /**
     * Durée de fondu effective de la piste, en millisecondes
     * @returns {number}
     */
    getCrossfadeDurationMs() {
        if (this.crossfadeDurationSeconds !== null) {
            return this.crossfadeDurationSeconds * 1000;
        }
        if (this.legacyCrossfadePercent !== null) {
            const duration = this.currentVersion ? this._versionDuration(this.currentVersion) : undefined;
            return legacyPercentToSeconds(this.legacyCrossfadePercent, duration) * 1000;
        }
        return DEFAULT_CROSSFADE_DURATION_SECONDS * 1000;
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

        // Arrêter toutes les autres versions (et tout fondu / démarrage en attente)
        this._cancelCrossfade();
        this._cancelPendingStart();
        this.stopAllVersions();

        this.currentVersion = versionName;
        this._resumeSeek = null;
        this.isPlaying = true;

        this._startWhenLoaded(howl, () => this._playCurrent());
    }

    /**
     * Lance `start` dès que le Howl est chargé. Avec html5: true + preload: false,
     * le fichier peut ne pas être encore chargé au premier clic : on attend 'load'
     * pour éviter le silence au premier appel. L'attente est annulable
     * (pause/stop/autre version avant la fin du chargement).
     */
    _startWhenLoaded(howl, start) {
        if (howl.state() === 'loaded') {
            start();
            return;
        }
        const listener = () => {
            this._pendingStart = null;
            start();
        };
        this._pendingStart = { howl, listener };
        howl.once('load', listener);
        if (howl.state() === 'unloaded') {
            howl.load(); // Déclenche le chargement (preload: false)
        }
    }

    _cancelPendingStart() {
        if (!this._pendingStart) return false;
        const { howl, listener } = this._pendingStart;
        howl.off('load', listener);
        this._pendingStart = null;
        return true;
    }

    /**
     * Effectuer un crossfade entre deux versions.
     *
     * Actions pendant un fondu (#23) — comportement explicite :
     * - nouveau changement de version : le fondu en cours est terminé
     *   immédiatement, puis on enchaîne sur le nouveau fondu
     * - pause / seek : le fondu est terminé immédiatement (la cible devient la
     *   version courante), puis l'action s'applique à la cible
     * - stop / autre piste / play() : le fondu est annulé, rien ne redémarre
     *
     * @param {string} toVersion - Version cible
     * @param {number} [durationSeconds] - Durée du fondu ; par défaut celle réglée sur la piste
     * @param {(success: boolean) => void} [onComplete] - Appelé une fois le crossfade terminé (ou avorté)
     */
    crossfade(toVersion, durationSeconds, onComplete) {
        const complete = (success) => {
            if (onComplete) onComplete(success);
        };

        if (this._crossfade) {
            console.log('⏩ Fondu déjà en cours : terminé immédiatement avant d\'enchaîner');
            this._finishCrossfade();
        }

        if (!this.currentVersion) {
            console.warn('⚠️ Aucune version en cours, démarrage direct');
            this.play(toVersion);
            complete(true);
            return;
        }

        if (this.currentVersion === toVersion) {
            console.log('ℹ️ Déjà sur cette version');
            complete(true);
            return;
        }

        if (!this.versions[toVersion]) {
            console.error(`❌ Version "${toVersion}" introuvable`);
            complete(false);
            return;
        }

        // La version courante n'a pas encore démarré (chargement) : rien à fondre,
        // on bascule directement sur la cible.
        if (this._pendingStart) {
            this.play(toVersion);
            complete(true);
            return;
        }

        const duration = durationSeconds === undefined
            ? this.getCrossfadeDurationMs()
            : normalizeCrossfadeDurationSeconds(durationSeconds) * 1000;

        console.log(`🔀 Crossfade: ${this.currentVersion} → ${toVersion} (${duration}ms)`);

        const fromVersion = this.versions[this.currentVersion];
        const toVersionHowl = this.versions[toVersion];

        // 1. Récupérer la position actuelle (en secondes)
        const currentSeek = this.getCurrentTime();
        console.log(`⏱️ Position actuelle: ${currentSeek.toFixed(2)}s`);

        // 2. IMPORTANT: Use defaultVolume, not current volume which might be 0
        const fromVolume = this.defaultVolume;
        const toVolume = this.defaultVolume;

        // Toutes les ressources du fondu (timers, écouteur de chargement) sont
        // rattachées à cet objet pour pouvoir le terminer ou l'annuler proprement.
        const cf = {
            fromVersion: this.currentVersion,
            toVersion,
            currentSeek,
            timers: [],
            loadListener: null,
            started: false,
            complete,
        };
        this._crossfade = cf;

        // Prépare et lance la nouvelle version une fois qu'elle est chargée : même garde-fou
        // que Track.play() (avec preload:false + html5, le Howl peut ne pas être chargé au
        // moment du crossfade). Le fade-out de fromVersion est déclenché ici aussi, pour que
        // les deux fades démarrent bien ensemble plutôt que fromVersion ne parte seule dans
        // le silence pendant qu'on attend le chargement de toVersion.
        const startToVersion = () => {
            cf.loadListener = null;
            cf.started = true;

            // Ensure fromVersion has the correct volume before fading out
            fromVersion.volume(fromVolume);

            // 3. Démarrer le fade-out
            console.log(`🔉 Fade-out: ${fromVolume.toFixed(2)} → 0 (${duration}ms)`);
            fromVersion.fade(fromVolume, 0, duration);

            // 4. Configurer puis lancer la nouvelle version
            toVersionHowl.stop(); // Arrêter complètement si elle jouait
            toVersionHowl.volume(0); // Force le volume à 0
            const playId = this._startSound(toVersion);

            // 5. Position (tempo #18, sinon même position relative #44).
            // Toujours APRÈS play() : stop() puis play() recycle le son (reset) et perd
            // un seek fait avant.
            const startPosition = this._startPositionFor(cf.fromVersion, toVersion, currentSeek);
            if (startPosition > 0) {
                this._seekSound(toVersion, playId, startPosition);
            }
            console.log(`▶️ Piste "${toVersion}" lancée (ID: ${playId})`);

            // 6. Attendre 50ms puis démarrer le fade-in. Un démarrage HTML5 lent, ou le
            // seek de _seekSound (Howler met le son en pause un instant pour le
            // déplacer), peut faire paraître la cible arrêtée : on revérifie
            // quelques fois avant de conclure à un échec.
            let checksLeft = 4;
            const startFadeIn = () => {
                if (!toVersionHowl.playing(playId) && checksLeft-- > 0) {
                    cf.timers.push(setTimeout(startFadeIn, 50));
                    return;
                }
                // Vérifier que la version joue bien
                if (!toVersionHowl.playing(playId)) {
                    console.error(`❌ Erreur: la nouvelle version ne joue pas, annulation du crossfade`);
                    this._crossfade = null;

                    // Restaurer l'ancienne version pour éviter un silence total
                    fromVersion.volume(fromVolume);
                    if (!fromVersion.playing()) {
                        // Reprendre à la position du switch, pas au début (#35)
                        const restoredId = this._startSound(cf.fromVersion);
                        this._seekSound(cf.fromVersion, restoredId, currentSeek);
                    }

                    complete(false);
                    return;
                }

                // Démarrer le fade-in
                console.log(`🔊 Fade-in: 0 → ${toVolume.toFixed(2)} (${duration}ms)`);
                toVersionHowl.fade(0, toVolume, duration, playId);

                // 7. Finaliser une fois le fade-in terminé
                cf.timers.push(setTimeout(() => this._finishCrossfade(), duration));
            };
            cf.timers.push(setTimeout(startFadeIn, 50));
        };

        if (toVersionHowl.state() === 'loaded') {
            startToVersion();
        } else {
            cf.loadListener = startToVersion;
            toVersionHowl.once('load', startToVersion);
            if (toVersionHowl.state() === 'unloaded') {
                toVersionHowl.load(); // Déclenche le chargement (preload: false)
            }
        }
    }

    /**
     * Amène immédiatement le fondu en cours à son état final : version sortante
     * arrêtée, version cible courante à plein volume. Si la cible n'avait pas
     * encore démarré (chargement), elle démarre dès que possible à la position
     * du switch.
     */
    _finishCrossfade() {
        const cf = this._crossfade;
        if (!cf) return;
        this._crossfade = null;
        cf.timers.forEach(clearTimeout);

        const fromHowl = this.versions[cf.fromVersion];
        const toHowl = this.versions[cf.toVersion];

        fromHowl.stop();
        fromHowl.volume(this.defaultVolume); // Réinitialiser le volume
        this.currentVersion = cf.toVersion;

        if (cf.started) {
            toHowl.volume(this.defaultVolume); // Interrompt un fade-in éventuellement en cours
        } else {
            toHowl.off('load', cf.loadListener);
            this._resumeSeek = this._startPositionFor(cf.fromVersion, cf.toVersion, cf.currentSeek);
            this._startWhenLoaded(toHowl, () => this._playCurrent());
        }

        console.log(`✅ Crossfade terminé, maintenant sur "${cf.toVersion}"`);
        cf.complete(true);
    }

    /**
     * Annule le fondu en cours sans rien relancer (stop, autre piste…).
     */
    _cancelCrossfade() {
        const cf = this._crossfade;
        if (!cf) return;
        this._crossfade = null;
        cf.timers.forEach(clearTimeout);
        if (cf.loadListener) {
            this.versions[cf.toVersion].off('load', cf.loadListener);
        }
        cf.complete(false);
    }

    /**
     * Lance currentVersion à plein volume : reprend le son en pause s'il y en a
     * un (par son id), sinon lance un nouveau son ; puis applique la position
     * mémorisée (toujours après play(), cf. crossfade).
     */
    _playCurrent({ fadeIn = false } = {}) {
        const versionName = this.currentVersion;
        const howl = this.versions[versionName];
        howl.volume(fadeIn ? 0 : this.defaultVolume);

        const resumeSeek = this._resumeSeek;
        this._resumeSeek = null;

        let id;
        if (this._pausedVersion === versionName && this._soundIds[versionName] !== undefined) {
            id = this._soundIds[versionName];
            howl.play(id);
        } else {
            id = this._startSound(versionName);
        }
        this._pausedVersion = null;

        // Fondu d'entrée de la reprise (#43), après le déplacement s'il y en a un
        const startFadeIn = fadeIn
            ? () => howl.fade(0, this.defaultVolume, this.getCrossfadeDurationMs(), id)
            : null;
        if (resumeSeek !== null) {
            this._seekSound(versionName, id, resumeSeek, startFadeIn);
        } else if (startFadeIn) {
            this._whenStarted(versionName, id, startFadeIn);
        }
    }

    /**
     * Mettre en pause la lecture
     */
    pause() {
        if (!this.currentVersion || !this.versions[this.currentVersion]) return;

        if (this._crossfade) this._finishCrossfade();

        // Pas encore démarrée (chargement en cours) : on annule simplement le démarrage,
        // la reprise la lancera. Sinon, fondu de sortie puis pause (#43).
        if (!this._cancelPendingStart() && !this._pauseFade) {
            this._fadeOutThenPause();
        }
        this.isPlaying = false;
        console.log(`⏸️ Pause "${this.name}"`);
    }

    /**
     * Fondu de sortie sur la durée de fondu de la piste (comme le mute, #29),
     * puis vraie pause : le son reste reprenable par son id (#43).
     */
    _fadeOutThenPause() {
        const version = this.currentVersion;
        const howl = this.versions[version];
        const id = this._soundIds[version];
        const duration = this.getCrossfadeDurationMs();
        const fade = { version, id, duration, startedAt: Date.now(), timer: null };
        this._pauseFade = fade;

        this._whenStarted(version, id, () => {
            if (this._pauseFade !== fade) return; // repris ou arrêté entre-temps
            fade.startedAt = Date.now();
            howl.fade(this.defaultVolume, 0, duration, id);
            fade.timer = setTimeout(() => {
                this._pauseFade = null;
                howl.pause(id);
                this._pausedVersion = version;
            }, duration);
        });
    }

    /** Annule un fondu de pause en cours ; renvoie le volume atteint (0–1 du volume de piste) */
    _cancelPauseFade() {
        const fade = this._pauseFade;
        if (!fade) return null;
        this._pauseFade = null;
        clearTimeout(fade.timer);
        const elapsed = Math.min(Date.now() - fade.startedAt, fade.duration);
        return fade.duration > 0 ? 1 - elapsed / fade.duration : 0;
    }

    /**
     * Reprendre la lecture de la version courante (après une pause).
     * Ne relance jamais une version déjà en lecture : Howler.play() sans id sur un
     * son qui joue déjà crée une seconde instance superposée.
     * @returns {boolean} false s'il n'y a rien à reprendre
     */
    resume() {
        const howl = this.currentVersion && this.versions[this.currentVersion];
        if (!howl) return false;

        // Reprise pendant le fondu de sortie : le son n'a jamais été coupé, on
        // remonte le volume depuis où il en est, en autant de temps qu'il a baissé
        const pauseFade = this._pauseFade;
        const reached = this._cancelPauseFade();
        if (reached !== null) {
            const from = this.defaultVolume * reached;
            this._whenStarted(pauseFade.version, pauseFade.id, () => {
                howl.fade(from, this.defaultVolume, pauseFade.duration * (1 - reached), pauseFade.id);
            });
        } else if (!howl.playing() && !this._pendingStart) {
            this._startWhenLoaded(howl, () => this._playCurrent({ fadeIn: true }));
        }
        this.isPlaying = true;
        console.log(`▶️ Reprise de "${this.name}"`);
        return true;
    }

    /**
     * Changer de version pendant une pause : pas de fondu (rien ne joue), la
     * reprise lancera la nouvelle version à la même position.
     * @param {string} toVersion
     * @returns {boolean} true si la version courante est bien toVersion
     */
    switchVersionWhilePaused(toVersion) {
        if (!this.currentVersion || this.isPlaying || !this.versions[toVersion]) return false;
        if (toVersion === this.currentVersion) return true;

        const fromVersion = this.currentVersion;
        const position = this.getCurrentTime();
        this._cancelPendingStart();
        this.stopAllVersions();
        this.currentVersion = toVersion;
        // Tempo (#18), sinon même position relative (#44)
        this._resumeSeek = this._startPositionFor(fromVersion, toVersion, position);
        return true;
    }

    /**
     * Aller à une position de la version courante (termine un fondu en cours)
     * @param {number} position - Position en secondes
     */
    seek(position) {
        if (!this.currentVersion || !this.versions[this.currentVersion]) return;

        if (this._crossfade) this._finishCrossfade();

        if (this._pendingStart || this._resumeSeek !== null) {
            // Pas encore démarrée : appliquée au démarrage / à la reprise
            this._resumeSeek = position;
        } else {
            // Toujours avec l'id : un argument unique égal à l'id d'un son vivant serait
            // lu par Howler comme un getter et la position ignorée (#35)
            this._seekSound(this.currentVersion, this._soundIds[this.currentVersion], position);
        }
    }

    /**
     * Arrêter la lecture
     */
    stop() {
        this._cancelCrossfade();
        this._cancelPendingStart();
        this.stopAllVersions();
        this.isPlaying = false;
        this.currentVersion = null;
        this._resumeSeek = null;
        console.log(`⏹️ Stop "${this.name}"`);
    }

    /**
     * Arrêter toutes les versions (y compris celles en pause)
     */
    stopAllVersions() {
        this._cancelPauseFade();
        Object.values(this.versions).forEach(version => {
            if (version.playing() || version.state() === 'loaded') {
                version.stop();
            }
        });
        this._pausedVersion = null;
    }

    /**
     * Activer/désactiver le loop sur *toutes* les versions : sinon, après un
     * crossfade en mode boucle unique, la nouvelle version ne bouclait pas et
     * la lecture s'arrêtait en silence (#23).
     * @param {boolean} loop - true pour boucler, false sinon
     */
    setLoop(loop) {
        this.loop = loop;
        Object.values(this.versions).forEach(version => version.loop(loop));
        console.log(`🔁 Loop ${loop ? 'activé' : 'désactivé'} pour "${this.name}"`);
    }

    /**
     * Position de lecture, relative au segment pour une version découpée
     * @returns {number} Position en secondes
     */
    getCurrentTime() {
        if (this._resumeSeek !== null) return this._resumeSeek;
        const howl = this.currentVersion && this.versions[this.currentVersion];
        if (!howl) return 0;
        // Getter sans argument : un id périmé serait pris pour une position.
        // Howler renvoie le Howl lui-même (et non un nombre) tant qu'il n'est pas chargé.
        const seek = howl.seek();
        if (typeof seek !== 'number') return 0;
        const segment = this._segmentOf(this.currentVersion);
        return segment ? Math.max(0, seek - segment.start) : seek;
    }

    /**
     * Durée jouée (celle du segment pour une version découpée)
     * @returns {number} Durée en secondes
     */
    getDuration() {
        return this.currentVersion ? this._versionDuration(this.currentVersion) : 0;
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
