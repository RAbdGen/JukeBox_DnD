/**
 * Synchronisation BPM entre versions (#18, mode avancé) : `track.tempo =
 * { versionName: { bpm, offsetMs } }` (décalage du premier temps). Si les deux
 * versions d'un changement en ont un, la reprise se cale sur le même nombre de
 * temps écoulés ; sinon le comportement par défaut s'applique. Pas de
 * time-stretching : seul le point d'entrée est calculé.
 */

export const MIN_BPM = 20;
export const MAX_BPM = 400;

/**
 * Z2 = (Z1 − Y1) × (X1 / X2) + Y2, en secondes.
 * @param {object} params
 * @param {{ bpm: number, offsetMs: number }} [params.from] - Tempo de la version quittée
 * @param {{ bpm: number, offsetMs: number }} [params.to] - Tempo de la version cible
 * @param {number} params.position - Z1 : position dans la version quittée (s)
 * @param {number} params.targetDuration - Durée jouée de la cible (s), 0 si inconnue
 * @returns {number|null} Z2 (≥ 0), ou null si l'une des deux versions n'a pas de tempo
 */
export function beatSyncedPosition({ from, to, position, targetDuration }) {
    if (!from || !to) return null;

    const firstBeatFrom = from.offsetMs / 1000;
    const firstBeatTo = to.offsetMs / 1000;
    // Le premier temps n'est qu'un repère (#60) : avant lui l'écart est négatif et
    // se reporte tel quel avant le premier temps de la cible, plafonné à son début
    const synced = (position - firstBeatFrom) * (from.bpm / to.bpm) + firstBeatTo;
    return wrapIntoLoop(Math.max(0, synced), targetDuration, firstBeatTo);
}

/**
 * Au-delà de la fin de la cible : les versions bouclent, on est dans un tour
 * suivant. On retranche la zone bouclée (après le premier temps) autant de
 * fois que nécessaire, dans tous les modes (#50, revient sur #48). Durée
 * inconnue (0, cible pas encore chargée) : position inchangée, à reprendre
 * une fois la durée connue.
 */
export function wrapIntoLoop(position, targetDuration, firstBeat = 0) {
    if (!(targetDuration > 0) || position < targetDuration) return position;
    const loopedZone = targetDuration - firstBeat;
    return loopedZone > 0 ? firstBeat + ((position - firstBeat) % loopedZone) : firstBeat;
}

/**
 * Tap tempo (#56, #61) : à chaque tap, le BPM de la droite ajustée (moindres
 * carrés) sur les temps des derniers taps, arrondi au dixième, ou null (premier
 * tap, résultat hors 20–400 BPM). Tous les taps comptent, donc les écarts d'un
 * humain se compensent et un début approximatif pèse peu ; seuls les `maxTaps`
 * derniers sont gardés. Une pause plus longue que `resetAfterMs` recommence le
 * comptage.
 * @returns {(now: number) => number|null} Appeler avec l'horodatage du tap (ms)
 */
export function createTapTempo({ maxTaps = 20, resetAfterMs = 3000 } = {}) {
    let taps = [];
    return now => {
        if (taps.length > 0 && now - taps.at(-1) > resetAfterMs) taps = [];
        taps = [...taps, now].slice(-maxTaps);
        if (taps.length < 2) return null;

        // Pente de t = a + pente × rang : durée moyenne entre deux taps
        const meanRank = (taps.length - 1) / 2;
        const meanTime = taps.reduce((sum, time) => sum + time, 0) / taps.length;
        let covariance = 0;
        let variance = 0;
        taps.forEach((time, rank) => {
            covariance += (rank - meanRank) * (time - meanTime);
            variance += (rank - meanRank) ** 2;
        });
        const bpm = Math.round((60000 * variance / covariance) * 10) / 10;
        return bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : null;
    };
}

/**
 * Garde les tempos valides (BPM 20–400, décalage ≥ 0, absent = 0) des versions
 * existantes. Undefined s'il ne reste rien.
 */
export function sanitizeTempo(tempo, versionNames) {
    if (!tempo || typeof tempo !== 'object') return undefined;

    const clean = {};
    for (const [name, entry] of Object.entries(tempo)) {
        if (!entry || !versionNames.includes(name)) continue;
        const bpm = Number(entry.bpm);
        const offsetMs = entry.offsetMs === undefined || entry.offsetMs === null || entry.offsetMs === ''
            ? 0
            : Number(entry.offsetMs);
        if (Number.isFinite(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM && Number.isFinite(offsetMs) && offsetMs >= 0) {
            clean[name] = { bpm, offsetMs };
        }
    }
    return Object.keys(clean).length > 0 ? clean : undefined;
}
