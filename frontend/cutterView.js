import {
    addCut,
    cutsToRanges,
    fileLabels,
    formatTime,
    mergeNames,
    moveCut,
    parseTime,
    planLaunchVersion,
    removeCut,
    sourceRequests,
    splitNames,
    stateFromSegments,
    validateSources,
} from './segmentModel.js';
import {
    decodeForWaveform,
    drawWaveform,
    fullView,
    scrollView,
    timeToX,
    xToTime,
    zoomView,
} from './waveform.js';
import { sourceGroups } from '../backend/segments.js';
import { rovingKeyTarget } from './roving.js';
import { setTooltip } from './tooltip.js';

const CUT_HIT_PX = 6;
const NUDGE_SECONDS = 0.1;
const ZOOM_STEP = 1.5;

/**
 * Seul le dernier chargement lancé peut appliquer son résultat : choisir un
 * fichier (ou rouvrir une piste) pendant qu'un autre est encore en cours de
 * décodage ne doit jamais mélanger les deux états (revue finale #24).
 */
export function createLatestOnly() {
    let current = 0;
    return {
        start: () => ++current,
        current: () => current,
        isCurrent: token => token === current,
        cancel: () => { current++; },
    };
}

const toFileUrl = path => (path.startsWith('http') || path.startsWith('file://') ? path : `file://${path}`);
const baseName = path => path.split(/[\\/]/).pop();

/**
 * Contrôleur de l'onglet Découpage (#24), un onglet par fichier découpé (#45).
 * Toute la logique de découpe est dans segmentModel.js / waveform.js ; ici
 * uniquement DOM, souris, clavier et écoute (Howl dédié, indépendant du
 * lecteur principal).
 */
export function createCutterView({ root, electronAPI, t, createHowl, stopLibraryPreview, onSaved }) {
    const $ = id => root.querySelector(`#${id}`);
    const canvas = $('split-canvas');

    let tabKeys = 0;
    let state = emptyState();
    let audition = null; // { howl, timer }
    let drag = null; // { index } pendant le déplacement d'un point de coupe
    // Session de découpe : la quitter (annuler, rouvrir une piste) invalide ses chargements en cours
    const loads = createLatestOnly();

    function emptyState() {
        return {
            tabs: [],
            active: 0,
            editingTrack: null, // piste en retouche, sinon création
            reservedNames: [], // versions « fichier entier » de la piste en retouche
            dirty: false, // découpe modifiée et non enregistrée (#33)
            message: { key: 'split.noFile' },
            error: null,
        };
    }

    /**
     * Un fichier découpé. `localPath` : fichier déjà dans la piste ; `sourcePath` :
     * nouveau fichier. `keptSegments` : ses segments d'origine, tant qu'il n'est
     * pas décodé (illisible : renvoyés tels quels à l'enregistrement).
     */
    function emptyTab() {
        return {
            key: ++tabKeys,
            sourcePath: null,
            localPath: null,
            readPath: null,
            originalPath: '', // chemin d'origine : libellé de l'onglet
            fileName: '',
            duration: 0,
            peaks: null,
            cuts: [],
            names: [''],
            view: { start: 0, end: 0 },
            playhead: 0,
            selectedCut: null,
            loading: true,
            loadError: false,
            keptSegments: null,
        };
    }

    const tab = () => state.tabs[state.active] || null;
    const isLive = (session, target) => loads.isCurrent(session) && state.tabs.includes(target);

    // ── Rendu ────────────────────────────────────────────────

    function currentMessage() {
        const current = tab();
        if (current?.loading) return { key: 'split.loading' };
        if (current?.loadError) return { key: 'split.fileUnreadable' };
        if (!current && state.editingTrack) return { key: 'split.noSource' };
        return state.message;
    }

    function refresh() {
        const current = tab();
        const loaded = Boolean(current?.peaks);
        const message = currentMessage();
        $('split-message').textContent = message ? t(message.key, message.vars) : '';
        $('split-editor').classList.toggle('hidden', !loaded);
        $('split-form').classList.toggle('hidden', state.tabs.length === 0 && !state.editingTrack);
        $('split-submit').textContent = t(state.editingTrack ? 'split.save' : 'split.add');
        $('split-submit').disabled = state.tabs.some(target => target.loading);
        $('split-title').readOnly = Boolean(state.editingTrack);
        $('split-playlists-field').classList.toggle('hidden', Boolean(state.editingTrack));
        const errorEl = $('split-error');
        errorEl.textContent = state.error ? t(state.error.key, state.error.vars) : '';
        errorEl.classList.toggle('hidden', !state.error);
        renderTabs();
        renderSummary();
        renderListenButton();
        if (!loaded) return;
        renderScroll();
        renderTime();
        renderSegments();
        draw();
    }

    function renderTabs() {
        const list = $('split-tabs');
        list.replaceChildren(...state.tabs.map((target, i) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.id = `split-tab-${target.key}`;
            button.className = 'split-tab';
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(i === state.active));
            button.setAttribute('aria-controls', 'split-editor');
            button.tabIndex = i === state.active ? 0 : -1;
            button.textContent = target.fileName; // jamais innerHTML : nom de fichier utilisateur
            button.classList.toggle('has-error', target.loadError);
            button.addEventListener('click', () => selectTab(i));
            return button;
        }));
        const current = tab();
        if (current) $('split-editor').setAttribute('aria-labelledby', `split-tab-${current.key}`);
    }

    /** Toutes les versions de la piste, sans changer d'onglet (#45) */
    function renderSummary() {
        const names = state.tabs.flatMap(target => (target.keptSegments
            ? Object.keys(target.keptSegments)
            : target.names.map(name => name.trim()).filter(Boolean)));
        const summary = $('split-summary');
        summary.textContent = names.length > 0 ? t('split.summary', { names: names.join(' · ') }) : '';
        if (state.reservedNames.length > 0) {
            const full = document.createElement('span');
            full.className = 'split-summary-full';
            full.textContent = `${names.length > 0 ? ' · ' : ''}${t('split.summaryFull', { names: state.reservedNames.join(', ') })}`;
            summary.append(full);
        }
    }

    function renderListenButton() {
        $('split-listen').textContent = t(audition ? 'split.stopListening' : 'split.listen');
    }

    function renderTime() {
        const current = tab();
        $('split-time').textContent = `${formatTime(current.playhead)} / ${formatTime(current.duration)}`;
    }

    function renderScroll() {
        const current = tab();
        const scroll = $('split-scroll');
        const span = current.view.end - current.view.start;
        scroll.max = String(Math.max(0, current.duration - span));
        scroll.value = String(current.view.start);
        scroll.disabled = span >= current.duration;
    }

    function colors() {
        const css = getComputedStyle(document.documentElement);
        const read = name => css.getPropertyValue(name).trim();
        return {
            background: read('--ink-1'),
            wave: read('--gold-2'),
            cut: read('--bone'),
            cutSelected: read('--gold-1'),
            playhead: read('--red-fire'),
        };
    }

    function draw() {
        const current = tab();
        if (!current?.peaks) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return; // onglet masqué : redessiné par onShow()
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(rect.width * ratio);
        canvas.height = Math.round(rect.height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawWaveform(ctx, {
            peaks: current.peaks,
            view: current.view,
            width: rect.width,
            height: rect.height,
            cuts: current.cuts,
            playhead: current.playhead,
            selectedCut: current.selectedCut,
            colors: colors(),
        });
    }

    function renderSegments() {
        const current = tab();
        const container = $('split-segments');
        container.innerHTML = '';
        const ranges = cutsToRanges(current.cuts, current.duration);

        ranges.forEach((range, i) => {
            const row = document.createElement('div');
            row.className = 'split-segment';

            const index = document.createElement('span');
            index.className = 'split-index';
            index.textContent = String(i + 1);

            const start = document.createElement('span');
            start.textContent = formatTime(range.start);

            const arrow = document.createElement('span');
            arrow.className = 'split-arrow';
            arrow.textContent = '→';

            const end = document.createElement('input');
            end.type = 'text';
            end.className = 'split-end';
            end.value = formatTime(range.end);
            setTooltip(end, t('split.segmentEnd'));
            end.disabled = i === ranges.length - 1; // la fin du dernier segment = fin du fichier
            end.addEventListener('change', () => {
                const value = parseTime(end.value);
                if (value !== null) {
                    current.cuts = moveCut(current.cuts, i, value, current.duration);
                    state.dirty = true;
                }
                refresh(); // valeur invalide → revient à la précédente
            });

            const name = document.createElement('input');
            name.type = 'text';
            name.className = 'split-name';
            name.placeholder = t('split.segmentNamePlaceholder');
            name.value = current.names[i] || ''; // propriété value : jamais d'innerHTML pour du texte utilisateur
            name.addEventListener('input', () => {
                current.names[i] = name.value;
                state.dirty = true;
                renderSummary();
            });

            const play = document.createElement('button');
            play.type = 'button';
            play.className = 'secondary-btn';
            play.textContent = '▶';
            setTooltip(play, t('split.playSegment'));
            play.addEventListener('click', () => startAudition(range.start, range.end));

            row.append(index, start, arrow, end, name, play);

            if (i > 0) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'danger-btn-small';
                remove.textContent = '✕';
                setTooltip(remove, t('split.removeCut'));
                remove.addEventListener('click', () => {
                    current.names = mergeNames(current.names, i - 1);
                    current.cuts = removeCut(current.cuts, i - 1);
                    state.dirty = true;
                    current.selectedCut = null;
                    refresh();
                });
                row.append(remove);
            }
            container.append(row);
        });
    }

    // ── Onglets de fichiers (#45, modèle Tabs shadcn/Radix) ──

    /** Deux fichiers de même nom : leur dossier les distingue */
    function relabelTabs() {
        fileLabels(state.tabs.map(target => target.originalPath)).forEach((label, i) => {
            state.tabs[i].fileName = label;
        });
    }

    function selectTab(index, { focus = false } = {}) {
        if (index !== state.active) {
            stopAudition(); // l'écoute appartient à l'onglet quitté
            state.active = index;
            refresh();
        }
        if (focus) $(`split-tab-${tab().key}`).focus();
    }

    $('split-tabs').addEventListener('keydown', event => {
        const target = rovingKeyTarget(event.key, state.active, state.tabs.length);
        if (target === null) return;
        event.preventDefault();
        selectTab(target, { focus: true });
    });

    function removeTab(index) {
        stopAudition();
        state.tabs.splice(index, 1);
        relabelTabs();
        state.active = Math.min(state.active, Math.max(0, state.tabs.length - 1));
        state.error = null;
        if (state.tabs.length === 0 && !state.editingTrack) {
            loads.cancel();
            state = emptyState();
        } else {
            state.dirty = true;
        }
        refresh();
    }

    // ── Chargement ───────────────────────────────────────────

    /** Décode un fichier pour sa waveform ; seuls les pics restent (#36) */
    async function loadTab(target, session) {
        try {
            const bytes = await electronAPI.readAudioFile(target.readPath);
            if (!isLive(session, target)) return;
            const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const { duration, peaks } = await decodeForWaveform(arrayBuffer);
            if (!isLive(session, target)) return; // onglet retiré ou session quittée entre-temps

            Object.assign(target, { duration, peaks, view: fullView(duration), loading: false });
            if (target.keptSegments) {
                Object.assign(target, stateFromSegments(target.keptSegments, duration), { keptSegments: null });
            }
        } catch (error) {
            if (!isLive(session, target)) return;
            console.error('❌ Découpage : lecture du fichier impossible', error);
            target.loading = false;
            target.loadError = true; // fichier existant : ses versions restent telles quelles
        }
        refresh();
    }

    /** Retouche (✂) : un onglet par fichier découpé de la piste, ou aucun (#45) */
    function openTrack(track) {
        stopAudition();
        const session = loads.start();
        const segments = track.segments || {};
        state = {
            ...emptyState(),
            message: null,
            editingTrack: track,
            reservedNames: Object.keys(track.localPaths || {}).filter(name => !segments[name]),
        };
        state.tabs = sourceGroups(track).map(group => ({
            ...emptyTab(),
            localPath: group.localPath,
            readPath: group.localPath,
            originalPath: group.originalPath,
            keptSegments: Object.fromEntries(group.names.map(name => [name, segments[name]])),
        }));
        relabelTabs();
        $('split-title').value = track.title;
        refresh();
        state.tabs.forEach(target => loadTab(target, session));
    }

    async function addFile() {
        const [sourcePath] = await electronAPI.openFiles();
        if (!sourcePath) return;
        stopAudition();

        if (state.tabs.length === 0 && !state.editingTrack) {
            // Première source d'une nouvelle piste : nouvelle session
            loads.start();
            state = { ...emptyState(), message: null };
            $('split-title').value = baseName(sourcePath).replace(/\.[^.]+$/, '');
            await renderPlaylists();
        }
        const session = loads.current();
        const target = { ...emptyTab(), sourcePath, readPath: sourcePath, originalPath: sourcePath };
        state.tabs.push(target);
        relabelTabs();
        state.active = state.tabs.length - 1;
        state.error = null;
        state.dirty = true;
        refresh();

        await loadTab(target, session);
        if (target.loadError && isLive(session, target)) {
            // Nouveau fichier illisible : pas d'onglet, message comme avant (#24)
            removeTab(state.tabs.indexOf(target));
            state.message = { key: 'split.loadError' };
            refresh();
        }
    }

    async function renderPlaylists() {
        const container = $('split-playlists');
        container.innerHTML = '';
        const playlists = await electronAPI.getAllPlaylists();
        playlists.forEach(playlist => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = playlist.id;
            label.append(checkbox, ` ${playlist.name}`);
            container.append(label);
        });
    }

    // ── Écoute ───────────────────────────────────────────────

    function stopAudition() {
        if (audition) {
            clearInterval(audition.timer);
            audition.howl.unload();
            audition = null;
        }
        renderListenButton();
    }

    function startAudition(start, end) {
        stopAudition();
        stopLibraryPreview();
        const current = tab();
        if (!current?.peaks || end - start < 0.05) return;

        const howl = createHowl({
            src: [toFileUrl(current.readPath)],
            html5: true,
            sprite: { part: [start * 1000, (end - start) * 1000] },
            onend: stopAudition,
            onloaderror: stopAudition,
            onplayerror: stopAudition,
        });
        howl.play('part');
        audition = {
            howl,
            timer: setInterval(() => {
                const position = howl.seek();
                if (typeof position === 'number') {
                    current.playhead = position;
                    if (tab() === current) {
                        renderTime();
                        draw();
                    }
                }
            }, 50),
        };
        renderListenButton();
    }

    // ── Interactions waveform ────────────────────────────────

    function eventTime(event) {
        const rect = canvas.getBoundingClientRect();
        return xToTime(event.clientX - rect.left, tab().view, rect.width);
    }

    function cutAt(event) {
        const current = tab();
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const index = current.cuts.findIndex(cut => Math.abs(timeToX(cut, current.view, rect.width) - x) <= CUT_HIT_PX);
        return index === -1 ? null : index;
    }

    canvas.addEventListener('mousedown', event => {
        const current = tab();
        if (!current?.peaks) return;
        canvas.focus();
        const index = cutAt(event);
        if (index !== null) {
            current.selectedCut = index;
            drag = { index };
        } else {
            current.selectedCut = null;
            current.playhead = Math.min(Math.max(0, eventTime(event)), current.duration);
            if (audition) startAudition(current.playhead, current.duration);
        }
        refresh();
    });

    window.addEventListener('mousemove', event => {
        const current = tab();
        if (!drag || !current) return;
        current.cuts = moveCut(current.cuts, drag.index, eventTime(event), current.duration);
        state.dirty = true;
        renderSegments();
        draw();
    });

    window.addEventListener('mouseup', () => {
        drag = null;
    });

    canvas.addEventListener('wheel', event => {
        const current = tab();
        if (!current?.peaks) return;
        event.preventDefault();
        if (event.ctrlKey) {
            const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
            current.view = zoomView(current.view, factor, eventTime(event), current.duration);
        } else {
            const span = current.view.end - current.view.start;
            const delta = (event.deltaX || event.deltaY) / canvas.getBoundingClientRect().width * span;
            current.view = scrollView(current.view, delta, current.duration);
        }
        renderScroll();
        draw();
    }, { passive: false });

    canvas.addEventListener('keydown', event => {
        const current = tab();
        if (current?.selectedCut == null || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -NUDGE_SECONDS : NUDGE_SECONDS;
        current.cuts = moveCut(current.cuts, current.selectedCut, current.cuts[current.selectedCut] + delta, current.duration);
        state.dirty = true;
        refresh();
    });

    // ── Barre d'outils et actions ────────────────────────────

    $('split-scroll').addEventListener('input', event => {
        const current = tab();
        const span = current.view.end - current.view.start;
        current.view = scrollView({ start: Number(event.target.value), end: Number(event.target.value) + span }, 0, current.duration);
        draw();
    });

    const zoomAroundCenter = factor => {
        const current = tab();
        const center = (current.view.start + current.view.end) / 2;
        current.view = zoomView(current.view, factor, center, current.duration);
        renderScroll();
        draw();
    };
    $('split-zoom-in').addEventListener('click', () => zoomAroundCenter(ZOOM_STEP));
    $('split-zoom-out').addEventListener('click', () => zoomAroundCenter(1 / ZOOM_STEP));

    $('split-listen').addEventListener('click', () => {
        if (audition) stopAudition();
        else startAudition(tab().playhead, tab().duration);
    });

    $('split-cut').addEventListener('click', () => {
        const current = tab();
        const result = addCut(current.cuts, current.playhead, current.duration);
        if (!result) {
            state.error = { key: 'split.errorCutTooClose' };
        } else {
            current.names = splitNames(current.names, result.index);
            current.cuts = result.cuts;
            current.selectedCut = result.index;
            state.error = null;
            state.dirty = true;
        }
        refresh();
    });

    /** Une découpe non enregistrée ne se perd jamais sans confirmation (#33) */
    const canDiscard = () => !state.dirty || window.confirm(t('split.confirmDiscard'));

    $('split-add-file').addEventListener('click', addFile);

    $('split-remove-file').addEventListener('click', () => {
        const current = tab();
        if (!current) return;
        const hasVersions = current.names.some(name => name.trim()) || Object.keys(current.keptSegments || {}).length > 0;
        if (hasVersions && !window.confirm(t('split.confirmRemoveFile', { file: current.fileName }))) return;
        removeTab(state.active);
    });

    $('split-cancel').addEventListener('click', () => {
        loads.cancel();
        stopAudition();
        state = emptyState();
        refresh();
    });

    $('split-submit').addEventListener('click', async () => {
        if (state.tabs.some(target => target.loading)) return;
        const title = $('split-title').value.trim();
        const sources = state.tabs.map(target => (target.loadError
            ? { fileName: target.fileName, ranges: null, names: Object.keys(target.keptSegments || {}) }
            : { fileName: target.fileName, ranges: cutsToRanges(target.cuts, target.duration), names: target.names }));
        state.error = validateSources({ title, sources, reservedNames: state.reservedNames });
        if (state.error) {
            if (state.error.sourceIndex !== undefined && state.error.sourceIndex !== state.active) {
                stopAudition();
                state.active = state.error.sourceIndex; // affiche le fichier fautif
            }
            refresh();
            return;
        }

        const requests = sourceRequests(state.tabs);
        try {
            if (state.editingTrack) {
                await electronAPI.updateSources(state.editingTrack.id, requests, planLaunchVersion(state.editingTrack, requests));
            } else {
                const playlists = Array.from(root.querySelectorAll('#split-playlists input:checked')).map(cb => cb.value);
                await electronAPI.addSegmentedTrack({ title, sources: requests }, playlists);
            }
        } catch (error) {
            console.error('❌ Découpage : enregistrement impossible', error);
            state.error = { key: 'split.errorSave' };
            refresh();
            return;
        }

        const messageKey = state.editingTrack ? 'split.saved' : 'split.added';
        loads.cancel();
        stopAudition();
        state = { ...emptyState(), message: { key: messageKey, vars: { title } } };
        refresh();
        await onSaved();
    });

    new ResizeObserver(() => draw()).observe(canvas);
    refresh();

    return {
        /** Retouche d'une piste, découpée ou non (bouton ✂ de la bibliothèque, #45) */
        openTrack(track) {
            if (!canDiscard()) return;
            openTrack(track);
        },
        /** L'onglet devient visible : le canvas a enfin une taille */
        onShow: draw,
        /** Changement de langue */
        refresh,
        /** Onglet quitté ou lecture principale lancée : l'écoute ne doit pas continuer (#33) */
        stopListening: stopAudition,
    };
}
