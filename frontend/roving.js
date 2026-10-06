/**
 * Focus itinérant (roving tabindex) d'un groupe horizontal, sur le modèle des
 * ToggleGroup / Tabs de shadcn/Radix : un seul élément du groupe est atteignable
 * par Tab, les flèches passent d'un élément à l'autre. Utilisé par les modes de
 * lecture (#46) et les onglets de fichiers du Découpage (#45).
 */

/**
 * Élément visé par une touche, ou null si la touche n'est pas gérée.
 * ←/→ (et ↑/↓) bouclent ; Début/Fin vont aux extrémités.
 * @param {string} key - KeyboardEvent.key
 * @param {number} index - Élément qui a le focus
 * @param {number} count - Nombre d'éléments du groupe
 */
export function rovingKeyTarget(key, index, count) {
    if (count <= 0) return null;
    if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
    if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return null;
}

/**
 * Groupe de boutons à choix unique (role="radiogroup" / "radio"), comme le
 * ToggleGroup « single » de Radix avec la sémantique radio de l'APG : les
 * flèches déplacent le focus ET choisissent (choisir un mode est sans risque).
 * @param {object} deps
 * @param {HTMLElement} deps.group - Conteneur role="radiogroup"
 * @param {(value: string) => void} deps.onSelect - Choix de l'utilisateur (data-value)
 * @param {string} [deps.valueKey='value'] - Clé dataset portant la valeur
 */
export function createRadioGroup({ group, onSelect, valueKey = 'value' }) {
    const items = () => Array.from(group.querySelectorAll('[role="radio"]'));

    /** Reflète la valeur courante (sans appeler onSelect) */
    function setValue(value) {
        const all = items();
        const selected = all.find(item => item.dataset[valueKey] === value) || all[0];
        all.forEach(item => {
            const checked = item === selected;
            item.setAttribute('aria-checked', String(checked));
            item.classList.toggle('active', checked);
            item.tabIndex = checked ? 0 : -1;
        });
    }

    function choose(item) {
        setValue(item.dataset[valueKey]);
        onSelect(item.dataset[valueKey]);
    }

    group.addEventListener('click', event => {
        const item = event.target.closest('[role="radio"]');
        if (item && group.contains(item)) choose(item);
    });

    group.addEventListener('keydown', event => {
        const all = items();
        const target = rovingKeyTarget(event.key, all.indexOf(document.activeElement), all.length);
        if (target === null) return;
        event.preventDefault();
        all[target].focus();
        choose(all[target]);
    });

    return { setValue };
}
