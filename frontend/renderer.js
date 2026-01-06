import { AudioManager } from '../backend/AudioManager.js';

// ========================================
// Initialisation
// ========================================

const audioManager = new AudioManager();
let currentPlaylistId = 'default';
let updateInterval = null;

async function init() {
    try {
        // Charger les réglages
        const settings = await window.electronAPI.getSettings();
        if (settings) {
            if (settings.volume !== undefined) {
                audioManager.setVolume(settings.volume);
                document.getElementById('volume').value = settings.volume * 100;
                document.getElementById('volume-value').textContent = `${Math.round(settings.volume * 100)}%`;
            }
            if (settings.lastVersion) {
                audioManager.currentVersion = settings.lastVersion;
            }
            if (settings.playMode) {
                audioManager.setPlayMode(settings.playMode);
                updateModeButtons(settings.playMode);
            }
        }

        // Charger les playlists
        await loadPlaylists();

        // Si une playlist par défaut existe, la charger
        if (currentPlaylistId) {
            await loadPlaylist(currentPlaylistId);
        }

        // Initialiser la bibliothèque
        await loadLibrary();

        console.log('✅ JukeBox DnD initialisé');
    } catch (error) {
        console.error('❌ Erreur initialisation:', error);
    }
}

// ========================================
// Gestion des Playlists
// ========================================

async function loadPlaylists() {
    const playlists = await window.electronAPI.getAllPlaylists();
    const select = document.getElementById('playlist-select');

    // Sauvegarder la sélection actuelle
    const currentSelection = select.value;

    select.innerHTML = '<option value="">-- Choisir une playlist --</option>';

    playlists.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `${p.name} (${p.trackIds.length} pistes)`;
        select.appendChild(option);
    });

    // Restaurer ou définir par défaut
    if (playlists.length > 0) {
        if (currentSelection && playlists.find(p => p.id === currentSelection)) {
            select.value = currentSelection;
        } else if (playlists.find(p => p.id === 'default')) {
            select.value = 'default';
            currentPlaylistId = 'default';
        } else {
            select.value = playlists[0].id;
            currentPlaylistId = playlists[0].id;
        }
    }
}

async function loadPlaylist(id) {
    if (!id) return;

    console.log(`Chargement playlist: ${id}`);
    const playlistData = await window.electronAPI.getPlaylistWithTracks(id);

    if (playlistData && playlistData.tracks) {
        // Convertir le format DB vers le format AudioManager
        const tracksConfig = playlistData.tracks.map(t => ({
            id: t.id,
            title: t.title,
            versions: t.localPaths || t.originalPaths, // Utiliser local si dispo
            defaultVersion: t.defaultVersion || 'calm'
        }));

        audioManager.loadPlaylist(tracksConfig);
        currentPlaylistId = id;

        updateUI();
        console.log(`✅ Playlist "${playlistData.name}" chargée`);
    } else {
        console.error("Playlist vide ou introuvable");
        document.getElementById('playlist-tracks').innerHTML = '<p class="empty-message">Playlist vide ou introuvable.</p>';
    }
}

// ========================================
// Gestion de la Bibliothèque
// ========================================

async function loadLibrary() {
    const library = await window.electronAPI.getLibrary();
    const container = document.getElementById('library-tracks');

    if (library.length === 0) {
        container.innerHTML = '<p class="empty-message">Bibliothèque vide. Cliquez sur "Ajouter une musique" pour commencer.</p>';
        return;
    }

    container.innerHTML = '';

    library.forEach(track => {
        const div = document.createElement('div');
        div.className = 'library-track';

        const versionsCount = Object.keys(track.localPaths || track.originalPaths || {}).length;
        const playlistsCount = track.inPlaylists ? track.inPlaylists.length : 0;

        div.innerHTML = `
            <div class="track-info-main">
                <span class="track-title">${track.title}</span>
                <span class="track-details">${versionsCount} version(s) • ${playlistsCount} playlist(s)</span>
            </div>
            <div class="track-actions">
                <button class="delete-track-btn danger-btn" data-id="${track.id}">🗑️</button>
            </div>
        `;

        // Event delete
        div.querySelector('.delete-track-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Supprimer "${track.title}" définitivement ?`)) {
                await window.electronAPI.deleteTrack(track.id);
                await loadLibrary(); // Recharger bibliothèque
                if (currentPlaylistId) await loadPlaylist(currentPlaylistId); // Recharger playlist active
            }
        });

        container.appendChild(div);
    });
}

// ========================================
// UI Updates
// ========================================

function updateStatus(status) {
    const el = document.getElementById('track-status');
    if (el) {
        el.textContent = status;
        el.className = 'status ' + status.toLowerCase().replace(' ', '-');
    }
}

function updateVersionDisplay(version) {
    const el = document.getElementById('current-version');
    if (el) el.textContent = version === 'calm' ? 'Calme' : (version === 'combat' ? 'Combat' : version);
}

function updateVersionButtons(currentTrack, currentVersion) {
    const container = document.getElementById('version-buttons');
    if (!container) return;

    container.innerHTML = '';

    // Track.getState() returns availableVersions, not versions
    const versions = currentTrack?.availableVersions || currentTrack?.versions;
    if (!currentTrack || !versions || versions.length === 0) {
        container.innerHTML = '<p class="empty-message">Aucune version disponible</p>';
        return;
    }

    versions.forEach(v => {
        const btn = document.createElement('button');
        btn.className = `version-btn ${v === currentVersion ? 'active' : ''}`;
        btn.dataset.version = v;

        // Icons for known versions
        let icon = '';
        let label = v.charAt(0).toUpperCase() + v.slice(1);
        if (v === 'calm') { icon = '🌙'; label = 'Calme'; }
        else if (v === 'tension') { icon = '⚡'; label = 'Tension'; }
        else if (v === 'combat') { icon = '⚔️'; label = 'Combat'; }

        btn.textContent = icon ? `${icon} ${label}` : label;

        btn.addEventListener('click', () => {
            handleVersionChange(v);
        });

        container.appendChild(btn);
    });
}

function handleVersionChange(targetVersion) {
    if (!audioManager.isPlaying()) {
        audioManager.currentVersion = targetVersion;
        const state = audioManager.getPlaylistState();
        updateVersionButtons(state.currentTrack, targetVersion);
        updateVersionDisplay(targetVersion);
        return;
    }

    const state = audioManager.getState();
    if (state.currentTrack && state.currentTrack.currentVersion !== targetVersion) {
        audioManager.crossfade(targetVersion, 2000);
        audioManager.currentVersion = targetVersion;

        // UI updates will happen via confirmation, but let's force visual feedback
        const btn = document.querySelector(`.version-btn[data-version="${targetVersion}"]`);
        if (btn) {
            document.querySelectorAll('.version-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
        updateVersionDisplay(targetVersion);
        showCrossfadeIndicator(2000);
    }
}

function updateModeButtons(mode) {
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
}

function updateProgress() {
    const currentTime = audioManager.getCurrentTime();
    const duration = audioManager.getDuration();

    document.getElementById('current-time').textContent = formatTime(currentTime);
    document.getElementById('duration').textContent = formatTime(duration);

    if (duration > 0) {
        const pct = (currentTime / duration) * 100;
        document.getElementById('progress-fill').style.width = `${pct}%`;
    }
}

function startProgressUpdate() {
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(updateProgress, 500);
}

function stopProgressUpdate() {
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = null;
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function showCrossfadeIndicator(duration) {
    const el = document.getElementById('crossfade-indicator');
    if (!el) {
        // Créer l'indicateur s'il n'existe pas dynamiquement (ou update index.html)
        // Pour l'instant, supposons qu'il est géré par CSS si présent
        return;
    }
    // ... code indicateur existant ...
}

function renderPlaylistUI() {
    const container = document.getElementById('playlist-tracks');
    if (!container) return;

    const state = audioManager.getPlaylistState();

    if (state.playlist.length === 0) {
        container.innerHTML = '<p class="empty-message">Aucune piste dans cette playlist.</p>';
        return;
    }

    container.innerHTML = '';

    state.playlist.forEach((track, index) => {
        const div = document.createElement('div');
        div.className = `playlist-track ${index === state.currentTrackIndex ? 'active' : ''}`;

        const isPlaying = index === state.currentTrackIndex && audioManager.isPlaying();

        div.innerHTML = `
            <span class="playlist-track-number">${index + 1}</span>
            <span class="playlist-track-title">${track.title}</span>
            <span class="playlist-track-icon">${isPlaying ? '▶️' : ''}</span>
        `;

        div.addEventListener('click', () => {
            audioManager.playTrackAtIndex(index);
            updateUI();
            startProgressUpdate();
        });

        container.appendChild(div);
    });
}

function updateUI() {
    const state = audioManager.getPlaylistState();

    // Titre piste
    const title = state.currentTrack?.name || 'Aucune piste';
    document.querySelector('.track-title').textContent = title;
    document.querySelector('.track-number').textContent = `Piste ${state.currentTrackIndex + 1}/${state.totalTracks}`;

    // Versions
    updateVersionButtons(state.currentTrack, state.currentVersion);
    updateVersionDisplay(state.currentVersion);

    // Playlist
    renderPlaylistUI();

    // Status
    if (audioManager.isPlaying()) updateStatus('En lecture');
}

// ========================================
// DOM Ready
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    init();

    // --- Tab Switching ---
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));

            btn.classList.add('active');
            const viewId = btn.dataset.view + '-view';
            document.getElementById(viewId).classList.remove('hidden');
        });
    });

    // --- Playlist Select ---
    document.getElementById('playlist-select').addEventListener('change', (e) => {
        const id = e.target.value;
        if (id) loadPlaylist(id);
    });

    // --- Player Controls ---
    document.getElementById('play-btn').addEventListener('click', () => {
        if (!audioManager.currentTrack) audioManager.playTrackAtIndex(0);
        else if (!audioManager.isPlaying()) audioManager.resume();
        updateUI();
        startProgressUpdate();
    });

    document.getElementById('pause-btn').addEventListener('click', () => {
        if (audioManager.isPlaying()) {
            audioManager.pause();
            stopProgressUpdate();
            updateUI();
        } else {
            audioManager.resume();
            startProgressUpdate();
            updateUI();
        }
    });

    document.getElementById('stop-btn').addEventListener('click', () => {
        audioManager.stop();
        stopProgressUpdate();
        updateUI();
    });

    document.getElementById('next-btn').addEventListener('click', () => {
        audioManager.nextTrack();
        updateUI();
        if (audioManager.isPlaying()) startProgressUpdate();
    });

    document.getElementById('prev-btn').addEventListener('click', () => {
        audioManager.previousTrack();
        updateUI();
        if (audioManager.isPlaying()) startProgressUpdate();
    });

    // --- Mode Buttons ---
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            audioManager.setPlayMode(mode);
            updateModeButtons(mode);
            // Save settings
            window.electronAPI.saveSettings({ playMode: mode });
        });
    });

    // --- Progress Bar Seek ---
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
        progressContainer.addEventListener('click', (e) => {
            const duration = audioManager.getDuration();
            if (duration > 0) {
                const rect = progressContainer.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const percentage = clickX / rect.width;
                const seekPosition = percentage * duration;
                audioManager.seek(seekPosition);
                updateProgress();
            }
        });

        // Add cursor pointer style
        progressContainer.style.cursor = 'pointer';
    }

    // --- Volume ---
    document.getElementById('volume').addEventListener('input', (e) => {
        const val = e.target.value / 100;
        audioManager.setVolume(val);
        document.getElementById('volume-value').textContent = `${e.target.value}%`;
        window.electronAPI.saveSettings({ volume: val });
    });

    // ========================================
    // MODAL: AJOUTER PISTE
    // ========================================

    const addTrackModal = document.getElementById('add-track-modal');

    document.getElementById('add-track-btn').addEventListener('click', async () => {
        // Reset form
        document.getElementById('new-track-title').value = '';
        document.getElementById('version-inputs').innerHTML = `
            <div class="version-input" data-index="0">
                <input type="text" class="version-name" placeholder="Nom" value="calm" />
                <button type="button" class="select-file-btn">📁 Fichier</button>
                <span class="file-path">Aucun fichier</span>
                <input type="hidden" class="file-path-value" />
                <button type="button" class="remove-version-btn danger-btn-small">✕</button>
            </div>
        `;
        setupVersionInputsListeners();

        // Load playlists checkboxes
        const playlists = await window.electronAPI.getAllPlaylists();
        const container = document.getElementById('playlist-checkboxes');
        container.innerHTML = playlists.map(p => `
            <label class="checkbox-label">
                <input type="checkbox" value="${p.id}" ${p.id === currentPlaylistId ? 'checked' : ''} />
                <span>${p.name}</span>
            </label>
        `).join('');

        addTrackModal.classList.remove('hidden');
    });

    // Close Modals
    document.querySelectorAll('.close-modal-btn, #cancel-add-track, .cancel-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
        });
    });

    // Add version row
    document.getElementById('add-version-input-btn').addEventListener('click', () => {
        const container = document.getElementById('version-inputs');
        const index = container.children.length;
        const div = document.createElement('div');
        div.className = 'version-input';
        div.dataset.index = index;
        div.innerHTML = `
            <input type="text" class="version-name" placeholder="Nom (combat...)" />
            <button type="button" class="select-file-btn">📁 Fichier</button>
            <span class="file-path">Aucun fichier</span>
            <input type="hidden" class="file-path-value" />
            <button type="button" class="remove-version-btn danger-btn-small">✕</button>
        `;
        container.appendChild(div);
        setupVersionInputsListeners();
    });

    function setupVersionInputsListeners() {
        // File selection
        document.querySelectorAll('.select-file-btn').forEach(btn => {
            // Remove old listener hack by cloning (simple way)
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);

            newBtn.addEventListener('click', async (e) => {
                const files = await window.electronAPI.openFiles();
                if (files && files.length > 0) {
                    const parent = e.target.closest('.version-input');
                    const fileName = files[0].split('/').pop();

                    // Update file path display with success indicator
                    const filePathSpan = parent.querySelector('.file-path');
                    filePathSpan.textContent = `✅ ${fileName}`;
                    filePathSpan.classList.add('file-loaded');

                    // Store the path
                    parent.querySelector('.file-path-value').value = files[0];

                    // Visual feedback on the parent container
                    parent.classList.add('has-file');

                    // Update button text
                    e.target.textContent = '📁 Modifier';
                }
            });
        });

        // Remove row
        document.querySelectorAll('.remove-version-btn').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', (e) => {
                const inputs = document.getElementById('version-inputs');
                if (inputs.children.length > 1) {
                    e.target.closest('.version-input').remove();
                }
            });
        });
    }

    // Confirm Add Track
    document.getElementById('confirm-add-track').addEventListener('click', async () => {
        const title = document.getElementById('new-track-title').value;
        if (!title) {
            alert('Le titre est requis');
            return;
        }

        const versions = {};
        let hasVersion = false;
        document.querySelectorAll('.version-input').forEach(div => {
            const name = div.querySelector('.version-name').value.trim().toLowerCase();
            const path = div.querySelector('.file-path-value').value;
            if (name && path) {
                versions[name] = path;
                hasVersion = true;
            }
        });

        if (!hasVersion) {
            alert('Ajoutez au moins une version avec un fichier');
            return;
        }

        const selectedPlaylists = Array.from(document.querySelectorAll('#playlist-checkboxes input:checked')).map(cb => cb.value);
        const volume = document.getElementById('new-track-volume').value / 100;

        const trackData = {
            title,
            versions,
            defaultVersion: Object.keys(versions)[0],
            defaultVolume: volume
        };

        try {
            document.getElementById('confirm-add-track').textContent = 'Ajout...';
            await window.electronAPI.addTrack(trackData, selectedPlaylists);

            addTrackModal.classList.add('hidden');
            document.getElementById('confirm-add-track').textContent = 'Ajouter la piste';

            // Reload UI
            await loadLibrary();
            if (currentPlaylistId && selectedPlaylists.includes(currentPlaylistId)) {
                await loadPlaylist(currentPlaylistId);
            }
        } catch (err) {
            console.error(err);
            alert("Erreur lors de l'ajout");
            document.getElementById('confirm-add-track').textContent = 'Ajouter la piste';
        }
    });

    // ========================================
    // MODAL: CRÉER PLAYLIST
    // ========================================

    const createPlaylistModal = document.getElementById('create-playlist-modal');

    // Button from Player view
    document.getElementById('create-playlist-btn').addEventListener('click', () => {
        createPlaylistModal.classList.remove('hidden');
    });

    // Inline button from Add Track view
    document.getElementById('create-playlist-inline-btn').addEventListener('click', async () => {
        const name = document.getElementById('new-playlist-name').value;
        if (name) {
            const playlist = await window.electronAPI.createPlaylist(name);

            // Refresh checkboxes in the modal
            const container = document.getElementById('playlist-checkboxes');
            const label = document.createElement('label');
            label.className = 'checkbox-label';
            label.innerHTML = `<input type="checkbox" value="${playlist.id}" checked /> <span>${playlist.name}</span>`;
            container.appendChild(label);
            document.getElementById('new-playlist-name').value = '';

            // Also refresh the main playlist dropdown
            await loadPlaylists();
        }
    });

    document.getElementById('confirm-create-playlist').addEventListener('click', async () => {
        const name = document.getElementById('playlist-name-input').value;
        if (name) {
            const playlist = await window.electronAPI.createPlaylist(name);
            await loadPlaylists();
            document.getElementById('playlist-select').value = playlist.id;
            loadPlaylist(playlist.id); // Switch to new
            createPlaylistModal.classList.add('hidden');
        }
    });

    // Delete Playlist
    document.getElementById('delete-playlist-btn').addEventListener('click', async () => {
        const playlistId = document.getElementById('playlist-select').value;
        if (!playlistId) return;

        if (confirm('Voulez-vous vraiment supprimer cette playlist ?')) {
            await window.electronAPI.deletePlaylist(playlistId);
            currentPlaylistId = null;
            await loadPlaylists();

            // Si plus de playlist, vider l'UI
            if (document.getElementById('playlist-select').options.length <= 1) { // Juste l'option par défaut
                document.getElementById('playlist-tracks').innerHTML = '<p class="empty-message">Aucune playlist.</p>';
                audioManager.stop();
                updateUI();
            }
        }
    });
});
