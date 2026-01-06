const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { pathToFileURL } = require('url');

// Import du DatabaseManager et FileManager (ESM modules)
let dbManager;
let fileManager;

let mainWindow;

async function initManagers() {
    // Import dynamique des modules ESM - use file:// URLs for asar compatibility
    const dbManagerPath = pathToFileURL(path.join(__dirname, '..', 'backend', 'DatabaseManager.js')).href;
    const fileManagerPath = pathToFileURL(path.join(__dirname, '..', 'backend', 'FileManager.js')).href;

    const { DatabaseManager } = await import(dbManagerPath);
    const { FileManager } = await import(fileManagerPath);

    // Initialiser avec le userData path d'Electron
    const userDataPath = app.getPath('userData');

    dbManager = new DatabaseManager(userDataPath);
    await dbManager.init();

    fileManager = new FileManager(userDataPath);
    await fileManager.init();

    console.log('✅ Database et FileManager initialisés');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 950,
        icon: path.join(__dirname, '..', 'build', 'icon.png'),
        autoHideMenuBar: true, // Hide the menu bar
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            // Allow loading local audio files from file:// URLs
            webSecurity: false,
        },
    });

    // Remove the menu bar completely
    mainWindow.setMenu(null);

    // En développement, charger depuis Vite
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ========================================
// IPC HANDLERS - Dialogues
// ========================================

ipcMain.handle('dialog:openFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'] }
        ],
        title: 'Sélectionner des fichiers audio'
    });

    if (result.canceled) return [];

    console.log(`📁 ${result.filePaths.length} fichiers sélectionnés`);
    return result.filePaths;
});

ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Sélectionner un dossier de musique'
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    console.log(`📂 Dossier sélectionné: ${result.filePaths[0]}`);
    return result.filePaths[0];
});

ipcMain.handle('dialog:scanFolder', async (event, folderPath) => {
    try {
        const files = await fs.readdir(folderPath);
        const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];

        const audioFiles = files
            .filter(file => audioExtensions.includes(path.extname(file).toLowerCase()))
            .map(file => path.join(folderPath, file));

        console.log(`🎵 ${audioFiles.length} fichiers audio trouvés`);
        return audioFiles;
    } catch (error) {
        console.error('❌ Erreur scan dossier:', error);
        return [];
    }
});

// ========================================
// IPC HANDLERS - Library
// ========================================

ipcMain.handle('library:addTrack', async (event, trackData, selectedPlaylists) => {
    try {
        const trackId = fileManager.generateTrackId();

        // Copier les fichiers audio vers userData/music
        const localPaths = {};
        for (const [versionName, sourcePath] of Object.entries(trackData.versions)) {
            localPaths[versionName] = await fileManager.copyAudioFile(
                sourcePath,
                trackId,
                versionName
            );
        }

        // Créer l'objet track
        const track = {
            id: trackId,
            title: trackData.title,
            originalPaths: trackData.versions,
            localPaths: localPaths,
            defaultVersion: trackData.defaultVersion || 'calm',
            defaultVolume: trackData.defaultVolume || 0.5,
            metadata: {
                addedAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            },
            inPlaylists: selectedPlaylists || []
        };

        // Ajouter à la bibliothèque
        await dbManager.addTrackToLibrary(track);

        // Ajouter aux playlists
        for (const playlistId of selectedPlaylists) {
            await dbManager.addTrackIdToPlaylist(playlistId, trackId);
        }

        console.log(`✅ Piste "${track.title}" ajoutée`);
        return track;
    } catch (error) {
        console.error('❌ Erreur addTrack:', error);
        throw error;
    }
});

ipcMain.handle('library:getLibrary', async () => {
    try {
        return await dbManager.getLibrary();
    } catch (error) {
        console.error('❌ Erreur getLibrary:', error);
        return [];
    }
});

ipcMain.handle('library:getTrack', async (event, trackId) => {
    try {
        return await dbManager.getTrack(trackId);
    } catch (error) {
        console.error('❌ Erreur getTrack:', error);
        return null;
    }
});

ipcMain.handle('library:updateTrack', async (event, trackId, updates) => {
    try {
        return await dbManager.updateTrack(trackId, updates);
    } catch (error) {
        console.error('❌ Erreur updateTrack:', error);
        throw error;
    }
});

ipcMain.handle('library:deleteTrack', async (event, trackId) => {
    try {
        const track = await dbManager.getTrack(trackId);

        // Supprimer les fichiers
        await fileManager.deleteTrackFiles(track);

        // Supprimer de la DB
        return await dbManager.deleteTrack(trackId);
    } catch (error) {
        console.error('❌ Erreur deleteTrack:', error);
        throw error;
    }
});

ipcMain.handle('library:addVersion', async (event, trackId, versionName, filePath) => {
    try {
        // Copier le fichier
        const localPath = await fileManager.copyAudioFile(filePath, trackId, versionName);

        // Mettre à jour la DB
        return await dbManager.addVersionToTrack(trackId, versionName, filePath, localPath);
    } catch (error) {
        console.error('❌ Erreur addVersion:', error);
        throw error;
    }
});

// ========================================
// IPC HANDLERS - Playlists
// ========================================

ipcMain.handle('playlist:getAll', async () => {
    try {
        return await dbManager.getPlaylists();
    } catch (error) {
        console.error('❌ Erreur getPlaylists:', error);
        return [];
    }
});

ipcMain.handle('playlist:get', async (event, id) => {
    try {
        return await dbManager.getPlaylist(id);
    } catch (error) {
        console.error('❌ Erreur getPlaylist:', error);
        return null;
    }
});

ipcMain.handle('playlist:getWithTracks', async (event, id) => {
    try {
        return await dbManager.getPlaylistWithTracks(id);
    } catch (error) {
        console.error('❌ Erreur getPlaylistWithTracks:', error);
        return null;
    }
});

ipcMain.handle('playlist:save', async (event, playlist) => {
    try {
        return await dbManager.savePlaylist(playlist);
    } catch (error) {
        console.error('❌ Erreur savePlaylist:', error);
        throw error;
    }
});

ipcMain.handle('playlist:create', async (event, playlistName) => {
    try {
        const playlist = {
            id: fileManager.generatePlaylistId(),
            name: playlistName,
            trackIds: [],
            createdAt: new Date().toISOString()
        };

        return await dbManager.savePlaylist(playlist);
    } catch (error) {
        console.error('❌ Erreur createPlaylist:', error);
        throw error;
    }
});

ipcMain.handle('playlist:delete', async (event, id) => {
    try {
        return await dbManager.deletePlaylist(id);
    } catch (error) {
        console.error('❌ Erreur deletePlaylist:', error);
        return false;
    }
});

ipcMain.handle('playlist:addTrack', async (event, playlistId, trackId) => {
    try {
        return await dbManager.addTrackIdToPlaylist(playlistId, trackId);
    } catch (error) {
        console.error('❌ Erreur addTrackToPlaylist:', error);
        throw error;
    }
});

ipcMain.handle('playlist:removeTrack', async (event, playlistId, trackId) => {
    try {
        return await dbManager.removeTrackIdFromPlaylist(playlistId, trackId);
    } catch (error) {
        console.error('❌ Erreur removeTrackFromPlaylist:', error);
        return false;
    }
});

// ========================================
// IPC HANDLERS - Settings
// ========================================

ipcMain.handle('settings:save', async (event, settings) => {
    try {
        return await dbManager.saveSettings(settings);
    } catch (error) {
        console.error('❌ Erreur saveSettings:', error);
        throw error;
    }
});

ipcMain.handle('settings:get', async () => {
    try {
        return await dbManager.getSettings();
    } catch (error) {
        console.error('❌ Erreur getSettings:', error);
        return null;
    }
});

// ========================================
// Lifecycle de l'app
// ========================================

app.whenReady().then(async () => {
    await initManagers();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
