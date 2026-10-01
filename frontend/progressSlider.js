/**
 * Barre de progression manipulable (#39) : un input range au lieu d'un bloc
 * cliquable. Pendant le glissement, seul le temps affiché suit la poignée ;
 * le seek a lieu une seule fois, au relâchement (un fondu en cours est alors
 * terminé immédiatement, règle #23). Clavier : ←/→ 5 s, PgPréc/PgSuiv 30 s,
 * Début/Fin.
 */

const KEY_STEPS = {
    ArrowRight: 5,
    ArrowUp: 5,
    ArrowLeft: -5,
    ArrowDown: -5,
    PageUp: 30,
    PageDown: -30,
};

/** Position visée par une touche (s), bornée à la piste ; null si touche non gérée ou piste vide */
export function progressKeyTarget(key, position, duration) {
    if (!(duration > 0)) return null;
    let target;
    if (key === 'Home') target = 0;
    else if (key === 'End') target = duration;
    else if (key in KEY_STEPS) target = position + KEY_STEPS[key];
    else return null;
    return Math.min(duration, Math.max(0, target));
}

/**
 * @param {object} deps
 * @param {HTMLInputElement} deps.input - Le curseur #progress
 * @param {HTMLElement} deps.timeLabel - Temps courant affiché
 * @param {{ getCurrentTime: () => number, getDuration: () => number, seek: (s: number) => void }} deps.audio
 * @param {(s: number) => string} deps.formatTime
 * @param {(key: string, vars?: object) => string} deps.t
 * @param {() => void} [deps.onSeek] - Rafraîchissement après un seek
 */
export function createProgressSlider({ input, timeLabel, audio, formatTime, t, onSeek = () => {} }) {
    let dragging = false;

    // Relu à chaque appel : suit les changements de langue sans attribut data-i18n dédié
    const describe = (position, duration) => {
        input.setAttribute('aria-label', t('controls.progress'));
        input.setAttribute('aria-valuetext', t('controls.progressValue', {
            current: formatTime(position),
            total: formatTime(duration),
        }));
    };

    const seek = position => {
        audio.seek(position);
        onSeek();
    };

    input.addEventListener('input', () => {
        dragging = true;
        const position = Number(input.value);
        timeLabel.textContent = formatTime(position);
        describe(position, Number(input.max));
    });
    input.addEventListener('change', () => {
        dragging = false;
        seek(Number(input.value));
    });
    // Relâché sans changement de valeur : pas de « change », on reprend quand même la main
    input.addEventListener('pointerup', () => setTimeout(() => { dragging = false; }, 0));
    input.addEventListener('keydown', event => {
        const target = progressKeyTarget(event.key, audio.getCurrentTime(), audio.getDuration());
        if (target === null) return;
        event.preventDefault(); // sinon le curseur natif avancerait aussi
        seek(target);
    });

    return {
        /** Appelé par la boucle de progression ; ne touche à rien pendant un glissement */
        update(position, duration) {
            if (dragging) return;
            const hasTrack = duration > 0;
            input.disabled = !hasTrack;
            input.max = String(hasTrack ? duration : 0);
            input.value = String(hasTrack ? Math.min(position, duration) : 0);
            timeLabel.textContent = formatTime(position);
            describe(position, duration);
        },
    };
}
