import { describe, expect, it } from 'vitest';
import { resolveLaunchVersion } from '../backend/launchVersion.js';

describe('resolveLaunchVersion (#25)', () => {
    it('garde la version de lancement choisie si elle existe', () => {
        expect(resolveLaunchVersion(['calm', 'combat'], 'combat')).toBe('combat');
    });

    it('retombe sur la première version sinon (version supprimée, jamais choisie)', () => {
        expect(resolveLaunchVersion(['combat', 'calm'], 'boss')).toBe('combat');
        expect(resolveLaunchVersion(['combat', 'calm'], undefined)).toBe('combat');
    });

    it('null si la piste n\'a aucune version', () => {
        expect(resolveLaunchVersion([], 'calm')).toBeNull();
    });
});
