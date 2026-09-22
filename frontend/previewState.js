/**
 * Centralise le timer de survol et le preview Howler afin que tout re-rendu
 * puisse annuler les deux avant de retirer les lignes du DOM.
 */
export function createPreviewState({ clearTimer, stopHowl }) {
    let timer = null;

    const clearPendingTimer = () => {
        if (timer !== null) {
            clearTimer(timer);
            timer = null;
        }
    };

    return {
        setTimer: value => { timer = value; },
        getTimer: () => timer,
        clearTimer: clearPendingTimer,
        cancel: () => {
            clearPendingTimer();
            stopHowl();
        },
    };
}
