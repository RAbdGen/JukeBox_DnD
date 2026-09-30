import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SHORTCUTS,
    FIXED_SHORTCUTS,
    acceleratorFromKeyEvent,
    findShortcutIssues,
    formatAccelerator,
    isValidAccelerator,
    resolveShortcuts,
    versionForShortcut,
} from '../backend/shortcuts.js';

describe('raccourcis de version (#26)', () => {
    it('applique les valeurs par défaut, mais respecte un raccourci désactivé (null)', () => {
        expect(resolveShortcuts(undefined)).toEqual(DEFAULT_SHORTCUTS);
        expect(resolveShortcuts({ version2: null, versionNext: 'Alt+N' })).toEqual({
            ...DEFAULT_SHORTCUTS,
            version2: null,
            versionNext: 'Alt+N',
        });
    });

    it('les raccourcis fixes déclarés ici sont bien ceux enregistrés par electron/main.cjs', () => {
        const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf-8');
        for (const accelerator of FIXED_SHORTCUTS) expect(main).toContain(`'${accelerator}'`);
    });

    it('exige un modificateur (hors Maj seul) et une seule touche', () => {
        expect(isValidAccelerator('CommandOrControl+Alt+V')).toBe(true);
        expect(isValidAccelerator('Super+F5')).toBe(true);
        expect(isValidAccelerator('V')).toBe(false);
        expect(isValidAccelerator('Shift+V')).toBe(false);
        expect(isValidAccelerator('CommandOrControl+Alt')).toBe(false);
        expect(isValidAccelerator('Alt+A+B')).toBe(false);
        expect(isValidAccelerator('')).toBe(false);
    });

    it('signale les combinaisons invalides et les conflits (entre eux, avec les raccourcis fixes, sans casse)', () => {
        expect(findShortcutIssues(DEFAULT_SHORTCUTS)).toEqual({});
        expect(findShortcutIssues({
            versionNext: 'commandorcontrol+alt+m', // = mute
            version1: 'Alt+1',
            version2: 'Alt+1',
            version3: 'V',
        })).toEqual({ versionNext: 'conflict', version1: 'conflict', version2: 'conflict', version3: 'invalid' });
        expect(findShortcutIssues({ ...DEFAULT_SHORTCUTS, version3: null })).toEqual({});
    });

    it('traduit une frappe clavier en combinaison Electron', () => {
        expect(acceleratorFromKeyEvent({ ctrlKey: true, altKey: true, code: 'KeyV', key: 'v' })).toBe('CommandOrControl+Alt+V');
        expect(acceleratorFromKeyEvent({ altKey: true, shiftKey: true, code: 'Digit2', key: '"' })).toBe('Alt+Shift+2');
        expect(acceleratorFromKeyEvent({ metaKey: true, code: 'F5', key: 'F5' })).toBe('Super+F5');
        expect(acceleratorFromKeyEvent({ ctrlKey: true, code: 'ArrowUp', key: 'ArrowUp' })).toBe('CommandOrControl+Up');
        expect(acceleratorFromKeyEvent({ ctrlKey: true, code: 'ControlLeft', key: 'Control' })).toBeNull(); // modificateur seul
    });

    it('affiche les combinaisons lisiblement', () => {
        expect(formatAccelerator('CommandOrControl+Alt+V')).toBe('Ctrl + Alt + V');
        expect(formatAccelerator(null)).toBe('');
    });

    it('choisit la version visée dans la piste courante', () => {
        const names = ['calm', 'combat', 'tension'];
        expect(versionForShortcut('versionNext', names, 'combat')).toBe('tension');
        expect(versionForShortcut('versionNext', names, 'tension')).toBe('calm');
        expect(versionForShortcut('versionNext', names, null)).toBe('calm');
        expect(versionForShortcut('version2', names, 'calm')).toBe('combat');
        expect(versionForShortcut('version3', ['calm'], 'calm')).toBeNull();
        expect(versionForShortcut('versionNext', ['calm'], 'calm')).toBeNull();
        expect(versionForShortcut('versionNext', [], null)).toBeNull();
    });
});
