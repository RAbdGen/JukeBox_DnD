const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { pathToFileURL } = require('url');

// Fige le dossier userData sur le nom stable de package.json ("jukebox"),
// indépendamment de productName/branding (#21 — "JukeBox DnD" → "Jukebox
// JDR"). Sans ça, app.getPath('userData') dépend implicitement du nom de
// l'app à l'exécution : un futur changement de branding pourrait décaler
// data.json/music/ vers un nouveau dossier et faire "perdre" la
// bibliothèque de l'utilisateur au prochain lancement.
app.setPath('userData', path.join(app.getPath('appData'), 'jukebox'));

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
// Raccourcis clavier globaux (fonctionnent même sans focus sur la fenêtre)
// ========================================

function registerGlobalShortcuts() {
    const send = (action) => {
        if (mainWindow) mainWindow.webContents.send('shortcut:trigger', action);
    };

    // Pas de touche média standard pour "mute" → combinaison custom
    const shortcuts = {
        'MediaPlayPause': () => send('play-pause'),
        'MediaNextTrack': () => send('next'),
        'MediaPreviousTrack': () => send('previous'),
        'CommandOrControl+Alt+M': () => send('mute'),
    };

    for (const [accelerator, handler] of Object.entries(shortcuts)) {
        const registered = globalShortcut.register(accelerator, handler);
        if (!registered) {
            console.warn(`⚠️ Impossible d'enregistrer le raccourci "${accelerator}" (déjà pris par une autre application ?)`);
        }
    }
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
            defaultVolume: trackData.defaultVolume ?? 0.5,
            crossfadeDurationPercent: trackData.crossfadeDurationPercent ?? 0.1,
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

ipcHandle('library:removeVersion', async (event, trackId, versionName) => {
    try {
        const track = await dbManager.getTrack(trackId);
        const localPath = track?.localPaths?.[versionName];
        const removed = await dbManager.removeVersionFromTrack(trackId, versionName);
        if (removed && localPath) {
            await fileManager.deleteAudioFile(localPath);
        }
        return removed;
    } catch (error) {
        console.error('❌ Erreur removeVersion:', error);
        throw error;
    }
});

ipcHandle('library:reorderVersions', async (event, trackId, orderedVersionNames) => {
    try {
        return await dbManager.reorderTrackVersions(trackId, orderedVersionNames);
    } catch (error) {
        console.error('❌ Erreur reorderVersions:', error);
        return false;
    }
});

// Export : dossier destination → jukebox-export.json + music/ (copie des
// fichiers avec des chemins relatifs, portables entre machines/OS)
ipcHandle('library:exportLibrary', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: "Choisir le dossier de destination de l'export",
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    try {
        const destDir = result.filePaths[0];
        const musicDir = path.join(destDir, 'music');
        await fs.mkdir(musicDir, { recursive: true });

        const rawLibrary = await dbManager.getLibrary();
        const exportTracks = [];
        for (const track of rawLibrary) {
            const relativePaths = await fileManager.exportTrackFiles(track, musicDir);
            exportTracks.push({ ...track, localPaths: relativePaths });
        }

        const playlists = await dbManager.getPlaylists();
        const exportPayload = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            library: exportTracks,
            playlists,
        };

        await fs.writeFile(
            path.join(destDir, 'jukebox-export.json'),
            JSON.stringify(exportPayload, null, 2),
            'utf-8'
        );

        console.log(`✅ Export terminé : ${exportTracks.length} piste(s) → ${destDir}`);
        return { path: destDir, trackCount: exportTracks.length, playlistCount: playlists.length };
    } catch (error) {
        console.error('❌ Erreur exportLibrary:', error);
        throw error;
    }
});

// Import : dossier exporté (jukebox-export.json + music/) → fusion dans
// la DB locale, sans jamais rien remplacer (voir mergeImportedLibrary)
ipcHandle('library:importLibrary', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Choisir le dossier exporté à importer',
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    try {
        const sourceDir = result.filePaths[0];
        const jsonPath = path.join(sourceDir, 'jukebox-export.json');
        const musicDir = path.join(sourceDir, 'music');

        const raw = await fs.readFile(jsonPath, 'utf-8');
        const importPayload = JSON.parse(raw);

        const importManagerPath = pathToFileURL(path.join(__dirname, '..', 'backend', 'ImportManager.js')).href;
        const { importLibraryPayload } = await import(importManagerPath);
        const stats = await importLibraryPayload(importPayload, musicDir, dbManager, fileManager);

        console.log(`✅ Import terminé depuis ${sourceDir}`);
        return stats;
    } catch (error) {
        console.error('❌ Erreur importLibrary:', error);
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

ipcHandle('playlist:reorderTracks', async (event, playlistId, orderedTrackIds) => {
    try {
        return await dbManager.reorderPlaylistTracks(playlistId, orderedTrackIds);
    } catch (error) {
        console.error('❌ Erreur reorderPlaylistTracks:', error);
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
    registerGlobalShortcuts();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
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
