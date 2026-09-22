/**
 * Prépare un export de bibliothèque avant sa fusion dans la DB locale.
 * Les pistes déjà présentes sont conservées pour que DatabaseManager compte
 * correctement les éléments ignorés, mais leurs fichiers ne sont jamais copiés.
 *
 * @param {{ library?: Array, playlists?: Array }} payload
 * @param {string} musicDir
 * @param {{ getLibrary: () => Promise<Array>, mergeImportedLibrary: (data: Object) => Promise<Object> }} dbManager
 * @param {{ importTrackFiles: (paths: Object, directory: string) => Promise<Object> }} fileManager
 * @returns {Promise<Object>}
 */
export async function importLibraryPayload(payload, musicDir, dbManager, fileManager) {
    const knownTrackIds = new Set((await dbManager.getLibrary()).map(track => track.id));
    const library = [];

    for (const track of payload.library || []) {
        if (knownTrackIds.has(track.id)) {
            library.push(track);
            continue;
        }

        knownTrackIds.add(track.id);
        const localPaths = await fileManager.importTrackFiles(track.localPaths || {}, musicDir);
        library.push({ ...track, localPaths });
    }

    return dbManager.mergeImportedLibrary({
        library,
        playlists: payload.playlists || [],
    });
}
