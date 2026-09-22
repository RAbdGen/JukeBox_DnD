import { afterEach, describe, expect, it, vi } from 'vitest';

const { howlerVolume } = vi.hoisted(() => ({
    howlerVolume: vi.fn(),
}));

vi.mock('howler', () => ({
    Howler: { volume: howlerVolume },
    Howl: vi.fn(),
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
