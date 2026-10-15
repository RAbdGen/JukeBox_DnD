import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readStyles } from './helpers/readStyles.js';

// #54 : barre de titre propre au thème, boutons système par-dessus
const read = path => readFileSync(new URL(path, import.meta.url), 'utf-8');
const main = read('../electron/main.cjs');
const preload = read('../electron/preload.cjs');
const html = read('../frontend/index.html');
const renderer = read('../frontend/renderer.js');
const css = readStyles();

describe('Barre de titre personnalisée (#54)', () => {
    it('la fenêtre masque la barre système et garde ses boutons (hors macOS)', () => {
        expect(main).toMatch(/titleBarStyle:\s*'hidden'/);
        expect(main).toMatch(/titleBarOverlay:\s*\{/);
        expect(main).toMatch(/process\.platform === 'darwin'/);
    });

    it('la hauteur de #titlebar suit celle de l\'overlay', () => {
        const height = /TITLEBAR_HEIGHT = (\d+)/.exec(main)?.[1];
        expect(height).toBeDefined();
        expect(css).toMatch(new RegExp(`#titlebar\\s*\\{[^}]*height:\\s*${height}px`));
    });

    it("#titlebar déplace la fenêtre, a le fond du haut de l'en-tête et laisse la place aux boutons", () => {
        const rule = /#titlebar\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
        expect(rule).toMatch(/-webkit-app-region:\s*drag/);
        expect(rule).toMatch(/background:\s*var\(--ink-warm\)/);
        expect(rule).toMatch(/titlebar-area-width/);
        expect(html).toMatch(/<div id="titlebar"[^>]*aria-hidden="true"/);
    });

    it('le main n\'accepte que des couleurs hexadécimales du renderer', () => {
        expect(main).toMatch(/HEX_COLOR\s*=\s*\/\^#/);
        expect(main).toMatch(/ipcHandle\('window:setTitleBarTheme'/);
        expect(main).toMatch(/!HEX_COLOR\.test\(color\)/);
        expect(preload).toMatch(/setTitleBarTheme/);
    });

    it('chaque changement de thème renvoie les couleurs aux boutons système', () => {
        const apply = /function applyTheme\(theme\) \{[\s\S]*?\n\}/.exec(renderer)?.[0] ?? '';
        expect(apply).toContain('syncTitleBar()');
        expect(renderer).toMatch(/getPropertyValue\('--ink-warm'\)/);
    });
});
