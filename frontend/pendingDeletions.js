/**
 * Garde les éléments dont la suppression est encore annulable hors des
 * données affichées, même si un re-rendu recharge la DB entre-temps.
 */
export function createPendingDeletionStore() {
    const trackIds = new Set();
    const playlistIds = new Set();

    return {
        markTrack: id => trackIds.add(id),
        undoTrack: id => trackIds.delete(id),
        completeTrack: id => trackIds.delete(id),
        markPlaylist: id => playlistIds.add(id),
        undoPlaylist: id => playlistIds.delete(id),
        completePlaylist: id => playlistIds.delete(id),
        filterTracks: tracks => tracks.filter(track => !trackIds.has(track.id)),
        filterPlaylists: playlists => playlists.filter(playlist => !playlistIds.has(playlist.id)),
    };
}
