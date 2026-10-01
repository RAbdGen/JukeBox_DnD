import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listboxKeyTarget } from '../frontend/listbox.js';
import { t } from '../backend/i18n.js';

const labels = ['Ambiances', 'Boss', 'Combat', 'Cité', 'Donjon'];

describe('listboxKeyTarget (#40)', () => {
    it('↓/↑ avancent d\'un cran sans boucler', () => {
        expect(listboxKeyTarget('ArrowDown', 1, labels)).toBe(2);
        expect(listboxKeyTarget('ArrowUp', 1, labels)).toBe(0);
        expect(listboxKeyTarget('ArrowDown', 4, labels)).toBe(4);
        expect(listboxKeyTarget('ArrowUp', 0, labels)).toBe(0);
    });

    it('Début / Fin', () => {
        expect(listboxKeyTarget('Home', 3, labels)).toBe(0);
        expect(listboxKeyTarget('End', 0, labels)).toBe(4);
    });

    it('une lettre va à la prochaine entrée qui commence par elle, en partant de la courante', () => {
        expect(listboxKeyTarget('c', 0, labels)).toBe(2);
        expect(listboxKeyTarget('c', 2, labels)).toBe(3);
        expect(listboxKeyTarget('C', 3, labels)).toBe(2); // repart du début
        expect(listboxKeyTarget('d', 0, labels)).toBe(4);
    });

    it('lettre accentuée ou casse différente : même entrée', () => {
        expect(listboxKeyTarget('a', 4, ['Été', 'Auberge'])).toBe(1);
        expect(listboxKeyTarget('e', 1, ['Été', 'Auberge'])).toBe(0);
    });

    it('null pour une touche non gérée, une lettre sans entrée ou une liste vide', () => {
        expect(listboxKeyTarget('Tab', 1, labels)).toBeNull();
        expect(listboxKeyTarget('z', 1, labels)).toBeNull();
        expect(listboxKeyTarget('ArrowDown', 0, [])).toBeNull();
    });

    it('sans entrée courante (-1) : ↓ va à la première', () => {
        expect(listboxKeyTarget('ArrowDown', -1, labels)).toBe(0);
    });
});

describe('une seule source pour la playlist sélectionnée (#40)', () => {
    it('plus de <select id="playlist-select"> caché', () => {
        const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf-8');
        const renderer = readFileSync(new URL('../frontend/renderer.js', import.meta.url), 'utf-8');
        expect(html).not.toMatch(/playlist-select|hidden-select/);
        expect(renderer).not.toMatch(/playlist-select/);
    });

    it('la clé de l\'option vide du select a disparu des deux langues', () => {
        expect(t('fr', 'playlist.defaultOption')).toBe('playlist.defaultOption');
        expect(t('en', 'playlist.defaultOption')).toBe('playlist.defaultOption');
    });
});
