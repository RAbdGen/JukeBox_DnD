/**
 * Durée de fondu (crossfade) entre versions, réglable par piste.
 *
 * Depuis #28, exprimée en secondes (`track.crossfadeDurationSeconds`).
 * L'ancien réglage en pourcentage de la durée de la piste
 * (`track.crossfadeDurationPercent`, #17) n'est plus que lu, pour migrer :
 * sa conversion exacte dépend de la durée réelle du fichier audio, inconnue
 * de la base — la migration se fait donc dès que cette durée est connue
 * (chargement Howler, ou ouverture de la modal d'édition).
 */

export const DEFAULT_CROSSFADE_DURATION_SECONDS = 5;
export const MIN_CROSSFADE_DURATION_SECONDS = 0; // 0 = aucun fondu (bascule immédiate)
export const MAX_CROSSFADE_DURATION_SECONDS = 10;
export const CROSSFADE_DURATION_STEP_SECONDS = 0.5;

// Ancien format (#17) : fraction de la durée de la piste, bornée à 500–5000 ms
export const DEFAULT_CROSSFADE_DURATION_PERCENT = 0.1;
export const MIN_CROSSFADE_DURATION_PERCENT = 0.01;
export const MAX_CROSSFADE_DURATION_PERCENT = 0.3;
const LEGACY_MIN_SECONDS = 0.5;
const LEGACY_MAX_SECONDS = 5;
const LEGACY_FALLBACK_TRACK_SECONDS = 30; // durée supposée si inconnue (comportement historique)

/**
 * Garantit qu'une durée stockée ou importée reste dans la plage proposée
 * par l'interface (0–10 s, 0 = aucun fondu). Toute valeur invalide retombe sur la valeur par défaut.
 */
export function normalizeCrossfadeDurationSeconds(value) {
    const numericValue = Number(value);
    if (value === null || value === undefined || value === ''
        || !Number.isFinite(numericValue)
        || numericValue < MIN_CROSSFADE_DURATION_SECONDS
        || numericValue > MAX_CROSSFADE_DURATION_SECONDS) {
        return DEFAULT_CROSSFADE_DURATION_SECONDS;
    }

    return numericValue;
}

/**
 * Ancien format : garantit un pourcentage dans la plage de l'ancienne
 * interface (1–30 %). Toute valeur invalide retombe sur 10 %.
 */
export function normalizeCrossfadeDurationPercent(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)
        || numericValue < MIN_CROSSFADE_DURATION_PERCENT
        || numericValue > MAX_CROSSFADE_DURATION_PERCENT) {
        return DEFAULT_CROSSFADE_DURATION_PERCENT;
    }

    return numericValue;
}

/**
 * Convertit un ancien réglage en pourcentage vers la durée en secondes
 * réellement entendue jusqu'ici : même calcul que l'ancien Track.crossfade()
 * (% × durée de la piste, borné à 0,5–5 s), arrondi au pas du curseur.
 * @param {number} percent - Ancien réglage (fraction, ex: 0.1)
 * @param {number} [trackDurationSeconds] - Durée réelle du fichier
 */
export function legacyPercentToSeconds(percent, trackDurationSeconds) {
    const duration = Number.isFinite(trackDurationSeconds) && trackDurationSeconds > 0
        ? trackDurationSeconds
        : LEGACY_FALLBACK_TRACK_SECONDS;
    const seconds = Math.min(Math.max(
        normalizeCrossfadeDurationPercent(percent) * duration,
        LEGACY_MIN_SECONDS,
    ), LEGACY_MAX_SECONDS);
    const rounded = Math.round(seconds / CROSSFADE_DURATION_STEP_SECONDS) * CROSSFADE_DURATION_STEP_SECONDS;
    return normalizeCrossfadeDurationSeconds(rounded);
}
