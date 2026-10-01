/**
 * Liste déroulante accessible (#40), sur le modèle du Select de shadcn/Radix :
 * un bouton (aria-haspopup/aria-expanded) ouvre une liste role="listbox" dont
 * les entrées role="option" se parcourent au clavier. Utilisée par le menu
 * des playlists ; les entrées sont rendues par l'appelant.
 */

const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Entrée visée par une touche, ou null si la touche n'est pas gérée.
 * ↑/↓ ne bouclent pas ; une lettre va à la prochaine entrée qui commence par
 * elle (sans accent ni casse), en repartant du début si besoin.
 * @param {string} key - KeyboardEvent.key
 * @param {number} index - Entrée qui a le focus (-1 si aucune)
 * @param {string[]} labels - Libellés des entrées, dans l'ordre
 */
export function listboxKeyTarget(key, index, labels) {
    const last = labels.length - 1;
    if (last < 0) return null;
    if (key === 'ArrowDown') return Math.min(index + 1, last);
    if (key === 'ArrowUp') return Math.max(index - 1, 0);
    if (key === 'Home') return 0;
    if (key === 'End') return last;

    if (key.length !== 1 || !/[\p{L}\p{N}]/u.test(key)) return null;
    const letter = fold(key);
    for (let step = 1; step <= labels.length; step++) {
        const candidate = (index + step + labels.length) % labels.length;
        if (fold(labels[candidate]).startsWith(letter)) return candidate;
    }
    return null;
}

/**
 * @param {object} deps
 * @param {HTMLElement} deps.button - Bouton qui ouvre la liste
 * @param {HTMLElement} deps.list - Conteneur des entrées (classe .hidden quand fermé)
 * @param {(id: string) => void} deps.onSelect - Entrée choisie (data-id)
 */
export function createListbox({ button, list, onSelect }) {
    const options = () => [...list.querySelectorAll('[role="option"]')];

    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', list.id);
    list.setAttribute('role', 'listbox');

    const isOpen = () => !list.classList.contains('hidden');

    const open = () => {
        if (options().length === 0) return;
        list.classList.remove('hidden');
        button.setAttribute('aria-expanded', 'true');
        const selected = list.querySelector('[aria-selected="true"]') ?? options()[0];
        selected.focus();
    };

    const close = ({ focusButton = false } = {}) => {
        if (!isOpen()) return;
        list.classList.add('hidden');
        button.setAttribute('aria-expanded', 'false');
        if (focusButton) button.focus();
    };

    button.addEventListener('click', event => {
        event.stopPropagation(); // sinon le clic « hors liste » ci-dessous la refermerait aussitôt
        if (isOpen()) close();
        else open();
    });
    button.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open();
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); // pas de clic natif en plus : on bascule une seule fois
            if (isOpen()) close();
            else open();
        }
    });

    list.addEventListener('click', event => {
        const option = event.target.closest('[role="option"]');
        if (!option) return;
        event.stopPropagation();
        close({ focusButton: true });
        onSelect(option.dataset.id);
    });
    list.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close({ focusButton: true });
            return;
        }
        if (event.key === 'Tab') {
            close();
            return;
        }
        const items = options();
        // Entrée/Espace gérés ici plutôt que par l'activation native du <button>
        // (qui dépend de keypress) : comportement identique quelle que soit la source
        if ((event.key === 'Enter' || event.key === ' ') && items.includes(document.activeElement)) {
            event.preventDefault();
            const { id } = document.activeElement.dataset; // avant close(), qui rend le focus au bouton
            close({ focusButton: true });
            onSelect(id);
            return;
        }
        const target = listboxKeyTarget(event.key, items.indexOf(document.activeElement), items.map(o => o.textContent));
        if (target === null) return;
        event.preventDefault();
        items[target].focus();
    });

    document.addEventListener('click', () => close());

    return { open, close, isOpen };
}
