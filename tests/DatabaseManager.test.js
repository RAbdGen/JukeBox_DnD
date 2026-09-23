import { describe, expect, it, vi } from 'vitest';
import { DatabaseManager } from '../backend/DatabaseManager.js';

function createDatabaseManager(data) {
    const manager = new DatabaseManager();
    manager.db = { data, write: vi.fn().mockResolvedValue() };
    return manager;
}

describe('DatabaseManager.mergeImportedLibrary', () => {
    it('normalises an invalid imported crossfade duration to the default', async () => {
        const manager = createDatabaseManager({
            library: [],
            playlists: [],
            metadata: {},
        });

        await manager.mergeImportedLibrary({
            library: [{ id: 't1', title: 'Importée', crossfadeDurationPercent: 'invalid' }],
            playlists: [],
        });

        expect(manager.db.data.library[0].crossfadeDurationPercent).toBe(0.1);
    });

    it('merges a malformed existing playlist as an empty track list', async () => {
        const manager = createDatabaseManager({
            library: [],
            playlists: [{ id: 'p1', name: 'Locale', trackIds: ['track-a'] }],
            metadata: {},
        });

        await manager.mergeImportedLibrary({
            library: [],
            playlists: [{ id: 'p1', name: 'Importée' }],
        });

        expect(manager.db.data.playlists[0].trackIds).toEqual(['track-a']);
        expect(manager.db.write).toHaveBeenCalledOnce();
    });

    it('stores a new malformed playlist with an empty track list', async () => {
        const manager = createDatabaseManager({
            library: [],
            playlists: [],
            metadata: {},
        });

        await manager.mergeImportedLibrary({
            library: [],
            playlists: [{ id: 'p2', name: 'Importée' }],
        });

        expect(manager.db.data.playlists).toEqual([{ id: 'p2', name: 'Importée', trackIds: [] }]);
    });
});

describe('DatabaseManager.updateTrack', () => {
    it('normalises an invalid crossfade duration before persisting a track update', async () => {
        const manager = createDatabaseManager({
            library: [{ id: 't1', title: 'Piste', crossfadeDurationPercent: 0.2 }],
            playlists: [],
            metadata: {},
        });

        await manager.updateTrack('t1', { crossfadeDurationPercent: 1 });

        expect(manager.db.data.library[0].crossfadeDurationPercent).toBe(0.1);
        expect(manager.db.write).toHaveBeenCalledOnce();
    });
});

describe('DatabaseManager.reorderPlaylistTracks', () => {
    it('applies a valid permutation of the existing trackIds', async () => {
        const manager = createDatabaseManager({
            library: [],
            playlists: [{ id: 'p1', name: 'Défaut', trackIds: ['a', 'b', 'c'] }],
            metadata: {},
        });

        const result = await manager.reorderPlaylistTracks('p1', ['c', 'a', 'b']);

        expect(result).toBe(true);
        expect(manager.db.data.playlists[0].trackIds).toEqual(['c', 'a', 'b']);
        expect(manager.db.write).toHaveBeenCalledOnce();
    });

    it('rejects an order that is not a permutation of the current trackIds and leaves them untouched', async () => {
        const manager = createDatabaseManager({
            library: [],
            playlists: [{ id: 'p1', name: 'Défaut', trackIds: ['a', 'b', 'c'] }],
            metadata: {},
        });

        const result = await manager.reorderPlaylistTracks('p1', ['a', 'b', 'z']);

        expect(result).toBe(false);
        expect(manager.db.data.playlists[0].trackIds).toEqual(['a', 'b', 'c']);
        expect(manager.db.write).not.toHaveBeenCalled();
    });

    it('returns false for an unknown playlist', async () => {
        const manager = createDatabaseManager({ library: [], playlists: [], metadata: {} });

        const result = await manager.reorderPlaylistTracks('missing', []);

        expect(result).toBe(false);
        expect(manager.db.write).not.toHaveBeenCalled();
    });
});

describe('DatabaseManager.removeVersionFromTrack', () => {
    function trackWithVersions(versions, extra = {}) {
        const paths = Object.fromEntries(versions.map(v => [v, `/music/${v}.mp3`]));
        return { id: 't1', title: 'Piste', originalPaths: { ...paths }, localPaths: { ...paths }, defaultVersion: versions[0], ...extra };
    }

    it('removes a non-default version and keeps the rest', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm', 'combat', 'tension'])], playlists: [], metadata: {} });

        const result = await manager.removeVersionFromTrack('t1', 'combat');
        const track = manager.db.data.library[0];

        expect(result).toBe(true);
        expect(track.localPaths).toEqual({ calm: '/music/calm.mp3', tension: '/music/tension.mp3' });
        expect(track.originalPaths).toEqual({ calm: '/music/calm.mp3', tension: '/music/tension.mp3' });
        expect(track.defaultVersion).toBe('calm');
    });

    it('resets defaultVersion to the first remaining version when the default is removed', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm', 'combat'])], playlists: [], metadata: {} });

        await manager.removeVersionFromTrack('t1', 'calm');
        const track = manager.db.data.library[0];

        expect(track.defaultVersion).toBe('combat');
    });

    it('refuses to remove the last remaining version', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm'])], playlists: [], metadata: {} });

        await expect(manager.removeVersionFromTrack('t1', 'calm')).rejects.toThrow();
        expect(manager.db.data.library[0].localPaths).toEqual({ calm: '/music/calm.mp3' });
        expect(manager.db.write).not.toHaveBeenCalled();
    });

    it('returns false for a version that does not exist on the track', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm', 'combat'])], playlists: [], metadata: {} });

        const result = await manager.removeVersionFromTrack('t1', 'inexistante');

        expect(result).toBe(false);
        expect(manager.db.write).not.toHaveBeenCalled();
    });
});

describe('DatabaseManager.reorderTrackVersions', () => {
    function trackWithVersions(versions) {
        const paths = Object.fromEntries(versions.map(v => [v, `/music/${v}.mp3`]));
        return { id: 't1', title: 'Piste', originalPaths: { ...paths }, localPaths: { ...paths }, defaultVersion: versions[0] };
    }

    it('applies a valid permutation, preserving each version path', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm', 'combat', 'tension'])], playlists: [], metadata: {} });

        const result = await manager.reorderTrackVersions('t1', ['tension', 'calm', 'combat']);
        const track = manager.db.data.library[0];

        expect(result).toBe(true);
        expect(Object.keys(track.localPaths)).toEqual(['tension', 'calm', 'combat']);
        expect(track.localPaths.combat).toBe('/music/combat.mp3');
    });

    it('rejects an order that is not a permutation of the current versions', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm', 'combat'])], playlists: [], metadata: {} });

        const result = await manager.reorderTrackVersions('t1', ['calm', 'inexistante']);

        expect(result).toBe(false);
        expect(Object.keys(manager.db.data.library[0].localPaths)).toEqual(['calm', 'combat']);
        expect(manager.db.write).not.toHaveBeenCalled();
    });
});
