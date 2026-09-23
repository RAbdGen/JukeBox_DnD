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
            once: vi.fn(),
            load: vi.fn(),
        };
    }),
}));

import { AudioManager } from '../backend/AudioManager.js';

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
        const howl = { volume: vi.fn(), play: vi.fn() };
        const manager = new AudioManager();
        manager.currentTrack = {
            defaultVolume: 0,
            currentVersion: 'calm',
            versions: { calm: howl },
            isPlaying: false,
        };

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
