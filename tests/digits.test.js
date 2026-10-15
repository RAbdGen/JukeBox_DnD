import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readStyles } from './helpers/readStyles.js';

// #62 : les chiffres d'IM Fell English sont elliptiques (« 10 » se lit « Io »)
const entry = readFileSync(new URL('../frontend/styles.css', import.meta.url), 'utf-8');
const css = readStyles();

describe('Chiffres lisibles avec IM Fell English (#62)', () => {
    it('une police de chiffres seuls est chargée en plus de la police des titres', () => {
        expect(entry).toMatch(/@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=EB\+Garamond[^']*text=0123456789/);
    });

    it('chaque pile qui commence par IM Fell English passe d\'abord par les chiffres EB Garamond', () => {
        const stacks = [...css.matchAll(/font-family:\s*([^;]+);/g)].map(m => m[1]).filter(stack => stack.includes('IM Fell English'));
        expect(stacks.length).toBeGreaterThan(0);
        for (const stack of stacks) expect(stack.trim().startsWith("'EB Garamond', 'IM Fell English'")).toBe(true);
    });

    it('les chiffres sont alignés sur la ligne de base (lining) par défaut', () => {
        expect(css).toMatch(/body\s*\{[^}]*font-feature-settings:\s*'lnum'/);
    });
});
