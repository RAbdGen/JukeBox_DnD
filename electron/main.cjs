const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { pathToFileURL } = require('url');


let dbManager;
let fileManager;
let mainWindow;

// Resolves once initManagers() completes — IPC handlers await this before touching managers
let managersReadyResolve;
const managersReadyPromise = new Promise(resolve => { managersReadyResolve = resolve; });

// Wrapper : enregistre un IPC handler qui attend que les managers soient prêts
function ipcHandle(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
        await managersReadyPromise;
        return handler(event, ...args);
    });
}

async function initManagers() {
    const dbManagerPath = pathToFileURL(path.join(__dirname, '..', 'backend', 'DatabaseManager.js')).href;
    const fileManagerPath = pathToFileURL(path.join(__dirname, '..', 'backend', 'FileManager.js')).href;

    const { DatabaseManager } = await import(dbManagerPath);
    const { FileManager } = await import(fileManagerPath);

    const userDataPath = app.getPath('userData');

    dbManager = new DatabaseManager(userDataPath);
    await dbManager.init();

    fileManager = new FileManager(userDataPath);
    await fileManager.init();

    console.log('✅ Database et FileManager initialisés');
    managersReadyResolve();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 950,
        show: false, // Affiché seulement via ready-to-show, évite le flash blanc
        icon: path.join(__dirname, '..', 'build', 'icon.png'),
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,
            backgroundThrottling: false, // Pas de throttling quand l'app est en arrière-plan
        },
    });

    mainWindow.setMenu(null);

    // Afficher la fenêtre seulement quand le renderer a fini son premier paint
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:3000');
        // DevTools : ouvrir manuellement avec F12 ou Ctrl+Shift+I
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ========================================
// IPC HANDLERS - Dialogues (pas besoin des managers)
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

ipcHandle('library:addTrack', async (event, trackData, selectedPlaylists) => {
    try {
        const trackId = fileManager.generateTrackId();

        // Copier les fichiers audio en parallèle
        const copiedPairs = await Promise.all(
            Object.entries(trackData.versions).map(async ([versionName, sourcePath]) => {
                const localPath = await fileManager.copyAudioFile(sourcePath, trackId, versionName);
                return [versionName, localPath];
            })
        );
        const localPaths = Object.fromEntries(copiedPairs);

        const track = {
            id: trackId,
            title: trackData.title,
            originalPaths: trackData.versions,
            localPaths,
            defaultVersion: trackData.defaultVersion || 'calm',
            defaultVolume: trackData.defaultVolume || 0.5,
            metadata: {
                addedAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            },
            inPlaylists: selectedPlaylists || []
        };

        await dbManager.addTrackToLibrary(track);

        // Ajouter à toutes les playlists en parallèle
        await Promise.all(
            selectedPlaylists.map(playlistId => dbManager.addTrackIdToPlaylist(playlistId, trackId))
        );

        console.log(`✅ Piste "${track.title}" ajoutée`);
        return track;
    } catch (error) {
        console.error('❌ Erreur addTrack:', error);
        throw error;
    }
});

ipcHandle('library:getLibrary', async () => {
    try {
        return await dbManager.getLibrary();
    } catch (error) {
        console.error('❌ Erreur getLibrary:', error);
        return [];
    }
});

ipcHandle('library:getTrack', async (event, trackId) => {
    try {
        return await dbManager.getTrack(trackId);
    } catch (error) {
        console.error('❌ Erreur getTrack:', error);
        return null;
    }
});

ipcHandle('library:updateTrack', async (event, trackId, updates) => {
    try {
        return await dbManager.updateTrack(trackId, updates);
    } catch (error) {
        console.error('❌ Erreur updateTrack:', error);
        throw error;
    }
});

ipcHandle('library:deleteTrack', async (event, trackId) => {
    try {
        const track = await dbManager.getTrack(trackId);
        await fileManager.deleteTrackFiles(track);
        return await dbManager.deleteTrack(trackId);
    } catch (error) {
        console.error('❌ Erreur deleteTrack:', error);
        throw error;
    }
});

ipcHandle('library:addVersion', async (event, trackId, versionName, filePath) => {
    try {
        const localPath = await fileManager.copyAudioFile(filePath, trackId, versionName);
        return await dbManager.addVersionToTrack(trackId, versionName, filePath, localPath);
    } catch (error) {
        console.error('❌ Erreur addVersion:', error);
        throw error;
    }
});

// ========================================
// IPC HANDLERS - Playlists
// ========================================

ipcHandle('playlist:getAll', async () => {
    try {
        return await dbManager.getPlaylists();
    } catch (error) {
        console.error('❌ Erreur getPlaylists:', error);
        return [];
    }
});

ipcHandle('playlist:get', async (event, id) => {
    try {
        return await dbManager.getPlaylist(id);
    } catch (error) {
        console.error('❌ Erreur getPlaylist:', error);
        return null;
    }
});

ipcHandle('playlist:getWithTracks', async (event, id) => {
    try {
        return await dbManager.getPlaylistWithTracks(id);
    } catch (error) {
        console.error('❌ Erreur getPlaylistWithTracks:', error);
        return null;
    }
});

ipcHandle('playlist:save', async (event, playlist) => {
    try {
        return await dbManager.savePlaylist(playlist);
    } catch (error) {
        console.error('❌ Erreur savePlaylist:', error);
        throw error;
    }
});

ipcHandle('playlist:create', async (event, playlistName) => {
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

ipcHandle('playlist:delete', async (event, id) => {
    try {
        return await dbManager.deletePlaylist(id);
    } catch (error) {
        console.error('❌ Erreur deletePlaylist:', error);
        return false;
    }
});

ipcHandle('playlist:addTrack', async (event, playlistId, trackId) => {
    try {
        return await dbManager.addTrackIdToPlaylist(playlistId, trackId);
    } catch (error) {
        console.error('❌ Erreur addTrackToPlaylist:', error);
        throw error;
    }
});

ipcHandle('playlist:removeTrack', async (event, playlistId, trackId) => {
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

ipcHandle('settings:save', async (event, settings) => {
    try {
        return await dbManager.saveSettings(settings);
    } catch (error) {
        console.error('❌ Erreur saveSettings:', error);
        throw error;
    }
});

ipcHandle('settings:get', async () => {
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

app.whenReady().then(() => {
    // Lancer la fenêtre et l'init des managers en parallèle.
    // La fenêtre commence à charger immédiatement ; les IPC handlers
    // attendent managersReadyPromise avant d'exécuter.
    createWindow();
    initManagers();
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
