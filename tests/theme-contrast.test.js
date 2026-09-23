import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

// Vérifie que chaque thème (#19) respecte WCAG AA (>= 4.5:1) pour le texte
// secondaire (--bone-dim) et l'accent (--gold-2) contre --ink-2, le fond le
// plus clair sur lequel ils apparaissent réellement (cartes/panneaux) —
// c'est le pire cas : s'il passe là, il passe aussi contre --ink-0/--ink-1.
// Lit directement frontend/styles.css pour garder ce garde-fou vivant si
// les couleurs sont retouchées plus tard.

const css = readFileSync(new URL('../frontend/styles.css', import.meta.url), 'utf-8');

function srgbToLinear(c) {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relLuminance([r, g, b]) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrast(a, b) {
    const L1 = relLuminance(a), L2 = relLuminance(b);
    const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
    return (hi + 0.05) / (lo + 0.05);
}
function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function extractBlocks(selector) {
    // Concatène tous les blocs correspondant au sélecteur (ex: deux blocs
    // [data-theme="parchemin"] distincts) pour ne rater aucune déclaration
    const re = new RegExp(`${selector.replace(/[[\]"=]/g, '\\$&')}\\s*{([^}]*)}`, 'g');
    let match, combined = '';
    while ((match = re.exec(css))) combined += match[1] + '\n';
    return combined;
}

function extractVar(block, name) {
    const m = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!m) throw new Error(`--${name} introuvable dans le bloc`);
    return hexToRgb(m[1]);
}

const themeSelectors = {
    nuit: ':root',
    grimoire: '[data-theme="grimoire"]',
    taverne: '[data-theme="taverne"]',
    arcane: '[data-theme="arcane"]',
    foret: '[data-theme="foret"]',
    sang: '[data-theme="sang"]',
    glace: '[data-theme="glace"]',
    parchemin: '[data-theme="parchemin"]',
};

describe('Contraste WCAG AA des thèmes (#19)', () => {
    for (const [name, selector] of Object.entries(themeSelectors)) {
        it(`${name} : bone-dim et gold-2 >= 4.5:1 contre ink-2 (pire cas)`, () => {
            const block = extractBlocks(selector);
            const ink2 = extractVar(block, 'ink-2');
            const boneDim = extractVar(block, 'bone-dim');
            const gold2 = extractVar(block, 'gold-2');

            expect(contrast(boneDim, ink2)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(gold2, ink2)).toBeGreaterThanOrEqual(4.5);
        });
    }

    it('les 8 thèmes déclarés en CSS correspondent à ceux du sélecteur (index.html)', () => {
        const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf-8');
        const declared = Object.keys(themeSelectors).filter(n => n !== 'nuit');
        for (const name of declared) {
            expect(html).toContain(`data-theme="${name}"`);
        }
    });
});
