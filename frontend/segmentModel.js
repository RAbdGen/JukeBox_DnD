import { orderedSegmentNames } from '../backend/segments.js';

/**
 * Logique pure de l'onglet Découpage (#24) : points de coupe (secondes, au
 * dixième), plages consécutives entre ces coupes, noms des plages (vide =
 * plage ignorée), validation et passage vers/depuis `track.segments`.
 */

export const MIN_SEGMENT_SECONDS = 0.5;
const EPSILON = 1e-9;

const roundTenth = value => Math.round(value * 10) / 10;

export function cutsToRanges(cuts, duration) {
    const bounds = [0, ...cuts, duration];
    return bounds.slice(0, -1).map((start, i) => ({ start, end: bounds[i + 1] }));
}

export function addCut(cuts, time, duration) {
    const value = roundTenth(time);
    if (value < MIN_SEGMENT_SECONDS - EPSILON || value > duration - MIN_SEGMENT_SECONDS + EPSILON) return null;
    if (cuts.some(cut => Math.abs(cut - value) < MIN_SEGMENT_SECONDS - EPSILON)) return null;

    const next = [...cuts, value].sort((a, b) => a - b);
    return { cuts: next, index: next.indexOf(value) };
}

export function moveCut(cuts, index, time, duration) {
    const lower = (index === 0 ? 0 : cuts[index - 1]) + MIN_SEGMENT_SECONDS;
    const upper = (index === cuts.length - 1 ? duration : cuts[index + 1]) - MIN_SEGMENT_SECONDS;
    if (lower > upper) return cuts;

    const next = [...cuts];
    next[index] = roundTenth(Math.min(Math.max(time, lower), upper));
    return next;
}

export function removeCut(cuts, index) {
    return cuts.filter((_, i) => i !== index);
}

/** Après addCut(…).index : la plage coupée garde son nom, la nouvelle est vide */
export function splitNames(names, cutIndex) {
    const next = [...names];
    next.splice(cutIndex + 1, 0, '');
    return next;
}

/** Suppression de la coupe cutIndex : ses deux plages fusionnent */
export function mergeNames(names, cutIndex) {
    const next = [...names];
    const merged = (next[cutIndex] || '').trim() ? next[cutIndex] : (next[cutIndex + 1] || '');
    next.splice(cutIndex, 2, merged);
    return next;
}

export function formatTime(seconds) {
    const tenths = Math.max(0, Math.round(seconds * 10));
    const minutes = Math.floor(tenths / 600);
    const rest = (tenths % 600) / 10;
    return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

export function parseTime(text) {
    const match = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(String(text).trim());
    if (!match) return null;
    const seconds = Number(match[2].replace(',', '.'));
    if (match[1] !== undefined && seconds >= 60) return null;
    return roundTenth(Number(match[1] || 0) * 60 + seconds);
}

/**
 * @returns {{ key: string, vars?: object } | null} première erreur (clé i18n), ou null
 */
export function validateSplit({ title, ranges, names, reservedNames = [] }) {
    if (!title || !title.trim()) return { key: 'split.errorTitle' };

    const named = ranges
        .map((range, i) => ({ ...range, name: (names[i] || '').trim() }))
        .filter(range => range.name);
    if (named.length === 0) return { key: 'split.errorNoNamed' };

    const seen = new Set(reservedNames.map(name => name.trim().toLowerCase()));
    for (const range of named) {
        const key = range.name.toLowerCase();
        if (seen.has(key)) return { key: 'split.errorDuplicate', vars: { name: range.name } };
        seen.add(key);
    }

    if (named.some(range => range.end - range.start < MIN_SEGMENT_SECONDS - EPSILON)) {
        return { key: 'split.errorTooShort' };
    }
    return null;
}

export function rangesToSegments(ranges, names) {
    const segments = {};
    ranges.forEach((range, i) => {
        const name = (names[i] || '').trim();
        if (name) segments[name] = { start: range.start, end: range.end };
    });
    return segments;
}

/**
 * Rouvre une découpe : coupes = bornes des segments (hors 0 et durée,
 * bornées au fichier réellement décodé), noms = segment couvrant chaque plage.
 */
export function stateFromTrack(track, duration) {
    const segments = track.segments || {};
    const bounds = new Set();
    for (const { start, end } of Object.values(segments)) {
        bounds.add(roundTenth(Math.min(Math.max(start, 0), duration)));
        bounds.add(roundTenth(Math.min(Math.max(end, 0), duration)));
    }
    const cuts = [...bounds]
        .filter(value => value >= MIN_SEGMENT_SECONDS && value <= duration - MIN_SEGMENT_SECONDS)
        .sort((a, b) => a - b);

    const names = cutsToRanges(cuts, duration).map(range => {
        const middle = (range.start + range.end) / 2;
        return Object.keys(segments).find(name => segments[name].start <= middle && middle < segments[name].end) || '';
    });
    return { cuts, names };
}

/** Retouche : la version de lancement suit son segment (position), sinon inchangée */
export function planSegmentUpdate(track, segments) {
    const old = track.segments || {};
    let defaultVersion = track.defaultVersion;

    if (old[defaultVersion]) {
        const middle = (old[defaultVersion].start + old[defaultVersion].end) / 2;
        defaultVersion = Object.keys(segments).find(name => segments[name].start <= middle && middle < segments[name].end)
            ?? orderedSegmentNames(segments)[0];
    }
    return { segments, defaultVersion };
}
