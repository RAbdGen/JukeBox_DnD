const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose des APIs sécurisées au renderer process
 * Architecture v2.0 avec bibliothèque musicale complète
 */
contextBridge.exposeInMainWorld('electronAPI', {
    // ========================================
    // DIALOGUES
    // ========================================

    openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    scanFolder: (folderPath) => ipcRenderer.invoke('dialog:scanFolder', folderPath),

    // ========================================
    // LIBRARY (Bibliothèque)
    // ========================================

    /**
     * Ajouter une piste à la bibliothèque
     * @param {Object} trackData - {title, versions: {calm: path, combat: path}, defaultVersion, defaultVolume}
     * @param {Array<string>} selectedPlaylists - IDs des playlists
     */
    addTrack: (trackData, selectedPlaylists) =>
        ipcRenderer.invoke('library:addTrack', trackData, selectedPlaylists),

    getLibrary: () => ipcRenderer.invoke('library:getLibrary'),
    getTrack: (trackId) => ipcRenderer.invoke('library:getTrack', trackId),
    updateTrack: (trackId, updates) => ipcRenderer.invoke('library:updateTrack', trackId, updates),
    deleteTrack: (trackId) => ipcRenderer.invoke('library:deleteTrack', trackId),
    addVersion: (trackId, versionName, filePath) =>
        ipcRenderer.invoke('library:addVersion', trackId, versionName, filePath),

    // ========================================
    // PLAYLISTS
    // ========================================

    getAllPlaylists: () => ipcRenderer.invoke('playlist:getAll'),
    getPlaylist: (id) => ipcRenderer.invoke('playlist:get', id),
    getPlaylistWithTracks: (id) => ipcRenderer.invoke('playlist:getWithTracks', id),
    savePlaylist: (playlist) => ipcRenderer.invoke('playlist:save', playlist),
    createPlaylist: (name) => ipcRenderer.invoke('playlist:create', name),
    deletePlaylist: (id) => ipcRenderer.invoke('playlist:delete', id),
    addTrackToPlaylist: (playlistId, trackId) =>
        ipcRenderer.invoke('playlist:addTrack', playlistId, trackId),
    removeTrackFromPlaylist: (playlistId, trackId) =>
        ipcRenderer.invoke('playlist:removeTrack', playlistId, trackId),

    // ========================================
    // SETTINGS
    // ========================================

    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    getSettings: () => ipcRenderer.invoke('settings:get'),
});

console.log('✅ Preload script chargé - electronAPI v2.0 exposée');
