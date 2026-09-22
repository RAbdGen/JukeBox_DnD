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
