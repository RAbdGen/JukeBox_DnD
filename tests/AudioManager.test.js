import { afterEach, describe, expect, it, vi } from 'vitest';

const { howlerVolume } = vi.hoisted(() => ({
    howlerVolume: vi.fn(),
}));

vi.mock('howler', () => ({
    Howler: { volume: howlerVolume },
    Howl: vi.fn(function () {
        return {
            play: vi.fn(),
            pause: vi.fn(),
            stop: vi.fn(),
            volume: vi.fn(),
            loop: vi.fn(),
            seek: vi.fn(() => 0),
            playing: vi.fn(() => false),
            state: vi.fn(() => 'loaded'),
            duration: vi.fn(() => 0),
            fade: vi.fn(),
            once: vi.fn(),
            off: vi.fn(),
            load: vi.fn(),
        };
    }),
}));

import { AudioManager } from '../backend/AudioManager.js';
import { Track } from '../backend/Track.js';

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('AudioManager volume handling', () => {
    it('preserves a track normalised volume when the global volume changes', () => {
        const manager = new AudioManager();
        const track = { defaultVolume: 0.35, setVolume: vi.fn() };
        manager.currentTrack = track;

        manager.setVolume(0.8);

        expect(track.defaultVolume).toBe(0.35);
        expect(track.setVolume).not.toHaveBeenCalled();
        expect(howlerVolume).toHaveBeenLastCalledWith(0.8);
    });

    it('resumes a track normalised to zero at zero volume', () => {
        const howl = { volume: vi.fn(), play: vi.fn(), playing: vi.fn(() => false), state: vi.fn(() => 'loaded') };
        const manager = new AudioManager();
        const track = new Track('t1', 'Track 1', { calm: 'a.mp3' });
        track.defaultVolume = 0;
        track.currentVersion = 'calm';
        track.versions = { calm: howl };
        manager.currentTrack = track;

        manager.resume();

        expect(howl.volume).toHaveBeenCalledWith(0);
        expect(howl.play).toHaveBeenCalledOnce();
    });

    it('cancels a fade when a manual volume adjustment occurs', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] });
        const manager = new AudioManager();
        const fading = manager.fadeVolume(0, 300);

        manager.setVolume(0.7);
        await vi.advanceTimersByTimeAsync(400);
        await fading;

        expect(manager.getVolume()).toBe(0.7);
        expect(howlerVolume).toHaveBeenLastCalledWith(0.7);
    });
});

describe('AudioManager.loadPlaylist', () => {
    it('applies a track-specific crossfade duration from the playlist configuration', () => {
        const manager = new AudioManager();

        manager.loadPlaylist([{
            id: 't1',
            title: 'Track 1',
            versions: { calm: 'a.mp3' },
            crossfadeDurationPercent: 0.25,
        }]);

        expect(manager.getTrack('t1').crossfadeDurationPercent).toBe(0.25);
    });

    it('defaults a track crossfade duration to 10 percent', () => {
        const manager = new AudioManager();

        manager.loadPlaylist([{
            id: 't1',
            title: 'Track 1',
            versions: { calm: 'a.mp3' },
        }]);

        expect(manager.getTrack('t1').crossfadeDurationPercent).toBe(0.1);
    });

    it('ne coupe pas la lecture en cours quand la piste jouée reste dans la nouvelle config (#13)', () => {
        const manager = new AudioManager();
        const initialConfig = [
            { id: 't1', title: 'Track 1', versions: { calm: 'a.mp3' } },
            { id: 't2', title: 'Track 2', versions: { calm: 'b.mp3' } },
        ];
        manager.loadPlaylist(initialConfig);

        const playingTrack = manager.getTrack('t2');
        manager.currentTrack = playingTrack;
        manager.currentTrackIndex = 1;
        const stopSpy = vi.spyOn(playingTrack, 'stop');

        // Ajout d'une piste à la playlist active pendant la lecture
        manager.loadPlaylist([
            ...initialConfig,
            { id: 't3', title: 'Track 3', versions: { calm: 'c.mp3' } },
        ]);

        expect(stopSpy).not.toHaveBeenCalled();
        expect(manager.currentTrack).toBe(playingTrack);
        expect(manager.currentTrackIndex).toBe(1); // t2 toujours en position 1
        expect(manager.playlist).toHaveLength(3);
        expect(manager.getTrack('t2')).toBe(playingTrack); // même instance, pas rechargée
    });

    it('stoppe et réinitialise en changeant réellement de playlist', () => {
        const manager = new AudioManager();
        manager.loadPlaylist([{ id: 't1', title: 'Track 1', versions: { calm: 'a.mp3' } }]);
        const track = manager.getTrack('t1');
        manager.currentTrack = track;
        manager.currentTrackIndex = 0;
        const stopSpy = vi.spyOn(track, 'stop');

        manager.loadPlaylist([{ id: 't9', title: 'Track 9', versions: { calm: 'z.mp3' } }]);

        expect(stopSpy).toHaveBeenCalledOnce();
        expect(manager.currentTrack).toBeNull();
        expect(manager.currentTrackIndex).toBe(0);
        expect(manager.getTrack('t1')).toBeNull();
    });
});

describe('AudioManager crossfade handling', () => {
    it('uses the active track crossfade duration instead of a global default', () => {
        const manager = new AudioManager();
        const track = {
            crossfadeDurationPercent: 0.25,
            currentVersion: 'calm',
            crossfade: vi.fn((toVersion, durationPercent, onComplete) => onComplete(true)),
            getState: vi.fn(() => ({ currentVersion: 'combat' })),
        };
        manager.currentTrack = track;

        manager.crossfade('combat');

        expect(track.crossfade).toHaveBeenCalledWith('combat', 0.25, expect.any(Function));
    });

    it('keeps accepting an explicit crossfade duration for existing callers', () => {
        const manager = new AudioManager();
        const track = {
            crossfadeDurationPercent: 0.25,
            currentVersion: 'calm',
            crossfade: vi.fn((toVersion, durationPercent, onComplete) => onComplete(true)),
            getState: vi.fn(() => ({ currentVersion: 'combat' })),
        };
        manager.currentTrack = track;

        manager.crossfade('combat', 0.05);

        expect(track.crossfade).toHaveBeenCalledWith('combat', 0.05, expect.any(Function));
    });

    it('keeps accepting an explicit crossfade duration above the per-track UI range', () => {
        const manager = new AudioManager();
        const track = {
            crossfadeDurationPercent: 0.25,
            currentVersion: 'calm',
            crossfade: vi.fn((toVersion, durationPercent, onComplete) => onComplete(true)),
            getState: vi.fn(() => ({ currentVersion: 'combat' })),
        };
        manager.currentTrack = track;

        manager.crossfade('combat', 0.5);

        expect(track.crossfade).toHaveBeenCalledWith('combat', 0.5, expect.any(Function));
    });
});

describe('AudioManager — modes de boucle et switch de musique (#23)', () => {
    const config = [
        { id: 't1', title: 'Track 1', versions: { calm: 'a.mp3', combat: 'a2.mp3' } },
        { id: 't2', title: 'Track 2', versions: { calm: 'b.mp3' } },
    ];

    it('applique la boucle unique à toutes les versions de la piste lancée', () => {
        const manager = new AudioManager();
        manager.loadPlaylist(config);
        manager.setPlayMode('loopOne');

        manager.playTrackAtIndex(0);

        const track = manager.getTrack('t1');
        expect(track.loop).toBe(true);
        expect(track.versions.combat.loop).toHaveBeenCalledWith(true);
    });

    it('le bouton suivant change bien de piste en mode boucle unique', () => {
        const manager = new AudioManager();
        manager.loadPlaylist(config);
        manager.setPlayMode('loopOne');
        manager.playTrackAtIndex(0);

        manager.nextTrack();

        expect(manager.currentTrack.id).toBe('t2');
        expect(manager.currentTrackIndex).toBe(1);
    });

    it('la fin naturelle d\'une piste en boucle unique ne change pas de piste', () => {
        const manager = new AudioManager();
        manager.loadPlaylist(config);
        manager.setPlayMode('loopOne');
        manager.playTrackAtIndex(0);

        manager.onTrackEnd();

        expect(manager.currentTrack.id).toBe('t1');
    });

    it('notifie l\'UI quand la fin de playlist arrête la lecture', () => {
        const manager = new AudioManager();
        const onTrackChange = vi.fn();
        manager.on('trackChange', onTrackChange);
        manager.loadPlaylist(config);
        manager.playTrackAtIndex(1);
        onTrackChange.mockClear();

        manager.onTrackEnd();

        expect(manager.isPlaying()).toBe(false);
        expect(onTrackChange).toHaveBeenCalledOnce();
    });

    it('resynchronise la version affichée quand un fondu est avorté', () => {
        const manager = new AudioManager();
        const track = {
            currentVersion: 'calm',
            isPlaying: true,
            crossfade: vi.fn((toVersion, durationPercent, onComplete) => onComplete(false)),
            getState: vi.fn(() => ({ currentVersion: 'calm' })),
        };
        manager.currentTrack = track;

        manager.switchVersion('combat');

        expect(manager.currentVersion).toBe('calm');
    });

    it('enchaîner deux changements de version affiche la dernière cible', () => {
        const manager = new AudioManager();
        manager.loadPlaylist([{ id: 't1', title: 'Track 1', versions: { calm: 'a.mp3', combat: 'b.mp3', tension: 'c.mp3' } }]);
        manager.playTrackAtIndex(0);

        manager.switchVersion('combat');
        manager.switchVersion('tension');

        expect(manager.currentTrack.isCrossfading).toBe(true);
        expect(manager.currentVersion).toBe('tension');
    });

    it('changer de version en pause : bascule sans fondu, reprise sur la nouvelle version', () => {
        const manager = new AudioManager();
        manager.loadPlaylist(config);
        manager.playTrackAtIndex(0);
        manager.pause();

        manager.switchVersion('combat');

        expect(manager.currentVersion).toBe('combat');
        expect(manager.currentTrack.currentVersion).toBe('combat');
        expect(manager.isPlaying()).toBe(false);
    });

    it('changer de version à l\'arrêt : mémorise seulement le choix', () => {
        const manager = new AudioManager();
        manager.loadPlaylist(config);

        manager.switchVersion('combat');

        expect(manager.currentVersion).toBe('combat');
        expect(manager.currentTrack).toBeNull();
    });
});
