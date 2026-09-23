import { describe, expect, it, vi } from 'vitest';
import { DatabaseManager } from '../backend/DatabaseManager.js';

function createDatabaseManager(data) {
    const manager = new DatabaseManager();
    manager.db = { data, write: vi.fn().mockResolvedValue() };
    return manager;
}

describe('DatabaseManager.mergeImportedLibrary', () => {
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
