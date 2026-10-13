import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readStyles } from './helpers/readStyles.js';

// #58 : l'interface doit se réduire sans casser la mise en page
const css = readStyles();
const entry = readFileSync(new URL('../frontend/styles.css', import.meta.url), 'utf-8');
const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf-8');

function mediaBlock(maxWidth) {
    const start = css.indexOf(`@media (max-width: ${maxWidth}px)`);
    if (start < 0) return '';
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
    }
    return '';
}

describe('Fenêtre étroite (#58)', () => {
    it('responsive.css est importé en dernier : il resserre les règles des autres fichiers', () => {
        const imports = [...entry.matchAll(/@import '\.\/styles\/([\w-]+\.css)'/g)].map(m => m[1]);
        expect(imports.at(-1)).toBe('responsive.css');
    });

    it('la fenêtre a une taille minimale, sinon la mise en page n\'a pas de limite à tenir', () => {
        expect(main).toMatch(/minWidth:\s*\d+/);
        expect(main).toMatch(/minHeight:\s*\d+/);
    });

    it('≤ 720px : le lecteur passe sur une colonne et les onglets se resserrent', () => {
        const block = mediaBlock(720);
        expect(block).toMatch(/\.lecture-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
        expect(block).toMatch(/\.tab-btn\s*\{/);
    });

    it('≤ 720px : une ligne de bibliothèque empile titre et boutons', () => {
        expect(mediaBlock(720)).toMatch(/\.library-track\s*\{[^}]*flex-direction:\s*column/);
    });

    it('≤ 480px : les onglets passent sur deux lignes, la grille de thèmes sur deux colonnes', () => {
        const block = mediaBlock(480);
        expect(block).toMatch(/#view-tabs\s*\{[^}]*repeat\(2/);
        expect(block).toMatch(/#theme-grid\s*\{[^}]*repeat\(2/);
    });
});
