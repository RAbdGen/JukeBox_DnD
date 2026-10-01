import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { readStyles } from './helpers/readStyles.js';

// Vérifie que chaque thème (#19) respecte WCAG AA (>= 4.5:1) pour le texte
// secondaire (--bone-dim) et l'accent (--gold-2) contre --ink-2, le fond le
// plus clair sur lequel ils apparaissent réellement (cartes/panneaux) —
// c'est le pire cas : s'il passe là, il passe aussi contre --ink-0/--ink-1.
// Lit tout le CSS (styles.css et ses @import) pour garder ce garde-fou vivant si
// les couleurs sont retouchées plus tard.

const css = readStyles();

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

// ── #27 : tous les textes, pas seulement bone-dim / gold-2 ──────────────────

function parseColor(value) {
    const v = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return [...hexToRgb(v), 1];
    const m = v.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    return [r, g, b, a];
}

function composite(fg, bg) {
    return [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
}

/** Valeur d'une variable pour un thème : bloc du thème, sinon :root ; suit les var() en chaîne */
function resolveVar(themeSelector, name, depth = 0) {
    const pattern = new RegExp(`--${name}:\\s*([^;]+);`);
    const value = (extractBlocks(themeSelector).match(pattern) || extractBlocks(':root').match(pattern))?.[1];
    if (!value) throw new Error(`--${name} introuvable`);
    const ref = value.trim().match(/^var\(--([\w-]+)\)$/);
    return ref && depth < 5 ? resolveVar(themeSelector, ref[1], depth + 1) : value.trim();
}

function resolveColor(themeSelector, value) {
    const ref = value.trim().match(/^var\(--([\w-]+)\)$/);
    return parseColor(ref ? resolveVar(themeSelector, ref[1]) : value);
}

/** Règles CSS simples (y compris celles imbriquées dans un @media) */
function cssRules() {
    const rules = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
        const selector = m[1].trim().split('\n').pop().trim();
        if (!selector.startsWith('@') && !selector.startsWith('--')) rules.push({ selector, body: m[2] });
    }
    return rules;
}

const DECORATIVE = /::?before|::?after|\.ornament-gem|\.stub-icon|:disabled/; // glyphes décoratifs ; contrôles désactivés exemptés par WCAG
const declaration = (body, prop) => body.match(new RegExp(`(?:^|[;\\s{])${prop}:\\s*([^;]+);`))?.[1].trim();

describe('Contraste de tous les textes (#27)', () => {
    const rules = cssRules();

    it('aucune couleur de texte en dur (hors glyphes décoratifs) : tout passe par les variables du thème', () => {
        const hardcoded = rules
            .filter(({ selector, body }) => !DECORATIVE.test(selector) && /^#/.test(declaration(body, 'color') || ''))
            .map(({ selector }) => selector);
        expect(hardcoded).toEqual([]);
    });

    for (const [name, selector] of Object.entries(themeSelectors)) {
        it(`${name} : textes posés sur les panneaux >= 4.5:1 contre ink-2`, () => {
            const ink2 = parseColor(resolveVar(selector, 'ink-2'));
            const failures = [];
            for (const rule of rules) {
                const color = declaration(rule.body, 'color');
                const background = declaration(rule.body, 'background') || declaration(rule.body, 'background-color');
                if (!color || DECORATIVE.test(rule.selector)) continue;
                if (background && background !== 'none' && background !== 'transparent') continue; // fond propre : testé plus bas
                if (/var\(--ink-0\)/.test(color)) continue; // texte sombre sur bouton doré
                const fg = resolveColor(selector, color);
                if (!fg) continue; // inherit, currentColor…
                const ratio = contrast(composite(fg, ink2), ink2);
                if (ratio < 4.5) failures.push(`${rule.selector} (${color}) ${ratio.toFixed(2)}`);
            }
            expect(failures).toEqual([]);
        });

        it(`${name} : boutons de version, statut arrêté et bouton danger >= 4.5:1 contre leur propre fond`, () => {
            const ink2 = parseColor(resolveVar(selector, 'ink-2'));
            const withOwnBackground = [
                '.player-card .version-btn[data-version="calm"]',
                '.player-card .version-btn[data-version="calm"].active',
                '.player-card .version-btn[data-version="combat"]',
                '.player-card .version-btn[data-version="combat"].active',
                '.player-card .version-btn[data-version="tension"]',
                '.player-card .version-btn[data-version="tension"].active',
                '.status.stopped',
                '.danger-btn',
                '.tooltip', // #38 : bulle sur son propre fond
            ];
            const failures = [];
            for (const target of withOwnBackground) {
                const rule = rules.find(r => r.selector === target);
                if (!rule) throw new Error(`règle introuvable : ${target}`);
                const fg = resolveColor(selector, declaration(rule.body, 'color'));
                const bg = composite(resolveColor(selector, declaration(rule.body, 'background')), ink2);
                const ratio = contrast(composite(fg, bg), bg);
                if (ratio < 4.5) failures.push(`${target} ${ratio.toFixed(2)}`);
            }
            expect(failures).toEqual([]);
        });
    }

    it('aucun texte sous 0.7rem (hors glyphes décoratifs)', () => {
        const tooSmall = rules
            .filter(({ selector }) => !DECORATIVE.test(selector))
            .map(({ selector, body }) => ({ selector, size: declaration(body, 'font-size') }))
            .filter(({ size }) => size && /^[\d.]+rem$/.test(size) && parseFloat(size) < 0.7)
            .map(({ selector, size }) => `${selector} ${size}`);
        expect(tooSmall).toEqual([]);
    });
});
