export const DEFAULT_CROSSFADE_DURATION_PERCENT = 0.1;
export const MIN_CROSSFADE_DURATION_PERCENT = 0.01;
export const MAX_CROSSFADE_DURATION_PERCENT = 0.3;

/**
 * Garantit qu'une durée stockée ou importée reste dans la plage proposée
 * par l'interface (1–30 %). Toute valeur invalide retombe sur 10 %.
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
 * Compatibilité de l'API audio historique : un appel direct à crossfade()
 * peut fournir n'importe quel pourcentage valide de 0 à 100 %. Les limites
 * réelles de 500–5000 ms restent appliquées par Track.crossfade().
 */
export function normalizeCrossfadeOverridePercent(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1) {
        return DEFAULT_CROSSFADE_DURATION_PERCENT;
    }

    return numericValue;
}
