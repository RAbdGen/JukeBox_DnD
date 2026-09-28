/**
 * Pistes découpées (#24) : `segments = { versionName: { start, end } }` en
 * secondes, toutes les versions découpées pointant sur le même fichier copié
 * une fois (`<trackId>_source<ext>`). Module pur, partagé par DatabaseManager
 * et electron/main.cjs (import dynamique).
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

export function buildSegmentedTrack({
    trackId, title, sourcePath, localPath, segments, selectedPlaylists = [], now = new Date(),
}) {
    const names = orderedSegmentNames(segments);
    if (names.length === 0) throw new Error('Aucun segment nommé');

    const timestamp = now.toISOString();
    return {
        id: trackId,
        title,
        originalPaths: Object.fromEntries(names.map(name => [name, sourcePath])),
        localPaths: Object.fromEntries(names.map(name => [name, localPath])),
        segments: Object.fromEntries(names.map(name => [name, { start: segments[name].start, end: segments[name].end }])),
        defaultVersion: names[0],
        defaultVolume: 0.5,
        metadata: { addedAt: timestamp, modifiedAt: timestamp },
        inPlaylists: selectedPlaylists,
    };
}

/**
 * Retouche d'une découpe : remplace les versions découpées par `segments`
 * (même fichier partagé), garde les versions « fichier entier » après elles.
 */
export function applySegmentUpdate(track, segments, defaultVersion) {
    const oldSegmented = Object.keys(track.segments || {});
    if (oldSegmented.length === 0) throw new Error(`La piste ${track.id} n'est pas découpée`);

    const oldLocal = track.localPaths || {};
    const oldOriginal = track.originalPaths || {};
    const sharedLocal = oldLocal[oldSegmented[0]];
    const sharedOriginal = oldOriginal[oldSegmented[0]] ?? sharedLocal;
    const fullFileNames = Object.keys(oldLocal).filter(name => !oldSegmented.includes(name));

    const names = orderedSegmentNames(segments);
    if (names.length === 0) throw new Error('Aucun segment nommé');
    const clash = names.find(name => fullFileNames.includes(name));
    if (clash) throw new Error(`Nom de version déjà utilisé : ${clash}`);

    track.localPaths = {
        ...Object.fromEntries(names.map(name => [name, sharedLocal])),
        ...Object.fromEntries(fullFileNames.map(name => [name, oldLocal[name]])),
    };
    track.originalPaths = {
        ...Object.fromEntries(names.map(name => [name, sharedOriginal])),
        ...Object.fromEntries(fullFileNames.map(name => [name, oldOriginal[name] ?? oldLocal[name]])),
    };
    track.segments = Object.fromEntries(
        names.map(name => [name, { start: segments[name].start, end: segments[name].end }]),
    );

    const allNames = Object.keys(track.localPaths);
    if (allNames.includes(defaultVersion)) {
        track.defaultVersion = defaultVersion;
    } else if (!allNames.includes(track.defaultVersion)) {
        track.defaultVersion = allNames[0];
    }
    return track;
}
