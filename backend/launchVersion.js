/**
 * Version de lancement d'une piste (#25) : celle choisie par l'utilisateur
 * (`track.launchVersion`) si elle existe encore, sinon la première version.
 * `defaultVersion` (historique, « calm » par défaut même sans version calm)
 * n'est volontairement plus lu.
 * @param {string[]} versionNames - Versions de la piste, dans leur ordre
 * @param {string} [launchVersion]
 * @returns {string|null}
 */
export function resolveLaunchVersion(versionNames, launchVersion) {
    if (launchVersion && versionNames.includes(launchVersion)) return launchVersion;
    return versionNames[0] ?? null;
}
