import {
    addCut,
    cutsToRanges,
    formatTime,
    mergeNames,
    moveCut,
    parseTime,
    planSegmentUpdate,
    rangesToSegments,
    removeCut,
    splitNames,
    stateFromTrack,
    validateSplit,
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
        isCurrent: token => token === current,
        cancel: () => { current++; },
    };
}

const toFileUrl = path => (path.startsWith('http') || path.startsWith('file://') ? path : `file://${path}`);

/**
 * Contrôleur de l'onglet Découpage (#24). Toute la logique de découpe est
 * dans segmentModel.js / waveform.js ; ici uniquement DOM, souris, clavier et
 * écoute (Howl dédié, indépendant du lecteur principal).
 */
export function createCutterView({ root, electronAPI, t, createHowl, stopLibraryPreview, onSaved }) {
    const $ = id => root.querySelector(`#${id}`);
    const canvas = $('split-canvas');

    let state = emptyState();
    let audition = null; // { howl, timer }
    let drag = null; // { index } pendant le déplacement d'un point de coupe
    const loads = createLatestOnly();

    function emptyState() {
        return {
            sourcePath: null,
            fileName: '',
            duration: 0,
            peaks: null,
            cuts: [],
            names: [''],
            view: { start: 0, end: 0 },
            playhead: 0,
            selectedCut: null,
            editingTrack: null, // piste en retouche, sinon création
            reservedNames: [], // versions « fichier entier » de la piste en retouche
            loading: false,
            dirty: false, // découpe modifiée et non enregistrée (#33)
            message: { key: 'split.noFile' },
            error: null,
        };
    }

    // ── Rendu ────────────────────────────────────────────────

    function refresh() {
        const loaded = Boolean(state.peaks);
        $('split-file-name').textContent = state.fileName;
        $('split-message').textContent = state.message ? t(state.message.key, state.message.vars) : '';
        $('split-editor').classList.toggle('hidden', !loaded);
        $('split-choose-file').disabled = Boolean(state.editingTrack) || state.loading;
        $('split-submit').textContent = t(state.editingTrack ? 'split.save' : 'split.add');
        $('split-title').readOnly = Boolean(state.editingTrack);
        $('split-playlists-field').classList.toggle('hidden', Boolean(state.editingTrack));
        const errorEl = $('split-error');
        errorEl.textContent = state.error ? t(state.error.key, state.error.vars) : '';
        errorEl.classList.toggle('hidden', !state.error);
        renderListenButton();
        if (!loaded) return;
        renderScroll();
        renderTime();
        renderSegments();
        draw();
    }

    function renderListenButton() {
        $('split-listen').textContent = t(audition ? 'split.stopListening' : 'split.listen');
    }

    function renderTime() {
        $('split-time').textContent = `${formatTime(state.playhead)} / ${formatTime(state.duration)}`;
    }

    function renderScroll() {
        const scroll = $('split-scroll');
        const span = state.view.end - state.view.start;
        scroll.max = String(Math.max(0, state.duration - span));
        scroll.value = String(state.view.start);
        scroll.disabled = span >= state.duration;
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
        if (!state.peaks) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return; // onglet masqué : redessiné par onShow()
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(rect.width * ratio);
        canvas.height = Math.round(rect.height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawWaveform(ctx, {
            peaks: state.peaks,
            view: state.view,
            width: rect.width,
            height: rect.height,
            cuts: state.cuts,
            playhead: state.playhead,
            selectedCut: state.selectedCut,
            colors: colors(),
        });
    }

    function renderSegments() {
        const container = $('split-segments');
        container.innerHTML = '';
        const ranges = cutsToRanges(state.cuts, state.duration);

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
            end.title = t('split.segmentEnd');
            end.disabled = i === ranges.length - 1; // la fin du dernier segment = fin du fichier
            end.addEventListener('change', () => {
                const value = parseTime(end.value);
                if (value !== null) {
                    state.cuts = moveCut(state.cuts, i, value, state.duration);
                    state.dirty = true;
                }
                refresh(); // valeur invalide → revient à la précédente
            });

            const name = document.createElement('input');
            name.type = 'text';
            name.className = 'split-name';
            name.placeholder = t('split.segmentNamePlaceholder');
            name.value = state.names[i] || ''; // propriété value : jamais d'innerHTML pour du texte utilisateur
            name.addEventListener('input', () => {
                state.names[i] = name.value;
                state.dirty = true;
            });

            const play = document.createElement('button');
            play.type = 'button';
            play.className = 'secondary-btn';
            play.textContent = '▶';
            play.title = t('split.playSegment');
            play.addEventListener('click', () => startAudition(range.start, range.end));

            row.append(index, start, arrow, end, name, play);

            if (i > 0) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'danger-btn-small';
                remove.textContent = '✕';
                remove.title = t('split.removeCut');
                remove.addEventListener('click', () => {
                    state.names = mergeNames(state.names, i - 1);
                    state.cuts = removeCut(state.cuts, i - 1);
                    state.dirty = true;
                    state.selectedCut = null;
                    refresh();
                });
                row.append(remove);
            }
            container.append(row);
        });
    }

    // ── Chargement ───────────────────────────────────────────

    async function loadSource(sourcePath, track) {
        stopAudition();
        const load = loads.start();
        state = { ...emptyState(), loading: true, message: { key: 'split.loading' }, fileName: sourcePath.split(/[\\/]/).pop() };
        refresh();

        try {
            const bytes = await electronAPI.readAudioFile(sourcePath);
            if (!loads.isCurrent(load)) return;
            const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const { duration, peaks } = await decodeForWaveform(arrayBuffer);
            if (!loads.isCurrent(load)) return; // un autre chargement a pris la main

            state.sourcePath = sourcePath;
            state.duration = duration;
            state.peaks = peaks;
            state.view = fullView(duration);
            state.message = null;

            if (track) {
                const { cuts, names } = stateFromTrack(track, duration);
                state.cuts = cuts;
                state.names = names;
                state.editingTrack = track;
                state.reservedNames = Object.keys(track.localPaths || {}).filter(v => !(track.segments || {})[v]);
                $('split-title').value = track.title;
            } else {
                $('split-title').value = state.fileName.replace(/\.[^.]+$/, '');
                await renderPlaylists();
                if (!loads.isCurrent(load)) return;
            }
            state.loading = false;
        } catch (error) {
            if (!loads.isCurrent(load)) return;
            console.error('❌ Découpage : lecture du fichier impossible', error);
            state = { ...emptyState(), message: { key: 'split.loadError' } };
        }
        refresh();
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
        if (!state.sourcePath || end - start < 0.05) return;

        const howl = createHowl({
            src: [toFileUrl(state.sourcePath)],
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
                    state.playhead = position;
                    renderTime();
                    draw();
                }
            }, 50),
        };
        renderListenButton();
    }

    // ── Interactions waveform ────────────────────────────────

    function eventTime(event) {
        const rect = canvas.getBoundingClientRect();
        return xToTime(event.clientX - rect.left, state.view, rect.width);
    }

    function cutAt(event) {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const index = state.cuts.findIndex(cut => Math.abs(timeToX(cut, state.view, rect.width) - x) <= CUT_HIT_PX);
        return index === -1 ? null : index;
    }

    canvas.addEventListener('mousedown', event => {
        if (!state.peaks) return;
        canvas.focus();
        const index = cutAt(event);
        if (index !== null) {
            state.selectedCut = index;
            drag = { index };
        } else {
            state.selectedCut = null;
            state.playhead = Math.min(Math.max(0, eventTime(event)), state.duration);
            if (audition) startAudition(state.playhead, state.duration);
        }
        refresh();
    });

    window.addEventListener('mousemove', event => {
        if (!drag) return;
        state.cuts = moveCut(state.cuts, drag.index, eventTime(event), state.duration);
        state.dirty = true;
        renderSegments();
        draw();
    });

    window.addEventListener('mouseup', () => {
        drag = null;
    });

    canvas.addEventListener('wheel', event => {
        if (!state.peaks) return;
        event.preventDefault();
        if (event.ctrlKey) {
            const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
            state.view = zoomView(state.view, factor, eventTime(event), state.duration);
        } else {
            const span = state.view.end - state.view.start;
            const delta = (event.deltaX || event.deltaY) / canvas.getBoundingClientRect().width * span;
            state.view = scrollView(state.view, delta, state.duration);
        }
        renderScroll();
        draw();
    }, { passive: false });

    canvas.addEventListener('keydown', event => {
        if (state.selectedCut === null || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -NUDGE_SECONDS : NUDGE_SECONDS;
        state.cuts = moveCut(state.cuts, state.selectedCut, state.cuts[state.selectedCut] + delta, state.duration);
        state.dirty = true;
        refresh();
    });

    // ── Barre d'outils et actions ────────────────────────────

    $('split-scroll').addEventListener('input', event => {
        const span = state.view.end - state.view.start;
        state.view = scrollView({ start: Number(event.target.value), end: Number(event.target.value) + span }, 0, state.duration);
        draw();
    });

    const zoomAroundCenter = factor => {
        const center = (state.view.start + state.view.end) / 2;
        state.view = zoomView(state.view, factor, center, state.duration);
        renderScroll();
        draw();
    };
    $('split-zoom-in').addEventListener('click', () => zoomAroundCenter(ZOOM_STEP));
    $('split-zoom-out').addEventListener('click', () => zoomAroundCenter(1 / ZOOM_STEP));

    $('split-listen').addEventListener('click', () => {
        if (audition) stopAudition();
        else startAudition(state.playhead, state.duration);
    });

    $('split-cut').addEventListener('click', () => {
        const result = addCut(state.cuts, state.playhead, state.duration);
        if (!result) {
            state.error = { key: 'split.errorCutTooClose' };
        } else {
            state.names = splitNames(state.names, result.index);
            state.cuts = result.cuts;
            state.selectedCut = result.index;
            state.error = null;
            state.dirty = true;
        }
        refresh();
    });

    /** Une découpe non enregistrée ne se perd jamais sans confirmation (#33) */
    const canDiscard = () => !state.dirty || window.confirm(t('split.confirmDiscard'));

    $('split-choose-file').addEventListener('click', async () => {
        if (!canDiscard()) return;
        const [sourcePath] = await electronAPI.openFiles();
        if (sourcePath) await loadSource(sourcePath, null);
    });

    $('split-cancel').addEventListener('click', () => {
        loads.cancel();
        stopAudition();
        state = emptyState();
        refresh();
    });

    $('split-submit').addEventListener('click', async () => {
        const title = $('split-title').value.trim();
        const ranges = cutsToRanges(state.cuts, state.duration);
        state.error = validateSplit({ title, ranges, names: state.names, reservedNames: state.reservedNames });
        if (state.error) {
            refresh();
            return;
        }

        const segments = rangesToSegments(ranges, state.names);
        try {
            if (state.editingTrack) {
                const plan = planSegmentUpdate(state.editingTrack, segments);
                await electronAPI.updateSegments(state.editingTrack.id, plan.segments, plan.defaultVersion);
            } else {
                const playlists = Array.from(root.querySelectorAll('#split-playlists input:checked')).map(cb => cb.value);
                await electronAPI.addSegmentedTrack({ title, sourcePath: state.sourcePath, segments }, playlists);
            }
        } catch (error) {
            console.error('❌ Découpage : enregistrement impossible', error);
            state.error = { key: 'split.errorSave' };
            refresh();
            return;
        }

        const messageKey = state.editingTrack ? 'split.saved' : 'split.added';
        stopAudition();
        state = { ...emptyState(), message: { key: messageKey, vars: { title } } };
        refresh();
        await onSaved();
    });

    new ResizeObserver(() => draw()).observe(canvas);
    refresh();

    return {
        /** Retouche d'une piste découpée (bouton ✂ de la bibliothèque) */
        openTrack(track) {
            if (!canDiscard()) return;
            const segmentedName = Object.keys(track.segments || {})[0];
            const sourcePath = segmentedName && track.localPaths?.[segmentedName];
            if (sourcePath) loadSource(sourcePath, track);
        },
        /** L'onglet devient visible : le canvas a enfin une taille */
        onShow: draw,
        /** Changement de langue */
        refresh,
        /** Onglet quitté ou lecture principale lancée : l'écoute ne doit pas continuer (#33) */
        stopListening: stopAudition,
    };
}
