import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rovingKeyTarget } from '../frontend/roving.js';
import { t } from '../backend/i18n.js';

describe('rovingKeyTarget (#46)', () => {
    it('←/→ avancent d\'un cran en bouclant', () => {
        expect(rovingKeyTarget('ArrowRight', 1, 4)).toBe(2);
        expect(rovingKeyTarget('ArrowLeft', 1, 4)).toBe(0);
        expect(rovingKeyTarget('ArrowRight', 3, 4)).toBe(0);
        expect(rovingKeyTarget('ArrowLeft', 0, 4)).toBe(3);
    });

    it('Début / Fin', () => {
        expect(rovingKeyTarget('Home', 2, 4)).toBe(0);
        expect(rovingKeyTarget('End', 0, 4)).toBe(3);
    });

    it('↑/↓ suivent ←/→ (groupe horizontal, comme Radix)', () => {
        expect(rovingKeyTarget('ArrowDown', 1, 4)).toBe(2);
        expect(rovingKeyTarget('ArrowUp', 1, 4)).toBe(0);
    });

    it('autre touche ou groupe vide : null', () => {
        expect(rovingKeyTarget('a', 1, 4)).toBeNull();
        expect(rovingKeyTarget('Enter', 1, 4)).toBeNull();
        expect(rovingKeyTarget('ArrowRight', 0, 0)).toBeNull();
    });
});

describe('Modes de lecture : groupe accessible (#46)', () => {
    const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
    const group = html.match(/<div class="mode-buttons"[^>]*>([\s\S]*?)<\/div>/);

    it('radiogroup étiqueté, un radio par mode, dont « Défiler les versions »', () => {
        expect(group[0]).toMatch(/role="radiogroup"/);
        expect(group[0]).toMatch(/data-i18n-label="controls.playMode"/);
        const modes = [...group[1].matchAll(/data-mode="(\w+)"/g)].map(m => m[1]);
        expect(modes).toEqual(['noLoop', 'loopOne', 'loopAll', 'cycleVersions']);
        expect(group[1].match(/role="radio"/g)).toHaveLength(4);
    });

    it('libellés traduits', () => {
        expect(t('fr', 'controls.modeCycleVersions')).toBe('Défiler les versions');
        expect(t('en', 'controls.modeCycleVersions')).toBe('Cycle versions');
        expect(t('fr', 'controls.playMode')).toBe('Mode de lecture');
    });
});
