import { Howl } from 'howler';
import { AudioManager } from '../backend/AudioManager.js';
import { DEFAULT_CROSSFADE_DURATION_SECONDS, legacyPercentToSeconds } from '../backend/crossfadeDuration.js';
import { normalizeLanguage, t as translate } from '../backend/i18n.js';
import {
    SHORTCUT_ACTIONS,
    acceleratorFromKeyEvent,
    formatAccelerator,
    versionForShortcut,
} from '../backend/shortcuts.js';
import { createPendingDeletionStore } from './pendingDeletions.js';
import { createCutterView } from './cutterView.js';
import { createPreviewController } from './previewController.js';
import { createPreviewState } from './previewState.js';
import { initTooltips, setTooltip } from './tooltip.js';
import { initRangeFill } from './rangeFill.js';
import { createProgressSlider } from './progressSlider.js';
import { createListbox } from './listbox.js';
import { createRadioGroup } from './roving.js';
import { closeModal, initModals, openModal } from './modal.js';
import { getPreviewVolume } from './trackVolume.js';

// ========================================
// Initialisation
// ========================================

const audioManager = new AudioManager();
// Changements déclenchés par le moteur audio lui-même (fin de piste → suivante,
// fin de playlist, fondu terminé/avorté) : l'UI doit suivre (#23)
audioManager.on('trackChange', () => {
    cutterView?.stopListening(); // ne jamais jouer par-dessus le lecteur principal (#33)
    updateUI();
    if (!audioManager.isPlaying()) stopProgressUpdate();
});
audioManager.on('versionChange', () => {
    updateUI();
    updateProgress(); // en pause, le minuteur de progression ne tourne pas (version enchaînée pendant une pause)
});
// Version de lancement choisie depuis les boutons du lecteur à l'arrêt (#25)
audioManager.on('launchVersionChange', (trackId, version) => persistLaunchVersion(trackId, version));
// Ancien réglage de fondu en % converti en secondes dès que la durée du fichier
// est connue (#28) : on persiste pour que la migration n'ait lieu qu'une fois
audioManager.on('crossfadeDurationMigrated', (trackId, seconds) => {
    const cached = libraryCache.find(track => track.id === trackId);
    if (cached) {
        cached.crossfadeDurationSeconds = seconds;
        delete cached.crossfadeDurationPercent;
    }
    window.electronAPI.updateTrack(trackId, { crossfadeDurationSeconds: seconds })
        .catch(err => console.error('❌ Migration de la durée de fondu:', err));
});
let currentPlaylistId = 'default'; // seule source de la playlist sélectionnée (#40)
let playlistsCache = []; // dernières playlists affichées (noms pour le toast d'undo, menu)
let updateInterval = null;
let volumeBeforeMute = null; // volume mémorisé pour le mute rapide (raccourci clavier) ; null = pas muté
let libraryCache = []; // dernière bibliothèque chargée, pour filtrer la recherche sans re-fetch IPC
const pendingDeletions = createPendingDeletionStore();
// État de travail des versions dans la modal d'édition (#15) : { name, isNew, filePath? }[].
// Rien n'est persisté tant que "Sauvegarder" n'est pas cliqué (même logique que volume/tags).
let editingVersions = [];
// Tempo en cours d'édition (#18) : { versionName: { bpm: string, offsetMs: string } }
let editingTempo = {};
let cutterView = null; // onglet Découpage (#24), créé au DOMContentLoaded
let progressSlider = null; // barre de progression manipulable (#39), créée au DOMContentLoaded
let playModeGroup = null; // modes de lecture (#46), créé au DOMContentLoaded

// ========================================
// i18n (#22) — langue courante persistée dans settings.language
// ========================================

let currentLanguage = 'fr';

function t(key, vars) {
    return translate(currentLanguage, key, vars);
}

/**
 * Applique la traduction courante à tout le HTML statique tagué
 * (data-i18n / data-i18n-placeholder / data-i18n-tooltip), puis met à jour
 * les quelques éléments qui mélangent texte traduit et données dynamiques
 * (nom de l'app, footer) et ne peuvent pas passer par un simple attribut.
 */
function applyTranslations() {
    document.documentElement.lang = currentLanguage;
    document.title = t('app.name');

    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-label]').forEach(el => {
        el.setAttribute('aria-label', t(el.dataset.i18nLabel));
    });
    document.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
        const text = t(el.dataset.i18nTooltip);
        setTooltip(el, text);
        if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', text);
    });

    const footer = document.getElementById('app-footer');
    if (footer) footer.textContent = `V 2.2 · ${t('app.name')} · ${t('app.footerTagline')}`;

    document.querySelectorAll('#language-grid .theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.lang === currentLanguage);
    });
}

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
        <button type="button" class="toast-undo-btn">${t('toast.undoBtn')}</button>
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

        currentLanguage = normalizeLanguage(settings?.language);
        applyTranslations();

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

        console.log('✅ Jukebox JDR initialisé');
    } catch (error) {
        console.error('❌ Erreur initialisation:', error);
    } finally {
        // Toujours révéler l'app, même en cas d'erreur d'init : rester bloqué
        // sur l'écran de chargement serait pire qu'un état partiellement chargé.
        document.getElementById('loading-screen')?.classList.add('hidden');
    }
}

// ========================================
// Gestion des Playlists
// ========================================

// Peuple le sélecteur à partir de données déjà chargées (sans IPC)
function populatePlaylists(playlists) {
    playlistsCache = playlists;

    // Garde la sélection si elle existe encore, sinon « default », sinon la première
    if (playlists.length > 0 && !playlists.some(p => p.id === currentPlaylistId)) {
        currentPlaylistId = playlists.some(p => p.id === 'default') ? 'default' : playlists[0].id;
    }

    // Mettre à jour l'affichage visible
    const selectedId = currentPlaylistId;
    const selectedPlaylist = playlists.find(p => p.id === selectedId);
    if (selectedPlaylist) {
        const nameDisplay = document.getElementById('playlist-name-display');
        const metaText = document.getElementById('playlist-meta-text');
        if (nameDisplay) nameDisplay.textContent = selectedPlaylist.name;
        if (metaText) metaText.textContent = t('player.playlistMeta', { count: selectedPlaylist.trackIds.length });
    }

    // Peupler le menu (entrées role="option", choix géré par createListbox)
    const dropdown = document.getElementById('playlist-dropdown');
    if (dropdown) {
        dropdown.replaceChildren();
        playlists.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'playlist-dropdown-item';
            btn.setAttribute('role', 'option');
            btn.tabIndex = -1;
            btn.dataset.id = p.id;
            btn.textContent = p.name;
            dropdown.appendChild(btn);
        });
        markActivePlaylist(selectedId);
    }
}

// Entrée active du menu repérée par id, jamais par nom (deux playlists peuvent être homonymes)
function markActivePlaylist(id) {
    document.querySelectorAll('.playlist-dropdown-item').forEach(item => {
        const active = item.dataset.id === id;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
    });
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
            segments: t.segments, // versions découpées (#24)
            tempo: t.tempo, // synchronisation BPM (#18)
            launchVersion: t.launchVersion, // version de lancement choisie (#25)
            defaultVolume: t.defaultVolume ?? 0.5,
            crossfadeDurationSeconds: t.crossfadeDurationSeconds,
            crossfadeDurationPercent: t.crossfadeDurationPercent, // ancien format, migré au chargement (#28)
        }));

        audioManager.loadPlaylist(tracksConfig);
        currentPlaylistId = id;

        // Mettre à jour l'affichage de la playlist
        const nameDisplay = document.getElementById('playlist-name-display');
        const metaText = document.getElementById('playlist-meta-text');
        if (nameDisplay) nameDisplay.textContent = playlistData.name;
        if (metaText) metaText.textContent = t('player.playlistMeta', { count: playlistData.tracks.length });

        markActivePlaylist(id);

        updateUI();
        console.log(`✅ Playlist "${playlistData.name}" chargée`);
    } else {
        console.error("Playlist vide ou introuvable");
        document.getElementById('playlist-tracks').innerHTML = `<p class="empty-message">${t('tracklist.playlistNotFound')}</p>`;
    }
}

// ========================================
// Gestion de la Bibliothèque
// ========================================

function setCrossfadeDurationField(seconds) {
    document.getElementById('edit-track-crossfade-duration').value = seconds;
    updateCrossfadeDurationOutput();
}

function updateCrossfadeDurationOutput() {
    const seconds = Number(document.getElementById('edit-track-crossfade-duration').value);
    document.getElementById('edit-track-crossfade-duration-value').textContent =
        t('modal.editTrack.crossfadeValue', { value: seconds.toLocaleString(currentLanguage) });
}

/**
 * Durée de fondu affichée dans la modal (#28). Une piste encore à l'ancien
 * format (%) est convertie avec la durée réelle de son fichier, lue via les
 * métadonnées audio — même calcul que la migration au chargement Howler.
 * Enregistrer la modal persiste ensuite la valeur en secondes.
 */
function initCrossfadeDurationField(track) {
    const field = document.getElementById('edit-track-crossfade-duration');
    const knownSeconds = track.crossfadeDurationSeconds
        ?? audioManager.getTrack(track.id)?.crossfadeDurationSeconds;
    delete field.dataset.touched;

    if (knownSeconds !== undefined && knownSeconds !== null) {
        setCrossfadeDurationField(knownSeconds);
        return;
    }
    if (track.crossfadeDurationPercent === undefined || track.crossfadeDurationPercent === null) {
        setCrossfadeDurationField(DEFAULT_CROSSFADE_DURATION_SECONDS);
        return;
    }

    setCrossfadeDurationField(legacyPercentToSeconds(track.crossfadeDurationPercent));
    const src = getPreviewSource(track);
    if (!src) return;
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
        const stillEditing = document.getElementById('edit-track-id').value === track.id;
        if (stillEditing && !field.dataset.touched) {
            setCrossfadeDurationField(legacyPercentToSeconds(track.crossfadeDurationPercent, audio.duration));
        }
        audio.removeAttribute('src');
    }, { once: true });
    audio.src = src;
}

/**
 * Ouvre la modale d'édition de piste : renommage (lecture seule, hors
 * scope), volume par défaut, tags, et gestion des versions (#15 —
 * réordonner/ajouter/supprimer). Le bouton Supprimer (piste entière) reste
 * masqué : la suppression complète passe par le bouton 🗑️ de la bibliothèque.
 */
function openEditTrackModal(track) {
    const modal = document.getElementById('edit-track-modal');
    const volumePercent = Math.round((track.defaultVolume ?? 0.5) * 100);

    document.getElementById('edit-track-id').value = track.id;
    document.getElementById('edit-track-title').value = track.title;
    document.getElementById('edit-track-title').readOnly = true;
    document.getElementById('edit-track-volume').value = volumePercent;
    document.getElementById('edit-track-volume-value').textContent = `${volumePercent}%`;
    initCrossfadeDurationField(track);
    document.getElementById('edit-track-tags').value = (track.tags || []).join(', ');

    const versionNames = Object.keys(track.localPaths || track.originalPaths || {});
    editingVersions = versionNames.map(name => ({ name, isNew: false }));
    editingTempo = Object.fromEntries(Object.entries(track.tempo || {}).map(([name, { bpm, offsetMs }]) => (
        [name, { bpm: String(bpm), offsetMs: String(offsetMs) }]
    )));
    document.getElementById('edit-tempo-group').open = Object.keys(editingTempo).length > 0;
    renderEditVersionList();

    document.getElementById('delete-track-btn').classList.add('hidden');

    openModal(modal);
}

/**
 * Échange la position de deux versions dans l'état de travail local
 * (rien n'est persisté avant Sauvegarder).
 */
function swapEditingVersions(indexA, indexB) {
    [editingVersions[indexA], editingVersions[indexB]] = [editingVersions[indexB], editingVersions[indexA]];
    renderEditVersionList();
}

function removeEditingVersion(index) {
    editingVersions.splice(index, 1);
    renderEditVersionList();
}

/**
 * Rend la liste des versions de la piste en cours d'édition avec des
 * boutons ↑/↓/✕ par ligne (même pattern que le réordonnancement de
 * playlist, #14) : rien n'est persisté ici, seul "Sauvegarder" écrit.
 */
/**
 * Synchronisation BPM (#18) : une ligne BPM + décalage par version de la
 * modal, dans l'ordre et avec les noms de la liste de versions en cours d'édition
 */
function renderTempoList() {
    const container = document.getElementById('edit-tempo-list');
    container.replaceChildren();

    // En-têtes de colonnes : un texte indicatif trop long serait tronqué dans le champ
    const header = document.createElement('div');
    header.className = 'tempo-row tempo-header';
    const [blank, bpmHeader, offsetHeader] = [0, 1, 2].map(() => document.createElement('span'));
    bpmHeader.textContent = t('modal.editTrack.tempoBpm');
    offsetHeader.textContent = t('modal.editTrack.tempoOffset');
    header.append(blank, bpmHeader, offsetHeader);
    container.append(header);

    editingVersions.forEach(({ name }) => {
        const values = editingTempo[name] || { bpm: '', offsetMs: '' };
        editingTempo[name] = values;

        const row = document.createElement('div');
        row.className = 'tempo-row';

        const label = document.createElement('span');
        label.className = 'tempo-row-name';
        label.textContent = name; // texte utilisateur : jamais d'innerHTML

        const field = (key, labelKey, min, max, step, placeholder) => {
            const input = document.createElement('input');
            input.type = 'number';
            input.min = String(min);
            if (max !== null) input.max = String(max);
            input.step = String(step);
            input.value = values[key];
            input.placeholder = placeholder;
            setTooltip(input, t(labelKey));
            input.setAttribute('aria-label', `${name} — ${t(labelKey)}`);
            input.addEventListener('input', () => { values[key] = input.value; });
            return input;
        };

        row.append(
            label,
            field('bpm', 'modal.editTrack.tempoBpm', 20, 400, 'any', '120'),
            field('offsetMs', 'modal.editTrack.tempoOffset', 0, null, 1, '0'),
        );
        container.append(row);
    });
}

/**
 * Tempo à enregistrer (#18), ou { error } pour la première version invalide.
 * Une ligne entièrement vide = pas de synchronisation pour cette version.
 */
function collectEditingTempo(versionNames) {
    const tempo = {};
    for (const name of versionNames) {
        const { bpm = '', offsetMs = '' } = editingTempo[name] || {};
        if (bpm.trim() === '' && offsetMs.trim() === '') continue;
        const bpmValue = Number(bpm);
        const offsetValue = offsetMs.trim() === '' ? 0 : Number(offsetMs);
        if (bpm.trim() === '' || !(bpmValue >= 20 && bpmValue <= 400) || !(offsetValue >= 0)) {
            return { error: name };
        }
        tempo[name] = { bpm: bpmValue, offsetMs: offsetValue };
    }
    return { tempo };
}

function renderEditVersionList() {
    renderTempoList();
    const container = document.getElementById('edit-version-list');
    container.replaceChildren();

    editingVersions.forEach((version, index) => {
        const row = document.createElement('div');
        row.className = 'edit-version-row';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'edit-version-row-name';
        nameSpan.textContent = version.name + (version.isNew ? t('modal.editTrack.newVersionSuffix') : '');

        const actions = document.createElement('div');
        actions.className = 'edit-version-row-actions';

        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'icon-btn';
        setTooltip(upBtn, t('tracklist.moveUp'));
        upBtn.textContent = '↑';
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => swapEditingVersions(index, index - 1));

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'icon-btn';
        setTooltip(downBtn, t('tracklist.moveDown'));
        downBtn.textContent = '↓';
        downBtn.disabled = index === editingVersions.length - 1;
        downBtn.addEventListener('click', () => swapEditingVersions(index, index + 1));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'icon-btn danger-icon';
        setTooltip(removeBtn, t('modal.editTrack.removeVersion'));
        removeBtn.textContent = '✕';
        removeBtn.disabled = editingVersions.length <= 1;
        removeBtn.addEventListener('click', () => removeEditingVersion(index));

        actions.append(upBtn, downBtn, removeBtn);
        row.append(nameSpan, actions);
        container.appendChild(row);
    });
}

/**
 * Affiche une ligne temporaire pour saisir le nom + fichier d'une nouvelle
 * version. Ne modifie `editingVersions` qu'à la confirmation — annuler ne
 * laisse aucune trace. Un seul ajout à la fois (pas de ligne dupliquée).
 */
function showAddVersionRow() {
    const container = document.getElementById('edit-version-list');
    if (container.querySelector('.pending-version-row')) return;

    let pickedFilePath = null;

    const row = document.createElement('div');
    row.className = 'version-input pending-version-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'version-name';
    nameInput.placeholder = t('modal.editTrack.versionNamePlaceholder');

    const fileBtn = document.createElement('button');
    fileBtn.type = 'button';
    fileBtn.className = 'select-file-btn';
    fileBtn.textContent = `📁 ${t('modal.addTrack.selectFile')}`;

    const filePathSpan = document.createElement('span');
    filePathSpan.className = 'file-path';
    filePathSpan.textContent = t('modal.addTrack.noFile');

    fileBtn.addEventListener('click', async () => {
        const files = await window.electronAPI.openFiles();
        if (files && files.length > 0) {
            pickedFilePath = files[0];
            filePathSpan.textContent = files[0].split('/').pop();
            filePathSpan.classList.add('file-loaded');
            row.classList.add('has-file');
        }
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'icon-btn';
    setTooltip(confirmBtn, t('modal.editTrack.confirm'));
    confirmBtn.textContent = '✓';
    confirmBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) {
            alert(t('modal.editTrack.versionNameRequired'));
            return;
        }
        if (editingVersions.some(v => v.name.toLowerCase() === name.toLowerCase())) {
            alert(t('modal.editTrack.duplicateVersionName'));
            return;
        }
        if (!pickedFilePath) {
            alert(t('modal.editTrack.selectAudioFile'));
            return;
        }
        editingVersions.push({ name, isNew: true, filePath: pickedFilePath });
        renderEditVersionList();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'icon-btn danger-icon';
    setTooltip(cancelBtn, t('modal.editTrack.cancel'));
    cancelBtn.textContent = '✕';
    cancelBtn.addEventListener('click', () => row.remove());

    row.append(nameInput, fileBtn, filePathSpan, confirmBtn, cancelBtn);
    container.appendChild(row);
    nameInput.focus();
}

function getPreviewSource(track) {
    const versionName = track.defaultVersion || Object.keys(track.localPaths || {})[0];
    let src = versionName && track.localPaths ? track.localPaths[versionName] : null;
    if (!src) return null;

    if (!src.startsWith('http') && !src.startsWith('file://')) {
        src = `file://${src}`;
    }

    return src;
}

const previewController = createPreviewController({
    createHowl: options => new Howl(options),
    getSource: getPreviewSource,
    getVolume: getPreviewVolume,
    t, // référence stable : lit currentLanguage à chaque appel, donc suit les changements de langue
    setTooltip,
});

const previewState = createPreviewState({
    clearTimer: clearTimeout,
    stopHowl: previewController.stop,
});

/**
 * Rendu de la liste de pistes de la bibliothèque (sous-ensemble de
 * libraryCache, potentiellement filtré par la recherche).
 */
function renderLibraryList(tracks) {
    const container = document.getElementById('library-tracks');

    // Un re-rendu retire les lignes : interrompre explicitement le preview
    // afin qu'aucun son ne continue sans bouton visible pour le contrôler.
    previewState.cancel();

    if (tracks.length === 0) {
        container.innerHTML = libraryCache.length === 0
            ? `<p class="empty-message">${t('library.empty')}</p>`
            : `<p class="empty-message">${t('library.noSearchResults')}</p>`;
        return;
    }

    container.innerHTML = '';

    tracks.forEach(track => {
        const div = document.createElement('div');
        div.className = 'library-track';

        const versionsCount = Object.keys(track.localPaths || track.originalPaths || {}).length;
        const playlistsCount = track.inPlaylists ? track.inPlaylists.length : 0;
        const tags = track.tags || [];
        const canPreview = Boolean(getPreviewSource(track));

        div.innerHTML = `
            <div class="track-info-main">
                <span class="track-title"></span>
                <span class="track-details">${t('library.versionsCount', { versions: versionsCount, playlists: playlistsCount })}</span>
            </div>
            <div class="track-actions">
                <button class="preview-track-btn secondary-btn" data-id="${track.id}" data-tooltip="${t('preview.play')}" aria-label="${t('preview.play')}" ${canPreview ? '' : 'disabled'}>▶</button>
                <button class="add-to-playlist-btn secondary-btn" data-id="${track.id}" data-tooltip="${t('library.addToPlaylist')}" aria-label="${t('library.addToPlaylist')}" ${currentPlaylistId ? '' : 'disabled'}>➕</button>
                <button class="split-track-btn secondary-btn" data-id="${track.id}" data-tooltip="${t('library.splitTrack')}" aria-label="${t('library.splitTrack')}">✂</button>
                <button class="edit-track-btn secondary-btn" data-id="${track.id}" data-tooltip="${t('library.editTrack')}" aria-label="${t('library.editTrack')}">✏️</button>
                <button class="delete-track-btn danger-btn" data-id="${track.id}">🗑️</button>
            </div>
        `;
        div.querySelector('.track-title').textContent = track.title; // texte utilisateur : jamais interpolé brut dans l'innerHTML

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

        div.querySelector('.preview-track-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            previewController.toggle(track, e.currentTarget);
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

        // Retouche de la découpe (#24), ou ajout d'un fichier découpé à toute piste (#45)
        div.querySelector('.split-track-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            switchView('decoupage');
            cutterView.openTrack(track);
        });

        // Event delete — suppression optimiste avec possibilité d'annuler (toast)
        div.querySelector('.delete-track-btn').addEventListener('click', (e) => {
            e.stopPropagation();

            // Une ligne retirée doit aussi interrompre son preview éventuel.
            previewState.cancel();

            // Si c'est la piste en cours de lecture, on stoppe tout de suite
            if (audioManager.currentTrack && audioManager.currentTrack.id === track.id) {
                audioManager.stop();
                updateUI();
            }
            pendingDeletions.markTrack(track.id);
            div.remove();

            showUndoToast(t('toast.trackDeleted', { title: track.title }), {
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

/**
 * @param {'playing'|'paused'|'stopped'} statusKey - Clé stable, indépendante
 *   de la langue affichée (#22) : le nom de classe CSS en dépend
 *   directement (voir .status.playing/.paused/.stopped dans styles/player.css),
 *   donc il ne doit jamais être dérivé du texte traduit.
 */
function updateStatus(statusKey) {
    const el = document.getElementById('track-status');
    if (el) {
        el.textContent = t(`status.${statusKey}`);
        el.className = 'status ' + statusKey;
    }
}

const KNOWN_VERSION_KEYS = { calm: 'version.calm', combat: 'version.combat', tension: 'version.tension' };

function versionLabel(version) {
    return KNOWN_VERSION_KEYS[version] ? t(KNOWN_VERSION_KEYS[version]) : version;
}

function updateVersionDisplay(version) {
    const el = document.getElementById('current-version');
    if (el) el.textContent = versionLabel(version);
}

function updateVersionBadge(version) {
    const badge = document.getElementById('version-badge');
    if (badge && version) {
        const label = KNOWN_VERSION_KEYS[version]
            ? versionLabel(version)
            : version.charAt(0).toUpperCase() + version.slice(1);
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
        container.innerHTML = `<p class="empty-message">${t('tracklist.noVersionAvailable')}</p>`;
        return;
    }

    versions.forEach(v => {
        const btn = document.createElement('button');
        btn.className = `version-btn ${v === currentVersion ? 'active' : ''}`;
        btn.dataset.version = v;

        // Icons for known versions
        let icon = '';
        let label = KNOWN_VERSION_KEYS[v] ? versionLabel(v) : v.charAt(0).toUpperCase() + v.slice(1);
        if (v === 'calm') icon = '🌙';
        else if (v === 'tension') icon = '⚡';
        else if (v === 'combat') icon = '⚔️';

        btn.textContent = icon ? `${icon} ${label}` : label;

        btn.addEventListener('click', () => {
            handleVersionChange(v);
        });

        container.appendChild(btn);
    });
}

function handleVersionChange(targetVersion) {
    // Lecture → crossfade ; pause → bascule directe ; arrêt → simple choix (#23).
    // L'affichage est anticipé ici puis resynchronisé via onVersionChange si le
    // fondu est avorté ou enchaîné.
    const wasPlaying = audioManager.isPlaying();
    audioManager.switchVersion(targetVersion);

    // Pause / arrêt : affichage complet, dont la version de lancement dans la liste (#25)
    if (!wasPlaying) {
        updateUI();
        return;
    }

    const state = audioManager.getPlaylistState();
    updateVersionButtons(state.currentTrack, state.currentVersion);
    updateVersionDisplay(state.currentVersion);
    updateVersionBadge(state.currentVersion);
}

/**
 * Raccourci de version (#26) : même effet qu'un clic sur le bouton de version
 * du lecteur (fondu en lecture, bascule en pause, version de lancement à l'arrêt)
 */
function handleVersionShortcut(action) {
    const state = audioManager.getPlaylistState();
    const idle = !state.currentTrack || !state.currentTrack.currentVersion;
    const track = idle ? state.selectedTrack : state.currentTrack;
    const current = idle ? state.launchVersion : state.currentVersion;
    const target = versionForShortcut(action, track?.availableVersions || [], current);
    if (target && target !== current) handleVersionChange(target);
}

// ========================================
// Réglages — raccourcis de version (#26)
// ========================================

let shortcutSettings = { shortcuts: {}, status: {} };
let recordingShortcut = null; // { action, onKeyDown } pendant la capture d'une combinaison

async function loadShortcutSettings() {
    if (!window.electronAPI.getShortcuts) return;
    shortcutSettings = await window.electronAPI.getShortcuts();
    renderShortcutSettings();
}

function renderShortcutSettings() {
    const list = document.getElementById('shortcut-list');
    if (!list) return;
    list.replaceChildren();

    SHORTCUT_ACTIONS.forEach(action => {
        const row = document.createElement('div');
        row.className = 'shortcut-row';

        const label = document.createElement('span');
        label.textContent = t(`settings.shortcut.${action}`);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary-btn';
        const isRecording = recordingShortcut?.action === action;
        button.classList.toggle('recording', isRecording);
        button.textContent = isRecording
            ? t('settings.shortcutRecording')
            : formatAccelerator(shortcutSettings.shortcuts[action]) || t('settings.shortcutOff');
        button.addEventListener('click', () => startShortcutRecording(action));

        row.append(label, button);

        const status = shortcutSettings.status[action];
        if (status && status !== 'ok' && status !== 'off') {
            const message = document.createElement('p');
            message.className = 'shortcut-status';
            message.textContent = t(`settings.shortcutStatus.${status}`);
            row.append(message);
        }
        list.append(row);
    });
}

async function stopShortcutRecording(changes) {
    if (!recordingShortcut) return;
    window.removeEventListener('keydown', recordingShortcut.onKeyDown, true);
    recordingShortcut = null;
    shortcutSettings = changes
        ? await window.electronAPI.updateShortcuts(changes)
        : await window.electronAPI.resumeShortcuts();
    renderShortcutSettings();
}

async function startShortcutRecording(action) {
    if (recordingShortcut) await stopShortcutRecording(null);

    const onKeyDown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') {
            stopShortcutRecording(null);
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
            stopShortcutRecording({ [action]: null });
        } else {
            const accelerator = acceleratorFromKeyEvent(event);
            if (accelerator) stopShortcutRecording({ [action]: accelerator }); // sinon : modificateur seul, on attend
        }
    };

    recordingShortcut = { action, onKeyDown };
    // Sinon la combinaison déjà enregistrée serait interceptée par le système
    await window.electronAPI.suspendShortcuts();
    window.addEventListener('keydown', onKeyDown, true);
    renderShortcutSettings();
}

function updateModeButtons(mode) {
    playModeGroup?.setValue(mode);
}

function updateProgress() {
    const duration = audioManager.getDuration();
    document.getElementById('duration').textContent = formatTime(duration);
    progressSlider?.update(audioManager.getCurrentTime(), duration);
}

function startProgressUpdate() {
    if (updateInterval) clearInterval(updateInterval);
    updateProgress(); // sans attendre le premier relevé : le curseur #39 part désactivé
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

/**
 * Échange la position de deux pistes de la playlist active (réordonnancement
 * par boutons ↑/↓, plus simple et robuste qu'un drag & drop en vanilla JS).
 * Persiste côté DB puis recharge la playlist : grâce au fix #13,
 * `loadPlaylist()` ne coupe pas la lecture en cours tant que l'ensemble des
 * pistes reste le même (seul l'ordre change).
 */
async function swapPlaylistTracks(state, indexA, indexB) {
    const orderedIds = state.playlist.map(t => t.id);
    [orderedIds[indexA], orderedIds[indexB]] = [orderedIds[indexB], orderedIds[indexA]];
    await window.electronAPI.reorderPlaylistTracks(currentPlaylistId, orderedIds);
    await loadPlaylist(currentPlaylistId);
}

async function removeFromActivePlaylist(trackId) {
    await window.electronAPI.removeTrackFromPlaylist(currentPlaylistId, trackId);
    await Promise.all([loadPlaylist(currentPlaylistId), loadLibrary()]);
}

function renderPlaylistUI() {
    const container = document.getElementById('playlist-tracks');
    if (!container) return;

    const state = audioManager.getPlaylistState();

    if (state.playlist.length === 0) {
        container.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'empty-message';
        empty.textContent = t('tracklist.emptyPlaylist');
        container.appendChild(empty);
        return;
    }

    container.replaceChildren();

    state.playlist.forEach((track, index) => {
        const div = document.createElement('div');
        div.className = `playlist-track ${index === state.currentTrackIndex ? 'active' : ''}`;

        const launchVersion = audioManager.getLaunchVersion(track.id);
        const versionDisplayLabel = launchVersion ? displayVersionName(launchVersion) : '';

        const numSpan = document.createElement('span');
        numSpan.className = 'playlist-track-number';
        numSpan.textContent = String(index + 1).padStart(2, '0');

        const titleSpan = document.createElement('span');
        titleSpan.className = 'playlist-track-title';
        titleSpan.textContent = track.title;

        // Version de lancement (#25) : un clic passe à la version suivante et l'enregistre
        const versionSpan = document.createElement('button');
        versionSpan.type = 'button';
        versionSpan.className = 'playlist-track-version';
        versionSpan.textContent = versionDisplayLabel;
        setTooltip(versionSpan, t('tracklist.launchVersion', { version: versionDisplayLabel }));
        versionSpan.addEventListener('click', (e) => {
            e.stopPropagation(); // ne pas lancer la piste
            const names = audioManager.getTrack(track.id)?.getState().availableVersions || [];
            if (names.length < 2) return;
            const next = names[(names.indexOf(launchVersion) + 1) % names.length];
            if (audioManager.setLaunchVersion(track.id, next)) {
                persistLaunchVersion(track.id, next);
                updateUI();
            }
        });

        const durationSpan = document.createElement('span');
        durationSpan.className = 'playlist-track-duration';
        durationSpan.textContent = '-:--';

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'playlist-track-actions';

        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'icon-btn';
        setTooltip(upBtn, t('tracklist.moveUp'));
        upBtn.textContent = '↑';
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            swapPlaylistTracks(state, index, index - 1);
        });

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'icon-btn';
        setTooltip(downBtn, t('tracklist.moveDown'));
        downBtn.textContent = '↓';
        downBtn.disabled = index === state.playlist.length - 1;
        downBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            swapPlaylistTracks(state, index, index + 1);
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'icon-btn danger-icon';
        setTooltip(removeBtn, t('tracklist.removeFromPlaylist'));
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFromActivePlaylist(track.id);
        });

        actionsDiv.append(upBtn, downBtn, removeBtn);
        div.append(numSpan, titleSpan, versionSpan, durationSpan, actionsDiv);

        div.addEventListener('click', () => {
            audioManager.playTrackAtIndex(index);
            updateUI();
            startProgressUpdate();
        });

        container.appendChild(div);
    });
}

/** Libellé affiché d'une version (clé traduite pour calm/combat/tension) */
function displayVersionName(version) {
    return KNOWN_VERSION_KEYS[version] ? versionLabel(version) : version.charAt(0).toUpperCase() + version.slice(1);
}

/** Enregistre la version de lancement d'une piste (#25) */
function persistLaunchVersion(trackId, version) {
    const cached = libraryCache.find(track => track.id === trackId);
    if (cached) cached.launchVersion = version;
    window.electronAPI.updateTrack(trackId, { launchVersion: version })
        .catch(err => console.error('❌ Version de lancement non enregistrée:', err));
}

function updateUI() {
    const state = audioManager.getPlaylistState();
    // À l'arrêt (ou avant toute lecture), le lecteur montre la piste sélectionnée
    // et sa version de lancement : cliquer une version la choisit (#25)
    const idle = !state.currentTrack || !state.currentTrack.currentVersion;
    const shownTrack = idle ? state.selectedTrack : state.currentTrack;
    const shownVersion = idle ? state.launchVersion : state.currentVersion;

    // Titre piste
    const title = state.currentTrack?.name || t('player.noTrack');
    document.querySelector('.track-title').textContent = title;
    document.querySelector('.track-number').textContent = t('player.trackCounter', { current: state.currentTrackIndex + 1, total: state.totalTracks });

    // Versions
    updateVersionButtons(shownTrack, shownVersion);
    updateVersionDisplay(shownVersion);
    updateVersionBadge(shownVersion);
    updatePlayBtn();

    // Playlist
    renderPlaylistUI();

    // Status : toujours mis à jour pour refléter l'état réel
    if (audioManager.isPlaying()) {
        updateStatus('playing');
    } else if (audioManager.currentTrack && audioManager.currentTrack.currentVersion) {
        updateStatus('paused');
    } else {
        updateStatus('stopped');
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
    // Même durée que le fondu réglé sur la piste active (#29) ; 300 ms sans piste active
    const FADE_MS = audioManager.getCrossfadeDurationMs(300);

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

// Changement d'onglet ; notifie l'onglet Découpage (#24) qui ne peut dessiner son canvas qu'une fois visible
function switchView(viewName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const tab = document.querySelector(`.tab-btn[data-view="${viewName}"]`);
    if (tab) tab.classList.add('active');
    const view = document.getElementById(`${viewName}-view`);
    if (view) view.classList.remove('hidden');
    if (viewName === 'decoupage' && cutterView) cutterView.onShow();
    else cutterView?.stopListening(); // l'écoute du Découpage ne suit pas l'utilisateur hors de l'onglet (#33)
}

document.addEventListener('DOMContentLoaded', () => {
    initTooltips(); // #38 : avant init(), qui pose déjà des tooltips
    initRangeFill(); // #39 : avant init(), qui règle déjà le volume
    initModals(); // #41
    init();
    loadShortcutSettings();

    cutterView = createCutterView({
        root: document.getElementById('decoupage-view'),
        electronAPI: window.electronAPI,
        t,
        createHowl: options => new Howl(options),
        stopLibraryPreview: () => previewState.cancel(),
        onSaved: async () => {
            await loadLibrary();
            await loadPlaylists();
            if (currentPlaylistId) await loadPlaylist(currentPlaylistId); // reconstruit la piste retouchée (#32)
        },
    });

    // --- Tab Switching (switchView : niveau module) ---
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

    // --- Menu des playlists (#40 : clavier + ARIA, voir listbox.js) ---
    createListbox({
        button: document.getElementById('playlist-name-display'),
        list: document.getElementById('playlist-dropdown'),
        onSelect: id => {
            loadPlaylist(id);
            window.electronAPI.saveSettings({ lastPlaylistId: id });
        },
    });

    // --- Theme Selector ---
    // Scopé à #theme-grid : #language-grid réutilise aussi .theme-card pour
    // son style, mais porte data-lang et non data-theme (sinon un clic sur
    // "English" retomberait sur applyTheme(undefined) → reset vers "nuit").
    document.querySelectorAll('#theme-grid .theme-card').forEach(card => {
        card.addEventListener('click', () => {
            applyTheme(card.dataset.theme);
            window.electronAPI.saveSettings({ theme: card.dataset.theme });
        });
    });

    // --- Language Selector (#22) ---
    document.querySelectorAll('#language-grid .theme-card').forEach(card => {
        card.addEventListener('click', () => {
            currentLanguage = normalizeLanguage(card.dataset.lang);
            applyTranslations();
            window.electronAPI.saveSettings({ language: currentLanguage });
            // Retraduit aussi tout ce qui est construit dynamiquement (compteurs,
            // libellés de version, sélecteur de playlist...), pas seulement le
            // HTML statique tagué data-i18n.
            loadPlaylists();
            if (currentPlaylistId) loadPlaylist(currentPlaylistId);
            loadLibrary();
            updateUI();
            cutterView?.refresh();
            renderShortcutSettings();
        });
    });

    // --- Export / Import bibliothèque ---
    document.getElementById('export-library-btn').addEventListener('click', async () => {
        const statusEl = document.getElementById('export-import-status');
        statusEl.textContent = t('export.inProgress');
        try {
            const result = await window.electronAPI.exportLibrary();
            statusEl.textContent = result
                ? t('export.success', { trackCount: result.trackCount, playlistCount: result.playlistCount, path: result.path })
                : '';
        } catch (err) {
            console.error(err);
            statusEl.textContent = t('export.error');
        }
    });

    document.getElementById('import-library-btn').addEventListener('click', async () => {
        const statusEl = document.getElementById('export-import-status');
        statusEl.textContent = t('import.inProgress');
        try {
            const stats = await window.electronAPI.importLibrary();
            if (!stats) {
                statusEl.textContent = '';
                return;
            }
            statusEl.textContent = t('import.success', {
                tracksAdded: stats.tracksAdded,
                tracksSkipped: stats.tracksSkipped,
                playlistsAdded: stats.playlistsAdded,
                playlistsMerged: stats.playlistsMerged,
            });

            await loadLibrary();
            await loadPlaylists();
            if (currentPlaylistId) await loadPlaylist(currentPlaylistId);
        } catch (err) {
            console.error(err);
            statusEl.textContent = t('import.error');
        }
    });

    // --- Player Controls ---
    document.getElementById('play-btn').addEventListener('click', () => {
        cutterView?.stopListening(); // ne jamais jouer par-dessus le lecteur principal (#33)
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
    // Modes de lecture : groupe à choix unique accessible (#46, ToggleGroup shadcn/Radix)
    playModeGroup = createRadioGroup({
        group: document.querySelector('#play-mode-selector .mode-buttons'),
        valueKey: 'mode',
        onSelect: mode => {
            audioManager.setPlayMode(mode);
            window.electronAPI.saveSettings({ playMode: mode });
        },
    });

    // --- Progress Bar Seek (#39 : curseur manipulable, voir progressSlider.js) ---
    progressSlider = createProgressSlider({
        input: document.getElementById('progress'),
        timeLabel: document.getElementById('current-time'),
        audio: audioManager,
        formatTime,
        t,
        onSeek: updateProgress,
    });

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
            case 'version-next':
            case 'version-1':
            case 'version-2':
            case 'version-3':
                handleVersionShortcut(action === 'version-next' ? 'versionNext' : `version${action.slice(-1)}`);
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
                <input type="text" class="version-name" placeholder="${t('modal.addTrack.versionNamePlaceholderShort')}" value="calm" />
                <button type="button" class="select-file-btn">📁 ${t('modal.addTrack.selectFile')}</button>
                <span class="file-path">${t('modal.addTrack.noFile')}</span>
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

        openModal(addTrackModal);
    });

    // Close Modals
    document.querySelectorAll('.close-modal-btn, #cancel-add-track, .cancel-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.closest('dialog.modal')));
    });

    // Add version row
    document.getElementById('add-version-input-btn').addEventListener('click', () => {
        const container = document.getElementById('version-inputs');
        const index = container.children.length;
        const div = document.createElement('div');
        div.className = 'version-input';
        div.dataset.index = index;
        div.innerHTML = `
            <input type="text" class="version-name" placeholder="${t('modal.addTrack.versionNamePlaceholder')}" />
            <button type="button" class="select-file-btn">📁 ${t('modal.addTrack.selectFile')}</button>
            <span class="file-path">${t('modal.addTrack.noFile')}</span>
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
                    e.target.textContent = t('modal.addTrack.changeFile');
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
            alert(t('modal.addTrack.titleRequired'));
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
            alert(t('modal.addTrack.needOneVersion'));
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
            document.getElementById('confirm-add-track').textContent = t('modal.addTrack.submitting');
            await window.electronAPI.addTrack(trackData, selectedPlaylists);

            closeModal(addTrackModal);
            document.getElementById('confirm-add-track').textContent = t('modal.addTrack.submitBtn');

            // Reload UI
            await loadLibrary();
            if (currentPlaylistId && selectedPlaylists.includes(currentPlaylistId)) {
                await loadPlaylist(currentPlaylistId);
            }
        } catch (err) {
            console.error(err);
            alert(t('modal.addTrack.errorAdding'));
            document.getElementById('confirm-add-track').textContent = t('modal.addTrack.submitBtn');
        }
    });

    // ========================================
    // MODAL: MODIFIER PISTE (volume + tags — voir openEditTrackModal)
    // ========================================

    document.getElementById('edit-track-volume').addEventListener('input', (e) => {
        document.getElementById('edit-track-volume-value').textContent = `${e.target.value}%`;
    });

    document.getElementById('edit-track-crossfade-duration').addEventListener('input', (e) => {
        e.target.dataset.touched = 'true'; // ne plus écraser par la conversion asynchrone
        updateCrossfadeDurationOutput();
    });

    document.getElementById('add-edit-version-btn').addEventListener('click', () => {
        showAddVersionRow();
    });

    document.getElementById('save-track-edits').addEventListener('click', async () => {
        const trackId = document.getElementById('edit-track-id').value;
        const volume = document.getElementById('edit-track-volume').value / 100;
        const crossfadeDurationSeconds = Number(document.getElementById('edit-track-crossfade-duration').value);
        const tags = document.getElementById('edit-track-tags').value
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(Boolean);

        const originalTrack = libraryCache.find(t => t.id === trackId);
        const originalNames = Object.keys(originalTrack?.localPaths || originalTrack?.originalPaths || {});

        const tempoResult = collectEditingTempo(editingVersions.map(v => v.name));
        if (tempoResult.error) {
            alert(t('modal.editTrack.tempoInvalid', { name: tempoResult.error }));
            return;
        }
        const finalNames = editingVersions.map(v => v.name);
        const removedNames = originalNames.filter(name => !finalNames.includes(name));
        const newVersions = editingVersions.filter(v => v.isNew);

        try {
            // Ajouter avant de retirer : si l'utilisateur remplace la seule
            // version existante par une nouvelle, retirer en premier
            // déclencherait le garde-fou "dernière version" côté backend.
            for (const v of newVersions) {
                await window.electronAPI.addVersion(trackId, v.name, v.filePath);
            }
            for (const name of removedNames) {
                await window.electronAPI.removeVersion(trackId, name);
            }
            if (finalNames.length > 0) {
                await window.electronAPI.reorderVersions(trackId, finalNames);
            }

            const updates = { defaultVolume: volume, crossfadeDurationSeconds, tags, tempo: tempoResult.tempo };
            if (originalTrack?.defaultVersion && removedNames.includes(originalTrack.defaultVersion)) {
                updates.defaultVersion = finalNames[0];
            }
            await window.electronAPI.updateTrack(trackId, updates);
        } catch (err) {
            console.error(err);
            alert(t('modal.editTrack.saveVersionsError'));
            return;
        }

        // Recharger pour que les Track en mémoire reprennent le nouveau defaultVolume/versions
        const reload = (async () => {
            await loadLibrary();
            if (currentPlaylistId) await loadPlaylist(currentPlaylistId);
        })();
        // Le ✏️ d'origine est recréé par loadLibrary : le focus attend le rechargement (#41)
        closeModal(document.getElementById('edit-track-modal'), { restoreFocusAfter: reload });
        await reload;
    });

    // ========================================
    // MODAL: CRÉER PLAYLIST
    // ========================================

    const createPlaylistModal = document.getElementById('create-playlist-modal');

    // Button from Player view
    document.getElementById('create-playlist-btn').addEventListener('click', () => {
        openModal(createPlaylistModal);
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
            loadPlaylist(playlist.id); // Switch to new
            closeModal(createPlaylistModal);
        }
    });

    // Delete Playlist — suppression optimiste avec possibilité d'annuler (toast)
    document.getElementById('delete-playlist-btn').addEventListener('click', () => {
        const playlistId = currentPlaylistId;
        if (!playlistId) return;

        const playlistName = playlistsCache.find(p => p.id === playlistId)?.name || t('playlist.fallbackName');
        pendingDeletions.markPlaylist(playlistId);

        // Retirer l'entrée du menu tout de suite (rien n'est encore supprimé côté DB)
        playlistsCache = playlistsCache.filter(p => p.id !== playlistId);
        document.querySelector(`.playlist-dropdown-item[data-id="${CSS.escape(playlistId)}"]`)?.remove();
        currentPlaylistId = null;

        // Si plus de playlist, vider l'UI
        if (playlistsCache.length === 0) {
            document.getElementById('playlist-tracks').innerHTML = `<p class="empty-message">${t('tracklist.emptyNoPlaylist')}</p>`;
            audioManager.stop();
            updateUI();
        }

        showUndoToast(t('toast.playlistDeleted', { name: playlistName }), {
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
                currentPlaylistId = playlistId; // la playlist supprimée était forcément la sélectionnée
                await loadPlaylists();
                await loadPlaylist(playlistId);
            },
        });
    });
});
