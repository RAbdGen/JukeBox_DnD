import { describe, expect, it } from 'vitest';
import { createPendingDeletionStore } from '../frontend/pendingDeletions.js';

describe('createPendingDeletionStore', () => {
    it('hides a pending track during re-renders and restores it after undo', () => {
        const pending = createPendingDeletionStore();
        pending.markTrack('track-1');

        expect(pending.filterTracks([{ id: 'track-1' }, { id: 'track-2' }]))
            .toEqual([{ id: 'track-2' }]);

        pending.undoTrack('track-1');

        expect(pending.filterTracks([{ id: 'track-1' }])).toEqual([{ id: 'track-1' }]);
    });

    it('hides a pending playlist during re-renders and removes its pending state after deletion', () => {
        const pending = createPendingDeletionStore();
        pending.markPlaylist('playlist-1');

        expect(pending.filterPlaylists([{ id: 'playlist-1' }, { id: 'playlist-2' }]))
            .toEqual([{ id: 'playlist-2' }]);

        pending.completePlaylist('playlist-1');

        expect(pending.filterPlaylists([{ id: 'playlist-1' }])).toEqual([{ id: 'playlist-1' }]);
    });
});
