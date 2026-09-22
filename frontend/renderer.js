import { Howl } from 'howler';
import { AudioManager } from '../backend/AudioManager.js';
import { createPendingDeletionStore } from './pendingDeletions.js';
import { createPreviewState } from './previewState.js';
import { getPreviewVolume } from './trackVolume.js';

// ========================================
// Initialisation
// ========================================

const audioManager = new AudioManager();
let currentPlaylistId = 'default';
let updateInterval = null;
let volumeBeforeMute = null; // volume mémorisé pour le mute rapide (raccourci clavier) ; null = pas muté
let libraryCache = []; // dernière bibliothèque chargée, pour filtrer la recherche sans re-fetch IPC
let previewHowl = null; // Howl dédié au preview au survol (séparé de audioManager, n'interfère pas avec la lecture en cours)
const pendingDeletions = createPendingDeletionStore();

// ========================================
// Toast — Undo suppression
// ========================================

/**
 * Affiche un toast avec bouton "Annuler". Si le délai expire sans clic sur
 * Annuler, onExpire() est appelé (la suppression réelle a lieu là). Si
 * Annuler est cliqué avant, onUndo() est appelé à la place et onExpire()
 * n'a jamais lieu.
 */
function showUndoToast(message, { duration = 7000, onExpire, onUndo } = {}) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <span class="toast-message"></span>
        <button type="button" class="toast-undo-btn">Annuler</button>
        <div class="toast-progress" style="animation-duration: ${duration}ms"></div>
    `;
    toast.querySelector('.toast-message').textContent = message; // évite l'injection HTML via un titre de piste/playlist

    let settled = false;

    const remove = () => {
        toast.classList.add('toast-leaving');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        remove();
        if (onExpire) onExpire();
    }, duration);

    toast.querySelector('.toast-undo-btn').addEventListener('click', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        remove();
        if (onUndo) onUndo();
    });

    container.appendChild(toast);
}

function applyTheme(theme) {
    const t = theme || 'nuit';
    document.documentElement.dataset.theme = t === 'nuit' ? '' : t;
    document.querySelectorAll('.theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.theme === t);
    });
}

async function init() {
    try {
        // Charger settings et playlists en parallèle
        const [settings, playlists] = await Promise.all([
            window.electronAPI.getSettings(),
            window.electronAPI.getAllPlaylists(),
        ]);

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
            if (settings.lastPlaylistId) {
                currentPlaylistId = settings.lastPlaylistId;
            }
            if (settings.theme) {
                applyTheme(settings.theme);
            }
        }

        // Peupler le sélecteur de playlists à partir des données déjà chargées
        populatePlaylists(playlists);

        // Charger la playlist active et la bibliothèque en parallèle
        await Promise.all([
            currentPlaylistId ? loadPlaylist(currentPlaylistId) : Promise.resolve(),
            loadLibrary(),
        ]);

        console.log('✅ JukeBox DnD initialisé');
    } catch (error) {
        console.error('❌ Erreur initialisation:', error);
    }
}

// ========================================
// Gestion des Playlists
// ========================================

// Peuple le sélecteur à partir de données déjà chargées (sans IPC)
function populatePlaylists(playlists) {
    const select = document.getElementById('playlist-select');
    const currentSelection = select.value;

    select.replaceChildren();
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- Choisir une playlist --';
    select.appendChild(defaultOpt);

    playlists.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `${p.name} (${p.trackIds.length} pistes)`;
        option.dataset.name = p.name; // nom pur, sans le compteur de pistes (utilisé par ex. dans le toast d'undo)
        select.appendChild(option);
    });

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

    // Mettre à jour l'affichage visible
    const selectedId = select.value;
    const selectedPlaylist = playlists.find(p => p.id === selectedId);
    if (selectedPlaylist) {
        const nameDisplay = document.getElementById('playlist-name-display');
        const trackCount = document.getElementById('track-count');
        if (nameDisplay) nameDisplay.textContent = selectedPlaylist.name;
        if (trackCount) trackCount.textContent = selectedPlaylist.trackIds.length;
    }

    // Peupler le dropdown de sélection
    const dropdown = document.getElementById('playlist-dropdown');
    if (dropdown) {
        dropdown.replaceChildren();
        playlists.forEach(p => {
            const btn = document.createElement('button');
            btn.className = `playlist-dropdown-item${p.id === selectedId ? ' active' : ''}`;
            btn.textContent = p.name;
            btn.addEventListener('click', () => {
                dropdown.classList.add('hidden');
                document.getElementById('playlist-select').value = p.id;
                loadPlaylist(p.id);
                window.electronAPI.saveSettings({ lastPlaylistId: p.id });
            });
            dropdown.appendChild(btn);
        });
    }
}

async function loadPlaylists() {
    const playlists = pendingDeletions.filterPlaylists(await window.electronAPI.getAllPlaylists());
    populatePlaylists(playlists);
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
            defaultVersion: t.defaultVersion || 'calm',
            defaultVolume: t.defaultVolume ?? 0.5
        }));

        audioManager.loadPlaylist(tracksConfig);
        currentPlaylistId = id;

        // Mettre à jour l'affichage de la playlist
        const nameDisplay = document.getElementById('playlist-name-display');
        const trackCount = document.getElementById('track-count');
        if (nameDisplay) nameDisplay.textContent = playlistData.name;
        if (trackCount) trackCount.textContent = playlistData.tracks.length;

        // Mettre à jour l'item actif dans le dropdown
        document.querySelectorAll('.playlist-dropdown-item').forEach(item => {
            item.classList.toggle('active', item.textContent === playlistData.name);
        });

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

/**
 * Ouvre la modale d'édition de piste, limitée au volume par défaut et
 * aux tags (normalisation manuelle + organisation de la bibliothèque).
 * Le titre est affiché pour le contexte mais en lecture seule, et la
 * section Versions / le bouton Supprimer sont masqués : hors scope, la
 * modale gère plus de champs dans le HTML que ce qui est branché ici.
 */
function openEditTrackModal(track) {
    const modal = document.getElementById('edit-track-modal');
    const volumePercent = Math.round((track.defaultVolume ?? 0.5) * 100);

    document.getElementById('edit-track-id').value = track.id;
    document.getElementById('edit-track-title').value = track.title;
    document.getElementById('edit-track-title').readOnly = true;
    document.getElementById('edit-track-volume').value = volumePercent;
    document.getElementById('edit-track-volume-value').textContent = `${volumePercent}%`;
    document.getElementById('edit-track-tags').value = (track.tags || []).join(', ');

    // Hors scope pour l'instant (voir commentaire ci-dessus)
    document.getElementById('edit-versions-group').classList.add('hidden');
    document.getElementById('delete-track-btn').classList.add('hidden');

    document.body.style.overflow = 'hidden';
    modal.classList.remove('hidden');
}

/**
 * Stoppe le preview en cours (s'il y en a un). N'affecte jamais la
 * lecture principale (audioManager) — Howl totalement séparé.
 */
function stopPreviewHowl() {
    if (previewHowl) {
        previewHowl.unload();
        previewHowl = null;
    }
}

const previewState = createPreviewState({
    clearTimer: clearTimeout,
    stopHowl: stopPreviewHowl,
});

/**
 * Démarre le preview d'une piste (version par défaut) dans un Howl
 * dédié. Même garde-fou que Track.play() : attend le chargement avant
 * de jouer (preload:false).
 */
function startPreview(track) {
    stopPreviewHowl();

    const versionName = track.defaultVersion || Object.keys(track.localPaths || {})[0];
    let src = versionName && track.localPaths ? track.localPaths[versionName] : null;
    if (!src) return;

    if (!src.startsWith('http') && !src.startsWith('file://')) {
        src = `file://${src}`;
    }

    previewHowl = new Howl({
        src: [src],
        html5: true,
        volume: getPreviewVolume(track),
        preload: false,
    });

    const doPlay = () => previewHowl && previewHowl.play();
    if (previewHowl.state() === 'loaded') {
        doPlay();
    } else {
        previewHowl.once('load', doPlay);
        previewHowl.load();
    }
}

/**
 * Rendu de la liste de pistes de la bibliothèque (sous-ensemble de
 * libraryCache, potentiellement filtré par la recherche).
 */
function renderLibraryList(tracks) {
    const container = document.getElementById('library-tracks');

    // Retirer les lignes ne déclenche pas mouseleave : annuler explicitement
    // le timer et le Howl avant chaque re-rendu.
    previewState.cancel();

    if (tracks.length === 0) {
        container.innerHTML = libraryCache.length === 0
            ? '<p class="empty-message">Bibliothèque vide. Cliquez sur "Ajouter une piste" pour commencer.</p>'
            : '<p class="empty-message">Aucune piste ne correspond à la recherche.</p>';
        return;
    }

    container.innerHTML = '';

    tracks.forEach(track => {
        const div = document.createElement('div');
        div.className = 'library-track';

        const versionsCount = Object.keys(track.localPaths || track.originalPaths || {}).length;
        const playlistsCount = track.inPlaylists ? track.inPlaylists.length : 0;
        const tags = track.tags || [];

        div.innerHTML = `
            <div class="track-info-main">
                <span class="track-title">${track.title}</span>
                <span class="track-details">${versionsCount} version(s) • ${playlistsCount} playlist(s)</span>
            </div>
            <div class="track-actions">
                <button class="add-to-playlist-btn secondary-btn" data-id="${track.id}" title="Ajouter à la playlist active" ${currentPlaylistId ? '' : 'disabled'}>➕</button>
                <button class="edit-track-btn secondary-btn" data-id="${track.id}" title="Modifier le volume">✏️</button>
                <button class="delete-track-btn danger-btn" data-id="${track.id}">🗑️</button>
            </div>
        `;

        // Pastilles de tags construites via le DOM (pas d'innerHTML) : un tag
        // est du texte saisi par l'utilisateur, à ne jamais interpoler brut
        if (tags.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'track-tags';
            tags.forEach(tag => {
                const pill = document.createElement('span');
                pill.className = 'tag-pill';
                pill.textContent = tag;
                tagsContainer.appendChild(pill);
            });
            div.querySelector('.track-info-main').appendChild(tagsContainer);
        }

        // Preview au survol : léger délai pour ignorer les survols rapides,
        // un seul preview actif à la fois, stoppé immédiatement au mouseleave
        div.addEventListener('mouseenter', () => {
            previewState.clearTimer();
            previewState.setTimer(setTimeout(() => startPreview(track), 300));
        });
        div.addEventListener('mouseleave', () => {
            previewState.cancel();
        });

        // Event ajout à la playlist active
        div.querySelector('.add-to-playlist-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!currentPlaylistId) return;
            await window.electronAPI.addTrackToPlaylist(currentPlaylistId, track.id);
            await loadPlaylist(currentPlaylistId);
            await loadPlaylists();
            await loadLibrary(); // rafraîchit le compteur "X playlist(s)" de la piste
        });

        // Event edit (volume par défaut + tags de la piste)
        div.querySelector('.edit-track-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openEditTrackModal(track);
        });

        // Event delete — suppression optimiste avec possibilité d'annuler (toast)
        div.querySelector('.delete-track-btn').addEventListener('click', (e) => {
            e.stopPropagation();

            // div.remove() ne déclenche pas mouseleave : couper le preview explicitement
            previewState.cancel();

            // Si c'est la piste en cours de lecture, on stoppe tout de suite
            if (audioManager.currentTrack && audioManager.currentTrack.id === track.id) {
                audioManager.stop();
                updateUI();
            }
            pendingDeletions.markTrack(track.id);
            div.remove();

            showUndoToast(`Piste "${track.title}" supprimée.`, {
                onExpire: async () => {
                    try {
                        await window.electronAPI.deleteTrack(track.id);
                    } finally {
                        pendingDeletions.completeTrack(track.id);
                        await loadLibrary(); // Recharger bibliothèque
                        if (currentPlaylistId) await loadPlaylist(currentPlaylistId); // Recharger playlist active
                    }
                },
                onUndo: async () => {
                    // Rien n'a été supprimé côté DB/fichiers : un simple rechargement restaure tout
                    pendingDeletions.undoTrack(track.id);
                    await loadLibrary();
                    if (currentPlaylistId) await loadPlaylist(currentPlaylistId);
                },
            });
        });

        container.appendChild(div);
    });
}

/**
 * Filtre libraryCache par titre ou tag (substring, insensible à la casse).
 */
function filterLibrary(query) {
    const q = query.trim().toLowerCase();
    if (!q) return libraryCache;

    return libraryCache.filter(track => {
        if (track.title.toLowerCase().includes(q)) return true;
        return (track.tags || []).some(tag => tag.toLowerCase().includes(q));
    });
}

async function loadLibrary() {
    libraryCache = pendingDeletions.filterTracks(await window.electronAPI.getLibrary());

    const searchInput = document.getElementById('library-search');
    const query = searchInput ? searchInput.value : '';

    renderLibraryList(filterLibrary(query));
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

function updateVersionBadge(version) {
    const badge = document.getElementById('version-badge');
    if (badge && version) {
        const label = version.charAt(0).toUpperCase() + version.slice(1);
        badge.textContent = `● ${label}`;
    }
}

function updatePlayBtn() {
    const btn = document.getElementById('play-btn');
    if (btn) btn.textContent = audioManager.isPlaying() ? '⏸' : '▶';
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
        audioManager.crossfade(targetVersion, 0.1); // 10% de la durée de la piste
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
        container.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'empty-message';
        empty.textContent = 'Aucune piste dans cette playlist.';
        container.appendChild(empty);
        return;
    }

    container.replaceChildren();

    state.playlist.forEach((track, index) => {
        const div = document.createElement('div');
        div.className = `playlist-track ${index === state.currentTrackIndex ? 'active' : ''}`;

        const versionLabel = track.defaultVersion
            ? track.defaultVersion.charAt(0).toUpperCase() + track.defaultVersion.slice(1)
            : '';

        const numSpan = document.createElement('span');
        numSpan.className = 'playlist-track-number';
        numSpan.textContent = String(index + 1).padStart(2, '0');

        const titleSpan = document.createElement('span');
        titleSpan.className = 'playlist-track-title';
        titleSpan.textContent = track.title;

        const versionSpan = document.createElement('span');
        versionSpan.className = 'playlist-track-version';
        versionSpan.textContent = versionLabel;

        const durationSpan = document.createElement('span');
        durationSpan.className = 'playlist-track-duration';
        durationSpan.textContent = '-:--';

        div.append(numSpan, titleSpan, versionSpan, durationSpan);

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
    updateVersionBadge(state.currentVersion);
    updatePlayBtn();

    // Playlist
    renderPlaylistUI();

    // Status : toujours mis à jour pour refléter l'état réel
    if (audioManager.isPlaying()) {
        updateStatus('En lecture');
    } else if (audioManager.currentTrack && audioManager.currentTrack.currentVersion) {
        updateStatus('En pause');
    } else {
        updateStatus('Arrêté');
    }
}

// ========================================
// Raccourcis clavier globaux
// ========================================

/**
 * Coupe/rétablit le volume en fondu court (pas de coupure brutale).
 * Mémorise le volume courant avant de couper, le restaure au prochain
 * appel (toggle).
 */
async function toggleMute() {
    const slider = document.getElementById('volume');
    const volumeValue = document.getElementById('volume-value');
    const FADE_MS = 300;

    if (volumeBeforeMute !== null) {
        // Rétablir le volume précédent
        const restored = volumeBeforeMute;
        volumeBeforeMute = null;
        slider.value = restored * 100;
        volumeValue.textContent = `${Math.round(restored * 100)}%`;
        window.electronAPI.saveSettings({ volume: restored });
        await audioManager.fadeVolume(restored, FADE_MS);
    } else {
        // Couper le son (si déjà à 0, on restaurera à 50% au prochain toggle)
        const current = slider.value / 100;
        volumeBeforeMute = current > 0 ? current : 0.5;
        slider.value = 0;
        volumeValue.textContent = '0%';
        window.electronAPI.saveSettings({ volume: 0 });
        await audioManager.fadeVolume(0, FADE_MS);
    }
}

// ========================================
// DOM Ready
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    init();

    // --- Tab Switching ---
    function switchView(viewName) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        const tab = document.querySelector(`.tab-btn[data-view="${viewName}"]`);
        if (tab) tab.classList.add('active');
        const view = document.getElementById(`${viewName}-view`);
        if (view) view.classList.remove('hidden');
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // --- Breadcrumb ---
    const breadcrumbBtn = document.querySelector('.breadcrumb-btn');
    if (breadcrumbBtn) {
        breadcrumbBtn.addEventListener('click', () => {
            switchView(breadcrumbBtn.dataset.targetView);
        });
    }

    // --- Playlist dropdown toggle ---
    document.getElementById('playlist-name-display').addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = document.getElementById('playlist-dropdown');
        dropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
        document.getElementById('playlist-dropdown')?.classList.add('hidden');
    });

    // --- Theme Selector ---
    document.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', () => {
            applyTheme(card.dataset.theme);
            window.electronAPI.saveSettings({ theme: card.dataset.theme });
        });
    });

    // --- Export / Import bibliothèque ---
    document.getElementById('export-library-btn').addEventListener('click', async () => {
        const statusEl = document.getElementById('export-import-status');
        statusEl.textContent = 'Export en cours…';
        try {
            const result = await window.electronAPI.exportLibrary();
            statusEl.textContent = result
                ? `✅ ${result.trackCount} piste(s), ${result.playlistCount} playlist(s) exportées vers ${result.path}`
                : '';
        } catch (err) {
            console.error(err);
            statusEl.textContent = "❌ Erreur lors de l'export";
        }
    });

    document.getElementById('import-library-btn').addEventListener('click', async () => {
        const statusEl = document.getElementById('export-import-status');
        statusEl.textContent = 'Import en cours…';
        try {
            const stats = await window.electronAPI.importLibrary();
            if (!stats) {
                statusEl.textContent = '';
                return;
            }
            statusEl.textContent =
                `✅ ${stats.tracksAdded} piste(s) ajoutée(s) (${stats.tracksSkipped} déjà présente(s)), ` +
                `${stats.playlistsAdded} playlist(s) ajoutée(s), ${stats.playlistsMerged} fusionnée(s)`;

            await loadLibrary();
            await loadPlaylists();
            if (currentPlaylistId) await loadPlaylist(currentPlaylistId);
        } catch (err) {
            console.error(err);
            statusEl.textContent = "❌ Erreur lors de l'import";
        }
    });

    // --- Playlist Select ---
    document.getElementById('playlist-select').addEventListener('change', (e) => {
        const id = e.target.value;
        if (id) {
            loadPlaylist(id);
            window.electronAPI.saveSettings({ lastPlaylistId: id });
        }
    });

    // --- Player Controls ---
    document.getElementById('play-btn').addEventListener('click', () => {
        if (!audioManager.currentTrack) {
            audioManager.playTrackAtIndex(0);
            startProgressUpdate();
        } else if (audioManager.isPlaying()) {
            audioManager.pause();
            stopProgressUpdate();
        } else {
            audioManager.resume();
            startProgressUpdate();
        }
        updateUI();
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
        volumeBeforeMute = null; // un ajustement manuel du volume annule l'état "muté"
    });

    // --- Raccourcis clavier globaux (voir electron/main.cjs) ---
    window.electronAPI.onShortcut((action) => {
        switch (action) {
            case 'play-pause':
                document.getElementById('play-btn').click();
                break;
            case 'next':
                document.getElementById('next-btn').click();
                break;
            case 'previous':
                document.getElementById('prev-btn').click();
                break;
            case 'mute':
                toggleMute();
                break;
        }
    });

    // --- Recherche bibliothèque (titre ou tags) ---
    document.getElementById('library-search').addEventListener('input', (e) => {
        renderLibraryList(filterLibrary(e.target.value));
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

        document.body.style.overflow = 'hidden';
        addTrackModal.classList.remove('hidden');
    });

    // Close Modals
    document.querySelectorAll('.close-modal-btn, #cancel-add-track, .cancel-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
            document.body.style.overflow = '';
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
                    filePathSpan.textContent = fileName;
                    filePathSpan.classList.add('file-loaded');

                    // Store the path
                    parent.querySelector('.file-path-value').value = files[0];

                    // Visual feedback on the parent container
                    parent.classList.add('has-file');

                    // Update button text
                    e.target.textContent = 'Modifier';
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

            document.body.style.overflow = '';
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
    // MODAL: MODIFIER PISTE (volume + tags — voir openEditTrackModal)
    // ========================================

    document.getElementById('edit-track-volume').addEventListener('input', (e) => {
        document.getElementById('edit-track-volume-value').textContent = `${e.target.value}%`;
    });

    document.getElementById('save-track-edits').addEventListener('click', async () => {
        const trackId = document.getElementById('edit-track-id').value;
        const volume = document.getElementById('edit-track-volume').value / 100;
        const tags = document.getElementById('edit-track-tags').value
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(Boolean);

        await window.electronAPI.updateTrack(trackId, { defaultVolume: volume, tags });

        document.body.style.overflow = '';
        document.getElementById('edit-track-modal').classList.add('hidden');

        // Recharger pour que les Track en mémoire reprennent le nouveau defaultVolume
        await loadLibrary();
        if (currentPlaylistId) await loadPlaylist(currentPlaylistId);
    });

    // ========================================
    // MODAL: CRÉER PLAYLIST
    // ========================================

    const createPlaylistModal = document.getElementById('create-playlist-modal');

    // Button from Player view
    document.getElementById('create-playlist-btn').addEventListener('click', () => {
        document.body.style.overflow = 'hidden';
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
            document.body.style.overflow = '';
            createPlaylistModal.classList.add('hidden');
        }
    });

    // Delete Playlist — suppression optimiste avec possibilité d'annuler (toast)
    document.getElementById('delete-playlist-btn').addEventListener('click', () => {
        const select = document.getElementById('playlist-select');
        const playlistId = select.value;
        if (!playlistId) return;

        const playlistName = select.selectedOptions[0]?.dataset.name || 'la playlist';
        const wasCurrent = currentPlaylistId === playlistId;
        pendingDeletions.markPlaylist(playlistId);

        // Retirer l'option de la liste tout de suite (rien n'est encore supprimé côté DB)
        const option = Array.from(select.options).find(opt => opt.value === playlistId);
        if (option) option.remove();
        select.value = '';
        currentPlaylistId = null;

        // Si plus de playlist, vider l'UI
        if (select.options.length <= 1) { // Juste l'option par défaut
            document.getElementById('playlist-tracks').innerHTML = '<p class="empty-message">Aucune playlist.</p>';
            audioManager.stop();
            updateUI();
        }

        showUndoToast(`Playlist "${playlistName}" supprimée.`, {
            onExpire: async () => {
                try {
                    await window.electronAPI.deletePlaylist(playlistId);
                } finally {
                    pendingDeletions.completePlaylist(playlistId);
                    await loadPlaylists();
                }
            },
            onUndo: async () => {
                // Rien n'a été supprimé côté DB : un rechargement restaure tout
                pendingDeletions.undoPlaylist(playlistId);
                await loadPlaylists();
                select.value = playlistId;
                if (wasCurrent) {
                    currentPlaylistId = playlistId;
                    await loadPlaylist(playlistId);
                }
            },
        });
    });
});
