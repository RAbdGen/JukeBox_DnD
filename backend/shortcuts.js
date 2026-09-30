/**
 * Raccourcis clavier globaux de changement de version (#26), personnalisables
 * dans les Réglages et persistés dans `settings.shortcuts`. Module pur partagé
 * par le renderer (capture, affichage, action) et electron/main.cjs
 * (validation avant enregistrement via globalShortcut).
 */

export const SHORTCUT_ACTIONS = ['versionNext', 'version1', 'version2', 'version3'];

export const DEFAULT_SHORTCUTS = {
    versionNext: 'CommandOrControl+Alt+V',
    version1: 'CommandOrControl+Alt+1',
    version2: 'CommandOrControl+Alt+2',
    version3: 'CommandOrControl+Alt+3',
};

// Raccourcis fixes enregistrés par electron/main.cjs (#2) : jamais réutilisables
export const FIXED_SHORTCUTS = ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack', 'CommandOrControl+Alt+M'];

// En minuscules : Electron ne tient pas compte de la casse des combinaisons
const MODIFIERS = ['commandorcontrol', 'control', 'ctrl', 'alt', 'option', 'super', 'meta', 'command', 'cmd', 'shift'];
// Maj seule ne suffit pas : un raccourci global « Maj+V » volerait la saisie des majuscules
const BLOCKING_MODIFIERS = MODIFIERS.filter(m => m !== 'shift');

/** Réglages enregistrés + valeurs par défaut ; `null` = raccourci désactivé */
export function resolveShortcuts(saved) {
    const resolved = {};
    for (const action of SHORTCUT_ACTIONS) {
        resolved[action] = saved && Object.hasOwn(saved, action) ? saved[action] : DEFAULT_SHORTCUTS[action];
    }
    return resolved;
}

export function isValidAccelerator(accelerator) {
    if (typeof accelerator !== 'string' || !accelerator) return false;
    const parts = accelerator.toLowerCase().split('+');
    const keys = parts.filter(part => !MODIFIERS.includes(part));
    return keys.length === 1 && parts[parts.length - 1] === keys[0]
        && parts.some(part => BLOCKING_MODIFIERS.includes(part));
}

const normalize = accelerator => accelerator.toLowerCase();

/**
 * @returns {{ [action]: 'invalid' | 'conflict' }} uniquement les raccourcis en défaut
 */
export function findShortcutIssues(config) {
    const issues = {};
    const fixed = FIXED_SHORTCUTS.map(normalize);
    const active = SHORTCUT_ACTIONS.filter(action => config[action]);

    for (const action of active) {
        const accelerator = normalize(config[action]);
        if (!isValidAccelerator(config[action])) {
            issues[action] = 'invalid';
        } else if (fixed.includes(accelerator)
            || active.some(other => other !== action && normalize(config[other]) === accelerator)) {
            issues[action] = 'conflict';
        }
    }
    return issues;
}

const KEY_NAMES = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space' };

/**
 * Frappe clavier (KeyboardEvent) → combinaison Electron, ou null tant que
 * seule une touche de modification est enfoncée.
 */
export function acceleratorFromKeyEvent(event) {
    const { code = '', key = '' } = event;
    let name;
    if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
    else if (/^Digit\d$/.test(code)) name = code.slice(5);
    else if (/^Numpad\d$/.test(code)) name = `num${code.slice(6)}`;
    else if (/^F\d{1,2}$/.test(code)) name = code;
    else if (KEY_NAMES[code]) name = KEY_NAMES[code];
    else if (key.length === 1 && key !== ' ') name = key.toUpperCase();
    else return null; // Control, Alt, Shift, Meta seuls, ou touche non gérée

    const parts = [];
    if (event.ctrlKey) parts.push('CommandOrControl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Super');
    parts.push(name);
    return parts.join('+');
}

export function formatAccelerator(accelerator) {
    if (!accelerator) return '';
    return accelerator.split('+').map(part => (part === 'CommandOrControl' ? 'Ctrl' : part)).join(' + ');
}

/**
 * Version visée par un raccourci dans la piste courante, ou null si l'action
 * n'a pas de sens (piste sans cette version, une seule version…)
 */
export function versionForShortcut(action, versionNames, currentVersion) {
    if (versionNames.length === 0) return null;
    if (action === 'versionNext') {
        if (versionNames.length < 2) return null;
        return versionNames[(versionNames.indexOf(currentVersion) + 1) % versionNames.length];
    }
    const index = Number(action.replace('version', '')) - 1;
    return versionNames[index] ?? null;
}
