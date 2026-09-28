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
        once(event, fn) { (this.listeners[event] ||= []).push(fn); }
        off(event, fn) {
            this.listeners[event] = (this.listeners[event] || []).filter(l => l !== fn);
        }
        play(arg) {
            this.playCount++;
            this.lastPlayArg = arg;
            if (typeof arg === 'number' && arg === this._soundId && this._paused) {
                this._paused = false;
                this._playing = true;
                return arg;
            }
            // Comme Howler : un nouveau son (ou un son recyclé via reset()) repart
            // du début de son sprite — un seek fait avant play() est perdu.
            this._soundId = ++this._nextId;
            const sprite = typeof arg === 'string' ? this._sprite[arg] : null;
            this._seek = sprite ? sprite[0] / 1000 : 0;
            this._paused = false;
            this._playing = true;
            return this._soundId;
        }
        pause() {
            if (this._playing) { this._playing = false; this._paused = true; }
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
        fade(from, to) { this._volume = to; }
        seek(value) {
            if (typeof value === 'number') { this._seek = value; return this; }
            return this._seek;
        }
        duration() { return 180; }
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
        track.versions.calm.seek(42);
        track.versions.combat._state = 'unloaded';

        track.crossfade('combat', 1);
        track.pause();
        track.versions.combat.finishLoading();
        vi.runAllTimers();

        expect(playingVersions(track)).toEqual([]);
        expect(track.currentVersion).toBe('combat');

        track.resume();
        expect(playingVersions(track)).toEqual(['combat']);
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
        track.versions.calm.seek(30);
        track.pause();

        track.switchVersionWhilePaused('combat');

        expect(track.currentVersion).toBe('combat');
        expect(track.getCurrentTime()).toBe(30);

        track.resume();
        expect(playingVersions(track)).toEqual(['combat']);
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
        track.versions.calm.seek(40);

        track.crossfade('combat', 1);

        expect(track.versions.combat.seek()).toBe(40);
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

    it('fondu vers une version découpée : démarre au début de son segment', () => {
        const track = createSplitTrack();
        track.play('calm');
        track.versions.calm.seek(40);

        track.crossfade('combat', 1);
        vi.runAllTimers();

        expect(track.versions.combat.lastPlayArg).toBe('segment');
        expect(track.versions.combat.seek()).toBe(90);
        expect(track.getCurrentTime()).toBe(0);
    });

    it('reprise après pause : reprend le son en pause, pas le début du segment', () => {
        const track = createSplitTrack();
        track.play('combat');
        track.versions.combat.seek(120);

        track.pause();
        track.resume();

        expect(typeof track.versions.combat.lastPlayArg).toBe('number');
        expect(track.getCurrentTime()).toBe(30);
    });

    it('seek relatif au segment', () => {
        const track = createSplitTrack();
        track.play('combat');

        track.seek(10);

        expect(track.versions.combat.seek()).toBe(100);
        expect(track.getCurrentTime()).toBe(10);
    });

    it('changer de version en pause vers un segment : reprise au début du segment', () => {
        const track = createSplitTrack();
        track.play('calm');
        track.versions.calm.seek(40);
        track.pause();

        track.switchVersionWhilePaused('combat');
        expect(track.getCurrentTime()).toBe(0);

        track.resume();
        expect(track.versions.combat.seek()).toBe(90);
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
