import { describe, expect, it, vi } from 'vitest';
import { importLibraryPayload } from '../backend/ImportManager.js';

describe('importLibraryPayload', () => {
    it('does not copy files for tracks that already exist locally', async () => {
        const dbManager = {
            getLibrary: vi.fn().mockResolvedValue([{ id: 'existing' }]),
            mergeImportedLibrary: vi.fn().mockResolvedValue({ tracksAdded: 1, tracksSkipped: 1 }),
        };
        const fileManager = {
            importTrackFiles: vi.fn().mockResolvedValue({ calm: '/local/new.mp3' }),
        };

        await importLibraryPayload({
            library: [
                { id: 'existing', localPaths: { calm: 'existing_calm.mp3' } },
                { id: 'new', localPaths: { calm: 'new_calm.mp3' } },
            ],
            playlists: [],
        }, '/export/music', dbManager, fileManager);

        expect(fileManager.importTrackFiles).toHaveBeenCalledTimes(1);
        expect(fileManager.importTrackFiles).toHaveBeenCalledWith(
            { calm: 'new_calm.mp3' },
            '/export/music',
        );
        expect(dbManager.mergeImportedLibrary).toHaveBeenCalledWith({
            library: [
                { id: 'existing', localPaths: { calm: 'existing_calm.mp3' } },
                { id: 'new', localPaths: { calm: '/local/new.mp3' } },
            ],
            playlists: [],
        });
    });
});
