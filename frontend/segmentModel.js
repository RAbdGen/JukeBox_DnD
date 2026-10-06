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
 * Validation d'une découpe à un ou plusieurs fichiers (#45).
 * `ranges: null` = fichier illisible : seuls ses noms (versions conservées)
 * comptent, pour les doublons.
 * @returns {{ key: string, vars?: object, sourceIndex?: number } | null}
 *   première erreur (clé i18n, fichier fautif), ou null
 */
export function validateSources({ title, sources, reservedNames = [] }) {
    if (!title || !title.trim()) return { key: 'split.errorTitle' };
    if (sources.length === 0 && reservedNames.length === 0) return { key: 'split.errorNoNamed' };

    const seen = new Map(reservedNames.map(name => [name.trim().toLowerCase(), null])); // nom → fichier (null : version entière)
    for (const [sourceIndex, source] of sources.entries()) {
        const named = source.ranges
            ? source.ranges.map((range, i) => ({ ...range, name: (source.names[i] || '').trim() })).filter(range => range.name)
            : source.names.map(name => ({ name: name.trim() }));
        if (named.length === 0) return { key: 'split.errorNoNamedIn', vars: { file: source.fileName }, sourceIndex };

        for (const range of named) {
            const key = range.name.toLowerCase();
            if (seen.has(key)) {
                const file = seen.get(key);
                return file === null
                    ? { key: 'split.errorDuplicate', vars: { name: range.name }, sourceIndex }
                    : { key: 'split.errorDuplicateIn', vars: { name: range.name, file }, sourceIndex };
            }
            seen.set(key, source.fileName);
        }
        if (source.ranges && named.some(range => range.end - range.start < MIN_SEGMENT_SECONDS - EPSILON)) {
            return { key: 'split.errorTooShort', sourceIndex };
        }
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
 * Rouvre la découpe d'un fichier : coupes = bornes de ses segments (hors 0 et
 * durée, bornées au fichier réellement décodé), noms = segment couvrant
 * chaque plage.
 */
export function stateFromSegments(segments, duration) {
    segments = segments || {};
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

/**
 * Requêtes d'enregistrement, une par onglet (#45) : fichier déjà dans la piste
 * (localPath) ou nouveau (sourcePath). Un fichier illisible renvoie ses
 * segments d'origine tels quels : jamais supprimés en silence.
 */
export function sourceRequests(tabs) {
    return tabs.map(tab => {
        const segments = tab.loadError
            ? tab.keptSegments
            : rangesToSegments(cutsToRanges(tab.cuts, tab.duration), tab.names);
        return tab.localPath ? { localPath: tab.localPath, segments } : { sourcePath: tab.sourcePath, segments };
    });
}

/**
 * Retouche : la version de lancement découpée suit son segment (même
 * position, même fichier) ; version entière inchangée ; undefined si son
 * fichier est retiré ou sa plage n'est plus nommée.
 */
export function planLaunchVersion(track, requests) {
    const launch = track.launchVersion;
    if (!launch) return undefined;
    const old = (track.segments || {})[launch];
    if (!old) return launch; // version entière : inchangée
    const source = requests.find(request => request.localPath && request.localPath === track.localPaths?.[launch]);
    if (!source) return undefined;
    const middle = (old.start + old.end) / 2;
    return Object.keys(source.segments).find(name => source.segments[name].start <= middle && middle < source.segments[name].end);
}

/**
 * Libellés des onglets de fichiers (#45) : le nom du fichier, précédé de son
 * dossier quand deux fichiers portent le même nom (sinon onglets et messages
 * d'erreur ne se distinguent plus).
 */
export function fileLabels(paths) {
    const parts = paths.map(path => path.split(/[\\/]/).filter(Boolean));
    const names = parts.map(segments => segments.at(-1) || '');
    return parts.map((segments, i) => {
        const clash = names.some((name, j) => j !== i && name.toLowerCase() === names[i].toLowerCase());
        return clash && segments.length > 1 ? `${segments.at(-2)}/${names[i]}` : names[i];
    });
}
