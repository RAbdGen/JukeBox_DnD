/**
 * Gère le cycle de vie du preview d'une piste sans interférer avec la
 * lecture principale. Un seul preview peut être actif à la fois.
 * @param {object} deps
 * @param {(key: string) => string} [deps.t] - Fonction de traduction (#22),
 *   appelée avec 'preview.play'/'preview.stop'. Par défaut : libellés en
 *   français, pour rester utilisable sans changement côté appelant.
 */
export function createPreviewController({
    createHowl,
    getSource,
    getVolume,
    t = key => (key === 'preview.stop' ? 'Arrêter le preview' : 'Préécouter'),
}) {
    let activeHowl = null;
    let activeTrackId = null;
    let activeButton = null;

    const setButtonState = (button, isActive) => {
        button.textContent = isActive ? '⏸' : '▶';
        button.title = isActive ? t('preview.stop') : t('preview.play');
        button.ariaLabel = button.title;
    };

    const stop = () => {
        const howl = activeHowl;
        activeHowl = null;
        activeTrackId = null;

        if (activeButton) {
            setButtonState(activeButton, false);
            activeButton = null;
        }

        if (howl) howl.unload();
    };

    const start = (track, button) => {
        const src = getSource(track);
        if (!src) return false;

        stop();

        const howl = createHowl({
            src: [src],
            html5: true,
            volume: getVolume(track),
            preload: false,
            onend: () => {
                if (activeHowl === howl) stop();
            },
            onloaderror: () => {
                if (activeHowl === howl) stop();
            },
            onplayerror: () => {
                if (activeHowl === howl) stop();
            },
        });

        activeHowl = howl;
        activeTrackId = track.id;
        activeButton = button;
        setButtonState(button, true);

        const play = () => {
            if (activeHowl === howl) howl.play();
        };

        if (howl.state() === 'loaded') {
            play();
        } else {
            howl.once('load', play);
            howl.load();
        }

        return true;
    };

    return {
        stop,
        toggle: (track, button) => activeTrackId === track.id ? (stop(), false) : start(track, button),
    };
}
