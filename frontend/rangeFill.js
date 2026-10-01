/**
 * Partie remplie des curseurs thémés (#39). Le Chromium d'Electron ne sait pas
 * colorer la partie d'un input range située avant la poignée : la piste est
 * donc un dégradé coupé à var(--fill), que ce module tient à jour.
 */

/** Part remplie (0–100) d'un curseur ; 0 si rien à parcourir ou valeur invalide */
export function rangeFillPercent(value, min, max) {
    const v = Number(value);
    const lo = Number(min);
    const hi = Number(max);
    if (!Number.isFinite(v) || !(hi > lo)) return 0;
    return Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
}

export function syncRangeFill(input) {
    input.style.setProperty('--fill', `${rangeFillPercent(input.value, input.min || 0, input.max || 100)}%`);
}

/**
 * Suit chaque curseur : saisie de l'utilisateur, `.value = …` posé par le code
 * (ouverture de modal, mute progressif, défilement du Découpage) et changement
 * de min/max. Le setter est remplacé sur l'élément lui-même plutôt qu'à chaque
 * appel, pour qu'aucun code futur ne puisse oublier de resynchroniser.
 */
export function initRangeFill(root = document) {
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const observer = new MutationObserver(records => {
        for (const record of records) syncRangeFill(record.target);
    });

    for (const input of root.querySelectorAll('input[type="range"]')) {
        Object.defineProperty(input, 'value', {
            configurable: true,
            get() {
                return nativeValue.get.call(this);
            },
            set(value) {
                nativeValue.set.call(this, value);
                syncRangeFill(this);
            },
        });
        input.addEventListener('input', () => syncRangeFill(input));
        observer.observe(input, { attributes: true, attributeFilter: ['min', 'max', 'value'] });
        syncRangeFill(input);
    }
}
