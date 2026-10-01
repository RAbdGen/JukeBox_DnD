/**
 * Modals accessibles (#41) : <dialog class="modal"> ouvert par showModal(),
 * sur le modèle du Dialog de shadcn/Radix. Le navigateur rend l'arrière-plan
 * inerte (Tab reste dans la modal), gère Échap et aria-modal, et donne le
 * focus au champ [autofocus]. Ce module ajoute le blocage du défilement et
 * rend le focus au bouton d'origine, quelle que soit la façon de fermer
 * (×, Annuler, Enregistrer, Échap). Un clic sur le fond ne ferme pas : on
 * perdrait des réglages en pleine session.
 */

const returnFocus = new WeakMap();
const refocusAfter = new WeakMap();

// Le bouton d'origine a pu être recréé pendant que la modal était ouverte
// (bibliothèque re-rendue après Enregistrer) : on cherche alors son jumeau.
function focusTarget(opener) {
    if (!opener || opener === document.body) return null;
    if (opener.isConnected) return opener;
    const { id } = opener.dataset ?? {};
    const className = opener.classList?.[0];
    if (!id || !className) return null;
    return document.querySelector(`.${CSS.escape(className)}[data-id="${CSS.escape(id)}"]`);
}

export function openModal(dialog) {
    if (dialog.open) return;
    returnFocus.set(dialog, document.activeElement);
    document.body.classList.add('modal-open');
    dialog.showModal();
}

/**
 * @param {HTMLDialogElement} dialog
 * @param {object} [options]
 * @param {Promise} [options.restoreFocusAfter] - Rechargement qui va recréer le
 *   bouton d'origine (ex. bibliothèque après Enregistrer) : le focus attend
 *   sa fin, sinon il serait posé sur un bouton aussitôt détruit
 */
export function closeModal(dialog, { restoreFocusAfter } = {}) {
    if (!dialog.open) return;
    if (restoreFocusAfter) refocusAfter.set(dialog, restoreFocusAfter);
    dialog.close(); // → événement « close », traité par initModals()
}

export function initModals(root = document) {
    for (const dialog of root.querySelectorAll('dialog.modal')) {
        dialog.addEventListener('close', () => {
            if (!root.querySelector('dialog.modal[open]')) document.body.classList.remove('modal-open');
            const opener = returnFocus.get(dialog);
            const wait = refocusAfter.get(dialog);
            returnFocus.delete(dialog);
            refocusAfter.delete(dialog);
            const refocus = () => {
                if (!root.querySelector('dialog.modal[open]')) focusTarget(opener)?.focus();
            };
            if (wait) wait.then(refocus, refocus); // pas de finally : il propagerait un rejet non géré
            else refocus();
        });
    }
}
