/**
 * Pistes découpées (#24) : `segments = { versionName: { start, end } }` en
 * secondes. Les versions découpées d'un même fichier pointent sur sa copie
 * (`<trackId>_source<ext>`, copiée une fois) ; une piste peut découper
 * plusieurs fichiers (#45) : une « source » = les versions découpées qui
 * partagent un `localPath` (jamais stockée, voir sourceGroups). Module pur,
 * partagé par DatabaseManager et electron/main.cjs (import dynamique).
 */

export const SOURCE_VERSION_KEY = 'source';

/**
 * Signature insensible à l'ordre des versions : sert à savoir si une piste
 * déjà chargée par AudioManager doit être reconstruite (#32).
 */
export function trackSignature(versions = {}, segments = {}) {
    return JSON.stringify(
        Object.keys(versions || {}).sort().map(name => [name, versions[name], segments?.[name] ?? null]),
    );
}

export function orderedSegmentNames(segments = {}) {
    return Object.keys(segments || {}).sort((a, b) => segments[a].start - segments[b].start);
}

/**
 * Garde uniquement les segments valides (bornes numériques, 0 <= start < end)
 * de versions existantes. Undefined s'il ne reste rien.
 */
export function sanitizeSegments(segments, localPaths = {}) {
    if (!segments || typeof segments !== 'object') return undefined;

    const clean = {};
    for (const [name, segment] of Object.entries(segments)) {
        if (!segment || !Object.hasOwn(localPaths || {}, name)) continue;
        const start = Number(segment.start);
        const end = Number(segment.end);
        if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) {
            clean[name] = { start, end };
        }
    }
    return Object.keys(clean).length > 0 ? clean : undefined;
}

/** Le fichier de cette version est-il encore utilisé par une autre version ? */
export function isPathSharedByOtherVersion(track, versionName) {
    const paths = track?.localPaths || {};
    const target = paths[versionName];
    return Boolean(target) && Object.entries(paths).some(([name, p]) => name !== versionName && p === target);
}

export function uniquePaths(localPaths = {}) {
    return [...new Set(Object.values(localPaths || {}).filter(Boolean))];
}

/** Versions nommées des sources, dans l'ordre des sources puis des segments */
function flattenSources(sources = []) {
    return sources.flatMap(source => orderedSegmentNames(source.segments)
        .map(name => ({ name, source, segment: source.segments[name] })));
}

function assertUniqueNames(names) {
    const seen = new Set();
    for (const name of names) {
        const key = name.trim().toLowerCase();
        if (seen.has(key)) throw new Error(`Nom de version déjà utilisé : ${name}`);
        seen.add(key);
    }
}

const copySegment = ({ start, end }) => ({ start, end });

/**
 * Sources d'une piste (#45) : ordre d'apparition dans localPaths, noms triés
 * par début de segment. Les versions « fichier entier » n'en font pas partie.
 */
export function sourceGroups(track) {
    const segments = track?.segments || {};
    const originalPaths = track?.originalPaths || {};
    const groups = new Map();
    for (const [name, localPath] of Object.entries(track?.localPaths || {})) {
        if (!segments[name] || !localPath) continue;
        if (!groups.has(localPath)) groups.set(localPath, { localPath, originalPath: originalPaths[name] ?? localPath, names: [] });
        groups.get(localPath).names.push(name);
    }
    return [...groups.values()].map(group => ({
        ...group,
        names: group.names.sort((a, b) => segments[a].start - segments[b].start),
    }));
}

export function buildSegmentedTrack({ trackId, title, sources, selectedPlaylists = [], now = new Date() }) {
    const entries = flattenSources(sources);
    if (entries.length === 0) throw new Error('Aucun segment nommé');
    assertUniqueNames(entries.map(entry => entry.name));

    const timestamp = now.toISOString();
    return {
        id: trackId,
        title,
        originalPaths: Object.fromEntries(entries.map(({ name, source }) => [name, source.sourcePath])),
        localPaths: Object.fromEntries(entries.map(({ name, source }) => [name, source.localPath])),
        segments: Object.fromEntries(entries.map(({ name, segment }) => [name, copySegment(segment)])),
        defaultVersion: entries[0].name,
        defaultVolume: 0.5,
        metadata: { addedAt: timestamp, modifiedAt: timestamp },
        inPlaylists: selectedPlaylists,
    };
}

/**
 * Retouche (#45) : `sources` remplace toutes les versions découpées (chacune
 * sur son fichier) ; les versions « fichier entier » sont gardées, après.
 * Lève une erreur (piste non modifiée) sur un nom en double ou s'il ne
 * resterait aucune version.
 */
export function applySourcesUpdate(track, sources) {
    const segmented = new Set(Object.keys(track.segments || {}));
    const oldLocal = track.localPaths || {};
    const oldOriginal = track.originalPaths || {};
    const fullFileNames = Object.keys(oldLocal).filter(name => !segmented.has(name));
    const entries = flattenSources(sources);

    assertUniqueNames([...entries.map(entry => entry.name), ...fullFileNames]);
    if (entries.length + fullFileNames.length === 0) throw new Error(`La piste ${track.id} n'aurait plus aucune version`);

    track.localPaths = {
        ...Object.fromEntries(entries.map(({ name, source }) => [name, source.localPath])),
        ...Object.fromEntries(fullFileNames.map(name => [name, oldLocal[name]])),
    };
    track.originalPaths = {
        ...Object.fromEntries(entries.map(({ name, source }) => [name, source.originalPath ?? source.localPath])),
        ...Object.fromEntries(fullFileNames.map(name => [name, oldOriginal[name] ?? oldLocal[name]])),
    };
    if (entries.length > 0) {
        track.segments = Object.fromEntries(entries.map(({ name, segment }) => [name, copySegment(segment)]));
    } else {
        delete track.segments;
    }
    return track;
}

/** Fichiers qui ne servent plus à aucune version après une retouche */
export function unusedPaths(before = {}, after = {}) {
    const kept = new Set(uniquePaths(after));
    return uniquePaths(before).filter(path => !kept.has(path));
}

/**
 * Création ou retouche d'une piste découpée (#45) : copie des nouveaux
 * fichiers, enregistrement, puis suppression des fichiers devenus inutiles.
 * Enregistrement refusé : les copies sont supprimées, rien d'autre ne bouge.
 */
export async function persistSources({ requests, reservedPaths = [], copyFile, deleteFile, persist }) {
    const copied = [];
    let saved;
    try {
        const sources = [];
        for (const request of requests) {
            if (request.sourcePath) {
                const localPath = await copyFile(request.sourcePath, [...reservedPaths, ...copied]);
                copied.push(localPath);
                sources.push({ localPath, originalPath: request.sourcePath, segments: request.segments });
            } else {
                sources.push({ localPath: request.localPath, segments: request.segments });
            }
        }
        saved = await persist(sources, copied);
    } catch (error) {
        for (const path of copied) await deleteFile(path);
        throw error;
    }
    for (const path of saved.unusedPaths || []) await deleteFile(path);
    return saved.result;
}
