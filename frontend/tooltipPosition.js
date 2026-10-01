/**
 * Logique pure des tooltips thémés (#38), sans DOM : placement de la bulle,
 * détection des éléments sans libellé visible, et minuterie d'ouverture
 * (délai au survol, puis ouverture immédiate juste après une fermeture,
 * comme le Tooltip de Radix/shadcn).
 */

export const OPEN_DELAY_MS = 500;  // rien ne surgit quand la souris ne fait que passer
export const SKIP_DELAY_MS = 300;  // glisser d'un bouton au voisin rouvre aussitôt

const OFFSET = 8;        // écart entre l'élément et la bulle (flèche comprise)
const MARGIN = 8;        // marge minimale avec les bords de la fenêtre
const ARROW_INSET = 10;  // la flèche ne touche jamais les coins arrondis

/**
 * @param {object} params
 * @param {{left: number, top: number, width: number, height: number}} params.trigger - Rectangle de l'élément
 * @param {{width: number, height: number}} params.tip - Taille de la bulle
 * @param {{width: number, height: number}} params.viewport - Taille de la fenêtre
 * @returns {{side: 'top'|'bottom', left: number, top: number, arrowLeft: number}}
 *   Position de la bulle (coordonnées fenêtre) et de la flèche (relative à la bulle)
 */
export function placeTooltip({ trigger, tip, viewport }) {
    const above = trigger.top - OFFSET - tip.height;
    const below = trigger.top + trigger.height + OFFSET;
    const fitsBelow = below + tip.height <= viewport.height - MARGIN;
    const side = above >= MARGIN || !fitsBelow ? 'top' : 'bottom';

    const center = trigger.left + trigger.width / 2;
    const maxLeft = viewport.width - MARGIN - tip.width;
    const left = Math.max(MARGIN, Math.min(center - tip.width / 2, maxLeft));
    const arrowLeft = Math.max(ARROW_INSET, Math.min(center - left, tip.width - ARROW_INSET));

    return { side, left, top: side === 'top' ? above : below, arrowLeft };
}

/** Un élément sans lettre ni chiffre visible (⏮, ✕, ✂…) n'a pas de nom accessible sans son tooltip */
export function isIconOnly(text) {
    return !/[\p{L}\p{N}]/u.test(text ?? '');
}

export function createTooltipTimer({ openDelay = OPEN_DELAY_MS, skipDelay = SKIP_DELAY_MS } = {}) {
    let pending = null;
    let closedAt = -Infinity;

    const cancel = () => {
        clearTimeout(pending);
        pending = null;
    };

    return {
        /** Ouvre après le délai, ou tout de suite (focus clavier, fermeture récente) */
        schedule(open, { immediate = false } = {}) {
            cancel();
            if (immediate || Date.now() - closedAt < skipDelay) {
                open();
            } else {
                pending = setTimeout(() => {
                    pending = null;
                    open();
                }, openDelay);
            }
        },
        cancel,
        markClosed() {
            closedAt = Date.now();
        },
    };
}
