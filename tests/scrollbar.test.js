import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

// #30 : scrollbars fines, stylées par le thème, jamais masquées
const css = readFileSync(new URL('../frontend/styles.css', import.meta.url), 'utf-8');

function rules() {
    const found = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) found.push({ selector: m[1].trim().split('\n').pop().trim(), body: m[2] });
    return found;
}

describe('Scrollbars intégrées au thème (#30)', () => {
    it('aucune scrollbar masquée ni stylée à l\'ancienne (::-webkit-scrollbar ignoré par Chromium dès que scrollbar-color est défini)', () => {
        expect(css).not.toMatch(/scrollbar-width:\s*none/);
        expect(css).not.toMatch(/::-webkit-scrollbar/);
    });

    it('les couleurs de scrollbar passent uniquement par les variables du thème', () => {
        const colors = [...css.matchAll(/scrollbar-color:\s*([^;]+);/g)].map(m => m[1].trim());
        expect(colors.length).toBeGreaterThan(0);
        for (const value of colors) expect(value).toMatch(/^var\(--scroll-[\w-]+\) var\(--scroll-[\w-]+\)$/);
    });

    it(':root définit les variables de scrollbar', () => {
        const root = css.match(/:root\s*{([^}]*)}/)[1];
        for (const name of ['scroll-thumb', 'scroll-thumb-hover', 'scroll-track']) expect(root).toContain(`--${name}:`);
    });

    it('toute zone qui défile réserve la place de sa scrollbar (pas de saut de mise en page)', () => {
        const missing = rules()
            .filter(({ body }) => /overflow(-y)?:\s*auto/.test(body) && !/scrollbar-gutter:\s*stable/.test(body))
            .map(({ selector }) => selector);
        expect(missing).toEqual([]);
    });
});
