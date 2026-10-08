import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Faux Howl avec un état minimal mais cohérent (lecture, pause, boucle,
// chargement différé) pour rejouer les actions pendant un fondu (#23).
const { FakeHowl, instances } = vi.hoisted(() => {
    const instances = [];
    class FakeHowl {
        constructor(opts) {
            this.opts = opts;
            this._loop = !!opts.loop;
            this._state = 'loaded';
            this._playing = false;
            this._paused = false;
            this._seek = 0;
            this._volume = opts.volume;
            this._sprite = opts.sprite || {};
            this._nextId = 0;
            this._soundId = null;
            // HTML5 (html5: true) : play() renvoie une promesse et verrouille le Howl
            // (_playLock) jusqu'à sa résolution ; un seek reçu pendant le verrou part
            // dans la file de Howler et n'en ressort pas (seul un événement du même
            // type la vide) — c'est le piège de #42
            this._playLock = false;
            this.lostSeeks = [];
            this.lostPauses = 0;
            this.fades = []; // [from, to, durationMs, id]
            this.listeners = {};
            this.playCount = 0;
            this.lastPlayArg = undefined;
            instances.push(this);
        }
        state() { return this._state; }
        load() { this._state = 'loading'; }
        finishLoading() {
            this._state = 'loaded';
            const listeners = this.listeners.load || [];
            this.listeners.load = [];
            listeners.forEach(fn => fn());
        }
        once(event, fn, id) {
            if (id !== undefined) fn.soundId = id;
            (this.listeners[event] ||= []).push(fn);
        }
        _lockUntilPlaying(id) {
            this._playLock = true;
            setTimeout(() => {
                this._playLock = false;
                const listeners = (this.listeners.play || []).filter(fn => fn.soundId === undefined || fn.soundId === id);
                this.listeners.play = (this.listeners.play || []).filter(fn => !listeners.includes(fn));
                listeners.forEach(fn => fn(id));
            }, 0);
        }
        off(event, fn) {
            this.listeners[event] = (this.listeners[event] || []).filter(l => l !== fn);
        }
        play(arg) {
            this.playCount++;
            this.lastPlayArg = arg;
            if (typeof arg === 'number' && arg === this._soundId && this._paused) {
                this._paused = false;
                this._playing = true;
                this._lockUntilPlaying(arg);
                return arg;
            }
            // Comme Howler : un nouveau son (ou un son recyclé via reset()) repart
            // du début de son sprite — un seek fait avant play() est perdu.
            this._soundId = ++this._nextId;
            const sprite = typeof arg === 'string' ? this._sprite[arg] : null;
            this._seek = sprite ? sprite[0] / 1000 : 0;
            this._paused = false;
            this._playing = true;
            this._lockUntilPlaying(this._soundId);
            return this._soundId;
        }
        pause() {
            if (this._playLock) { this.lostPauses++; return this; } // même piège que le seek (#42)
            if (this._playing) { this._playing = false; this._paused = true; }
            return this;
        }
        stop() { this._playing = false; this._paused = false; this._soundId = null; this._seek = 0; }
        playing() { return this._playing; }
        loop(value) {
            if (value === undefined) return this._loop;
            this._loop = value;
            return this;
        }
        volume(value) {
            if (value === undefined) return this._volume;
            this._volume = value;
            return this;
        }
        fade(from, to, len, id) { this.fades.push([from, to, len, id]); this._volume = to; }
        seek(value, id) {
            // Comme Howler : un argument unique égal à l'id d'un son vivant est lu
            // comme « donne-moi la position de ce son » (getter), pas comme un seek
            if (typeof value === 'number' && arguments.length === 1 && value === this._soundId) return this._seek;
            if (typeof value === 'number') {
                if (this._playLock) { this.lostSeeks.push(value); return this; }
                this._seek = value;
                // Comme Howler : événement « seek » une fois le son déplacé
                const listeners = (this.listeners.seek || []).filter(fn => fn.soundId === undefined || fn.soundId === id);
                this.listeners.seek = (this.listeners.seek || []).filter(fn => !listeners.includes(fn));
                setTimeout(() => listeners.forEach(fn => fn(id)), 0);
                return this;
            }
            return this._seek;
        }
        duration() { return 180; }
        // Mise en place d'un test : position atteinte par la lecture (pas un seek)
        setPosition(value) { this._seek = value; }
    }
    return { FakeHowl, instances };
});

vi.mock('howler', () => ({ Howl: FakeHowl, Howler: { volume: vi.fn() } }));

import { Track } from '../backend/Track.js';

function createTrack() {
    const track = new Track('t1', 'Forêt', { calm: 'calm.mp3', combat: 'combat.mp3', tension: 'tension.mp3' });
    track.loadVersions();
    return track;
}

const playingVersions = track =>
    Object.entries(track.versions).filter(([, howl]) => howl.playing()).map(([name]) => name);

beforeEach(() => {
    vi.useFakeTimers();
    instances.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('Track — actions pendant un fondu (#23)', () => {
    it('la version cible boucle aussi en mode boucle unique', () => {
        const track = createTrack();
        track.setLoop(true);
        track.play('calm');

        track.crossfade('combat', 1);
        vi.runAllTimers();

        expect(track.currentVersion).toBe('combat');
        expect(track.versions.combat.loop()).toBe(true);
    });

    it('pause pendant un fondu : termine le fondu puis met en pause la version cible', () => {
        const track = createTrack();
        track.play('calm');
        track.crossfade('combat', 1);
        vi.advanceTimersByTime(100); // fondu en cours

        track.pause();
        vi.runAllTimers();

        expect(playingVersions(track)).toEqual([]);
        expect(track.currentVersion).toBe('combat');
        expect(track.isCrossfading).toBe(false);

        track.resume();
        expect(playingVersions(track)).toEqual(['combat']);
        vi.runAllTimers(); // fondu d'entrée de la reprise (#43)
        expect(track.versions.combat.volume()).toBe(track.defaultVolume);
    });

    it('reprendre ne lance pas une seconde instance d\'une version déjà en lecture', () => {
        const track = createTrack();
        track.play('calm');

        track.resume();

        expect(track.versions.calm.playCount).toBe(1);
    });

    it('stop pendant un fondu : rien ne redémarre ensuite', () => {
        const track = createTrack();
        track.play('calm');
        track.versions.combat.play = vi.fn(() => 1); // la cible « ne joue pas » → ancienne branche de restauration

        track.crossfade('combat', 1);
        track.stop();
        vi.runAllTimers();

        expect(playingVersions(track)).toEqual([]);
        expect(track.currentVersion).toBeNull();
    });

    it('stop pendant le chargement de la cible : elle ne démarre pas à la fin du chargement', () => {
        const track = createTrack();
        track.play('calm');
        track.versions.combat._state = 'unloaded';

        track.crossfade('combat', 1);
        track.stop();
        track.versions.combat.finishLoading();
        vi.runAllTimers();

        expect(playingVersions(track)).toEqual([]);
    });

    it('pause pendant le chargement de la cible : rien ne joue au chargement, la reprise joue la cible', () => {
        const track = createTrack();
        track.play('calm');
        track.versions.calm.setPosition(42);
        track.versions.combat._state = 'unloaded';

        track.crossfade('combat', 1);
        track.pause();
        track.versions.combat.finishLoading();
        vi.runAllTimers();

        expect(playingVersions(track)).toEqual([]);
        expect(track.currentVersion).toBe('combat');

        track.resume();
        expect(playingVersions(track)).toEqual(['combat']);
        vi.advanceTimersByTime(0); // démarrage HTML5 : le seek attend la fin du _playLock (#42)
        expect(track.versions.combat.seek()).toBe(42);
    });

    it('un changement de version pendant un fondu enchaîne au lieu d\'être ignoré', () => {
        const track = createTrack();
        track.play('calm');
        const results = [];

        track.crossfade('combat', 1, ok => results.push(['combat', ok]));
        vi.advanceTimersByTime(100);
        track.crossfade('tension', 1, ok => results.push(['tension', ok]));
        vi.runAllTimers();

        expect(track.currentVersion).toBe('tension');
        expect(playingVersions(track)).toEqual(['tension']);
        expect(results).toEqual([['combat', true], ['tension', true]]);
    });

    it('la fin de la version sortante pendant un fondu ne déclenche pas la piste suivante', () => {
        const track = createTrack();
        track.onEndCallback = vi.fn();
        track.play('calm');
        track.crossfade('combat', 1);
        vi.advanceTimersByTime(100);

        track.versions.calm.opts.onend();

        expect(track.onEndCallback).not.toHaveBeenCalled();
    });

    it('changer de version en pause : la reprise joue la nouvelle version à la même position', () => {
        const track = createTrack();
        track.play('calm');
        track.versions.calm.setPosition(30);
        track.pause();

        track.switchVersionWhilePaused('combat');

        expect(track.currentVersion).toBe('combat');
        expect(track.getCurrentTime()).toBe(30);

        track.resume();
        expect(playingVersions(track)).toEqual(['combat']);
        vi.advanceTimersByTime(0); // démarrage HTML5 : le seek attend la fin du _playLock (#42)
        expect(track.versions.combat.seek()).toBe(30);
    });

    it('seek pendant un fondu : termine le fondu et déplace la version cible', () => {
        const track = createTrack();
        track.play('calm');
        track.crossfade('combat', 1);
        vi.advanceTimersByTime(100);

        track.seek(12);

        expect(track.isCrossfading).toBe(false);
        expect(playingVersions(track)).toEqual(['combat']);
        vi.advanceTimersByTime(0); // démarrage HTML5 : le seek attend la fin du _playLock (#42)
        expect(track.versions.combat.seek()).toBe(12);
    });
});

describe('Track — durée de fondu en secondes (#28)', () => {
    it('migre l\'ancien % au chargement de la première version, avec sa durée réelle', () => {
        const track = createTrack();
        track.legacyCrossfadePercent = 0.03;
        track.onCrossfadeDurationMigrated = vi.fn();

        track.versions.calm.opts.onload(); // FakeHowl : 180 s → 3 % = 5,4 s, plafonné à 5 s

        expect(track.crossfadeDurationSeconds).toBe(5);
        expect(track.legacyCrossfadePercent).toBeNull();
        expect(track.onCrossfadeDurationMigrated).toHaveBeenCalledWith(5);

        track.versions.combat.opts.onload();
        expect(track.onCrossfadeDurationMigrated).toHaveBeenCalledOnce();
    });

    it('ne touche pas une piste déjà réglée en secondes', () => {
        const track = createTrack();
        track.crossfadeDurationSeconds = 2;
        track.onCrossfadeDurationMigrated = vi.fn();

        track.versions.calm.opts.onload();

        expect(track.getCrossfadeDurationMs()).toBe(2000);
        expect(track.onCrossfadeDurationMigrated).not.toHaveBeenCalled();
    });
});

function createSplitTrack() {
    const track = new Track('t2', 'Découpée', { calm: 'src.mp3', combat: 'src.mp3' }, {
        calm: { start: 0, end: 90 },
        combat: { start: 90, end: 180 },
    });
    track.loadVersions();
    return track;
}

describe('Track — position lors d\'un changement de version (seek après play)', () => {
    it('fondu entre versions fichier entier : la cible reprend au même timecode', () => {
        const track = createTrack();
        track.play('calm');
        track.versions.calm.setPosition(40);

        track.crossfade('combat', 1);

        vi.advanceTimersByTime(0); // démarrage HTML5 : le seek attend la fin du _playLock (#42)
        expect(track.versions.combat.seek()).toBe(40);
    });
});

describe('Track — seek pendant le démarrage HTML5 (#42)', () => {
    it('la cible d\'un fondu reprend au même timecode, même si son seek arrive pendant le _playLock', () => {
        const track = createTrack();
        track.play('calm');
        vi.advanceTimersByTime(0);
        track.versions.calm.setPosition(75);

        track.crossfade('combat', 1);
        vi.advanceTimersByTime(0); // la promesse de play() se résout

        expect(track.versions.combat.lostSeeks).toEqual([]); // rien n'est resté coincé dans la file
        expect(track.versions.combat.seek()).toBe(75);
        vi.runAllTimers();
        expect(track.currentVersion).toBe('combat');
        expect(track.getCurrentTime()).toBe(75); // la position lue est celle de combat, pas 0
    });

    it('un seek différé ne s\'applique pas à un son déjà remplacé', () => {
        const track = createTrack();
        track.play('calm');
        track.versions.calm.setPosition(75);
        track.crossfade('combat', 1);
        track.stop(); // avant que la lecture HTML5 de combat ait démarré
        track.play('combat');
        vi.advanceTimersByTime(0);

        expect(track.versions.combat.seek()).toBe(0);
    });
});

describe('Track — fondu à la pause et à la reprise (#43)', () => {
    function playingTrack(seconds = 4) {
        const track = createTrack();
        track.crossfadeDurationSeconds = seconds;
        track.play('calm');
        vi.advanceTimersByTime(0); // lecture HTML5 démarrée
        return track;
    }

    it('pause : fondu de sortie sur la durée de la piste, puis vraie pause', () => {
        const track = playingTrack(4);
        const calm = track.versions.calm;

        track.pause();
        expect(track.isPlaying).toBe(false);
        expect(calm.playing()).toBe(true); // on entend encore le fondu
        expect(calm.fades.at(-1).slice(0, 3)).toEqual([track.defaultVolume, 0, 4000]);

        vi.advanceTimersByTime(3999);
        expect(calm.playing()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(calm.playing()).toBe(false);
    });

    it('reprise : le son en pause repart (même son) avec un fondu d\'entrée', () => {
        const track = playingTrack(4);
        const calm = track.versions.calm;
        track.pause();
        vi.advanceTimersByTime(4000);
        const id = track._soundIds.calm;

        track.resume();
        vi.advanceTimersByTime(0);
        expect(calm.playing()).toBe(true);
        expect(calm.lastPlayArg).toBe(id);
        expect(calm.fades.at(-1).slice(0, 3)).toEqual([0, track.defaultVolume, 4000]);
    });

    it('reprise pendant le fondu de sortie : le son n\'est jamais coupé, le volume remonte', () => {
        const track = playingTrack(4);
        const calm = track.versions.calm;
        track.pause();
        vi.advanceTimersByTime(1000); // un quart du fondu

        track.resume();
        vi.runAllTimers();
        expect(track.isPlaying).toBe(true);
        expect(calm.playing()).toBe(true);
        const [from, to, len] = calm.fades.at(-1);
        expect(from).toBeCloseTo(track.defaultVolume * 0.75);
        expect(to).toBe(track.defaultVolume);
        expect(len).toBe(1000); // le temps déjà passé à descendre
    });

    it('stop pendant le fondu de pause : plus rien ne joue ni ne se met en pause ensuite', () => {
        const track = playingTrack(4);
        track.pause();
        vi.advanceTimersByTime(1000);
        track.stop();
        vi.runAllTimers();
        expect(playingVersions(track)).toEqual([]);
        expect(track.currentVersion).toBe(null);
    });

    it('changement de version pendant le fondu de pause : la reprise joue la cible au même timecode, en fondu', () => {
        const track = playingTrack(4);
        track.versions.calm.setPosition(30);
        track.pause();
        vi.advanceTimersByTime(1000);

        expect(track.switchVersionWhilePaused('combat')).toBe(true);
        vi.runAllTimers();
        expect(playingVersions(track)).toEqual([]);

        track.resume();
        vi.runAllTimers();
        expect(playingVersions(track)).toEqual(['combat']);
        expect(track.versions.combat.seek()).toBe(30);
        expect(track.versions.combat.fades.at(-1).slice(0, 2)).toEqual([0, track.defaultVolume]);
    });

    it('pause pendant le démarrage HTML5 : appliquée une fois la lecture démarrée, pas perdue', () => {
        const track = createTrack();
        track.crossfadeDurationSeconds = 1;
        track.play('calm'); // _playLock posé
        track.pause();
        vi.runAllTimers();
        expect(track.versions.calm.lostPauses).toBe(0);
        expect(track.versions.calm.playing()).toBe(false);
    });

    it('lancement d\'une piste : pas de fondu d\'entrée (seule la reprise en a un)', () => {
        const track = playingTrack(4);
        expect(track.versions.calm.fades).toEqual([]);
        expect(track.versions.calm.volume()).toBe(track.defaultVolume);
    });
});

describe('Track — versions découpées (#24)', () => {
    it('déclare un sprite par version découpée', () => {
        const track = createSplitTrack();
        expect(track.versions.combat.opts.sprite).toEqual({ segment: [90000, 90000] });
    });

    it('joue le sprite du segment, temps et durée relatifs au segment', () => {
        const track = createSplitTrack();

        track.play('combat');

        expect(track.versions.combat.lastPlayArg).toBe('segment');
        expect(track.getCurrentTime()).toBe(0);
        expect(track.getDuration()).toBe(90);
    });

    it('fondu vers une version découpée : même position relative dans son segment (#44)', () => {
        const track = createSplitTrack();
        track.play('calm');
        track.versions.calm.setPosition(40);

        track.crossfade('combat', 1);
        vi.runAllTimers();

        expect(track.versions.combat.lastPlayArg).toBe('segment');
        expect(track.versions.combat.seek()).toBe(130); // 90 (début du segment) + 40
        expect(track.getCurrentTime()).toBe(40);
    });

    it('au-delà de la fin du segment cible : début de la cible, comme avec un tempo (#44)', () => {
        const track = new Track('t4', 'Inégale', { calm: 'src.mp3', combat: 'src.mp3' }, {
            calm: { start: 0, end: 120 },
            combat: { start: 120, end: 180 }, // 60 s
        });
        track.loadVersions();
        track.play('calm');
        track.versions.calm.setPosition(100);

        track.crossfade('combat', 1);
        vi.runAllTimers();

        expect(track.getCurrentTime()).toBe(0);
    });

    it('au-delà de la fin du segment cible, même en boucle unique : début de la cible (#48)', () => {
        const track = new Track('t4', 'Inégale', { calm: 'src.mp3', combat: 'src.mp3' }, {
            calm: { start: 0, end: 120 },
            combat: { start: 120, end: 180 }, // 60 s
        });
        track.loadVersions();
        track.setLoop(true);
        track.play('calm');
        track.versions.calm.setPosition(100);

        track.crossfade('combat', 1);
        vi.runAllTimers();

        expect(track.getCurrentTime()).toBe(0); // plus de modulo (100 − 60 = 40 avant #48)
    });

    it('reprise après pause : reprend le son en pause, pas le début du segment', () => {
        const track = createSplitTrack();
        track.play('combat');
        vi.advanceTimersByTime(0); // lecture démarrée
        track.versions.combat.setPosition(120);

        track.pause();
        vi.runAllTimers(); // fondu de pause terminé (#43) : le son est vraiment en pause
        track.resume();
        vi.advanceTimersByTime(0);

        expect(typeof track.versions.combat.lastPlayArg).toBe('number');
        expect(track.getCurrentTime()).toBe(30);
    });

    it('seek relatif au segment', () => {
        const track = createSplitTrack();
        track.play('combat');

        track.seek(10);

        vi.advanceTimersByTime(0); // démarrage HTML5 : le seek attend la fin du _playLock (#42)
        expect(track.versions.combat.seek()).toBe(100);
        expect(track.getCurrentTime()).toBe(10);
    });

    it('changer de version en pause vers un segment : reprise à la même position relative (#44)', () => {
        const track = createSplitTrack();
        track.play('calm');
        vi.advanceTimersByTime(0);
        track.versions.calm.setPosition(40);
        track.pause();
        vi.runAllTimers(); // fondu de pause (#43)

        track.switchVersionWhilePaused('combat');
        expect(track.getCurrentTime()).toBe(40);

        track.resume();
        vi.advanceTimersByTime(0); // démarrage HTML5 : le seek attend la fin du _playLock (#42)
        expect(track.versions.combat.seek()).toBe(130);
    });

    it('fin du segment actif → piste suivante', () => {
        const track = createSplitTrack();
        track.onEndCallback = vi.fn();
        track.play('combat');

        track.versions.combat.opts.onend();

        expect(track.onEndCallback).toHaveBeenCalledOnce();
    });

    it('migration du fondu : utilise la durée du segment, pas celle du fichier', () => {
        const track = createSplitTrack();
        track.legacyCrossfadePercent = 0.05;

        track.versions.calm.opts.onload(); // 5 % de 90 s = 4,5 s

        expect(track.crossfadeDurationSeconds).toBe(4.5);
    });

    it('réordonne ses versions sans recréer les Howl', () => {
        const track = createSplitTrack();
        const combat = track.versions.combat;

        track.reorderVersions(['combat', 'calm']);

        expect(Object.keys(track.versions)).toEqual(['combat', 'calm']);
        expect(track.versions.combat).toBe(combat);
    });
});

describe('Track — synchronisation BPM (#18)', () => {
    it('fondu entre versions fichier entier : reprise calée sur les temps', () => {
        const track = createTrack();
        track.tempo = { calm: { bpm: 120, offsetMs: 500 }, combat: { bpm: 60, offsetMs: 1000 } };
        track.play('calm');
        track.versions.calm.setPosition(10.5);

        track.crossfade('combat', 1);

        vi.advanceTimersByTime(0); // démarrage HTML5 : le seek attend la fin du _playLock (#42)
        expect(track.versions.combat.seek()).toBeCloseTo(21);
    });

    it('prime sur « début du segment » quand les deux versions découpées ont un tempo', () => {
        const track = createSplitTrack();
        track.tempo = { calm: { bpm: 120, offsetMs: 0 }, combat: { bpm: 60, offsetMs: 0 } };
        track.play('calm');
        track.versions.calm.setPosition(10);

        track.crossfade('combat', 1);
        vi.runAllTimers();

        expect(track.getCurrentTime()).toBeCloseTo(20);
        vi.advanceTimersByTime(0); // démarrage HTML5 : le seek attend la fin du _playLock (#42)
        expect(track.versions.combat.seek()).toBeCloseTo(110);
    });

    it('changement de version en pause : même calcul', () => {
        const track = createTrack();
        track.tempo = { calm: { bpm: 120, offsetMs: 500 }, combat: { bpm: 60, offsetMs: 1000 } };
        track.play('calm');
        track.versions.calm.setPosition(10.5);
        track.pause();

        track.switchVersionWhilePaused('combat');

        expect(track.getCurrentTime()).toBeCloseTo(21);
    });

    it('sans tempo sur la cible : comportement par défaut (même timecode)', () => {
        const track = createTrack();
        track.tempo = { calm: { bpm: 120, offsetMs: 500 } };
        track.play('calm');
        track.versions.calm.setPosition(10.5);

        track.crossfade('combat', 1);

        vi.advanceTimersByTime(0); // démarrage HTML5 : le seek attend la fin du _playLock (#42)
        expect(track.versions.combat.seek()).toBe(10.5);
    });
});

describe('Track — écarts de position (#35)', () => {
    it('fondu échoué : la version d\'origine reprend à sa position, pas au début', () => {
        const track = createTrack();
        track.play('calm');
        track.versions.calm.setPosition(40);
        track.versions.combat.play = vi.fn(() => 99); // la cible ne démarre pas

        track.crossfade('combat', 1);
        track.versions.calm.stop(); // l'origine s'est arrêtée entre-temps
        vi.advanceTimersByTime(300); // échec constaté après les revérifications (démarrage lent toléré)

        expect(track.versions.calm.playing()).toBe(true);
        vi.advanceTimersByTime(0); // démarrage HTML5 : le seek attend la fin du _playLock (#42)
        expect(track.versions.calm.seek()).toBe(40);
    });

    it('seek vers une position égale à l\'id du son : bien appliqué (pas pris pour un getter)', () => {
        const track = createTrack();
        track.play('calm'); // FakeHowl : premier son = id 1
        vi.advanceTimersByTime(0); // lecture démarrée

        track.seek(1);
        track.versions.calm.seek(55); // puis on vérifie qu'un seek arbitraire marche toujours
        track.seek(1);
        vi.advanceTimersByTime(0);

        expect(track.getCurrentTime()).toBe(1);
    });

    it('durée HTML5 sous-estimée (MP3 VBR sans en-tête) : le segment garde ses bornes et joue (#49)', () => {
        // FakeHowl annonce 180 s ; le fichier réel (décodé par le Découpage) est plus long
        const track = new Track('t3', 'VBR', { calm: 'src.mp3', combat: 'src.mp3' }, {
            calm: { start: 0, end: 90 },
            combat: { start: 200, end: 250 }, // commence après la durée annoncée
        });
        track.loadVersions();

        track.versions.combat.opts.onload();
        track.play('combat');

        expect(track.getDuration()).toBe(50);
        expect(track.versions.combat._sprite.segment).toEqual([200000, 50000]);
        expect(track.versions.combat.lastPlayArg).toBe('segment');
    });
});

describe('Track — défiler les versions (#46)', () => {
    // FakeHowl : versions de 180 s, fondu par défaut 5 s → enchaînement à 175 s
    const FADE_START_MS = 175000;

    function startCycling(track = createTrack(), version = 'calm') {
        track.setVersionCycle(true);
        track.play(version);
        vi.advanceTimersByTime(0); // démarrage HTML5 (_playLock)
        return track;
    }

    it('lance la version suivante en fondu, à son début, une durée de fondu avant la fin', () => {
        const track = startCycling();

        vi.advanceTimersByTime(FADE_START_MS - 10);
        expect(track.isCrossfading).toBe(false);
        vi.advanceTimersByTime(10);

        expect(track.isCrossfading).toBe(true);
        expect(track.versions.calm.fades).toContainEqual([track.defaultVolume, 0, 5000, undefined]);
        vi.advanceTimersByTime(6000);
        expect(track.currentVersion).toBe('combat');
        expect(track.versions.combat.seek()).toBe(0); // pas la position relative (#44) : 175 s
        expect(track.versions.combat.lostSeeks).toEqual([]);
    });

    it('après la dernière version, revient à la première', () => {
        const track = startCycling(createTrack(), 'tension');

        vi.advanceTimersByTime(FADE_START_MS + 6000);

        expect(track.currentVersion).toBe('calm');
    });

    it('continue de défiler après un premier enchaînement', () => {
        const track = startCycling();

        vi.advanceTimersByTime(FADE_START_MS + 6000);
        vi.advanceTimersByTime(FADE_START_MS);

        expect(track.isCrossfading).toBe(true);
        vi.advanceTimersByTime(6000);
        expect(track.currentVersion).toBe('tension');
    });

    it('prévient quand une version a été enchaînée', () => {
        const track = createTrack();
        const cycled = vi.fn();
        track.onVersionCycled = cycled;
        startCycling(track);

        vi.advanceTimersByTime(FADE_START_MS + 6000);

        expect(cycled).toHaveBeenCalledOnce();
    });

    it('une piste à une seule version boucle', () => {
        const track = new Track('t2', 'Seule', { calm: 'calm.mp3' });
        track.loadVersions();
        startCycling(track);

        expect(track.versions.calm.loop()).toBe(true);
        vi.advanceTimersByTime(FADE_START_MS + 6000);
        expect(track.isCrossfading).toBe(false);
    });

    it('la pause annule l\'enchaînement, la reprise le reprogramme', () => {
        const track = startCycling();

        track.pause();
        vi.advanceTimersByTime(FADE_START_MS + 6000);
        expect(track.isCrossfading).toBe(false);
        expect(track.currentVersion).toBe('calm');

        track.resume();
        vi.advanceTimersByTime(FADE_START_MS);
        expect(track.isCrossfading).toBe(true);
    });

    it('un déplacement dans la piste reprogramme l\'enchaînement', () => {
        const track = startCycling();

        track.seek(170);
        vi.advanceTimersByTime(5000);

        expect(track.isCrossfading).toBe(true);
    });

    it('un changement de version manuel : le défilement repart de la version choisie', () => {
        const track = startCycling();

        track.crossfade('tension', 1);
        vi.advanceTimersByTime(2000);
        expect(track.currentVersion).toBe('tension');

        vi.advanceTimersByTime(FADE_START_MS + 6000);
        expect(track.currentVersion).toBe('calm');
    });

    it('désactiver le mode : plus rien n\'est programmé', () => {
        const track = startCycling();

        track.setVersionCycle(false);
        vi.advanceTimersByTime(FADE_START_MS + 6000);

        expect(track.isCrossfading).toBe(false);
        expect(track.currentVersion).toBe('calm');
    });

    it('activer le mode pendant la lecture programme l\'enchaînement', () => {
        const track = createTrack();
        track.play('calm');
        vi.advanceTimersByTime(0);

        track.setVersionCycle(true);
        vi.advanceTimersByTime(FADE_START_MS);

        expect(track.isCrossfading).toBe(true);
    });

    it('version courte : fondu plafonné à la moitié de la version', () => {
        const track = new Track('t3', 'Court', { calm: 'src.mp3', combat: 'src.mp3' }, {
            calm: { start: 0, end: 6 },
            combat: { start: 6, end: 12 },
        });
        track.loadVersions();
        startCycling(track);

        vi.advanceTimersByTime(2990);
        expect(track.isCrossfading).toBe(false);
        vi.advanceTimersByTime(10);

        expect(track.isCrossfading).toBe(true);
        expect(track.versions.calm.fades).toContainEqual([track.defaultVolume, 0, 3000, undefined]);
    });

    it('fin de version malgré tout : version suivante tout de suite, jamais la piste suivante', () => {
        const track = startCycling();
        const onEnd = vi.fn();
        track.onEndCallback = onEnd;
        track.setVersionCycle(true);

        track.versions.calm.opts.onend();

        expect(onEnd).not.toHaveBeenCalled();
        expect(track.currentVersion).toBe('combat');
        expect(track.versions.combat.playing()).toBe(true);
    });

    it('stop : plus rien n\'est programmé', () => {
        const track = startCycling();

        track.stop();
        vi.advanceTimersByTime(FADE_START_MS + 6000);

        expect(playingVersions(track)).toEqual([]);
    });
});
