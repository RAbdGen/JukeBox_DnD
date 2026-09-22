/**
 * Retourne le volume normalisé d'une piste, y compris la valeur valide 0.
 * Les anciennes pistes qui ne portent pas encore ce champ conservent 50 %.
 */
export function getPreviewVolume(track) {
    return track.defaultVolume ?? 0.5;
}
