import { describe, expect, it } from 'vitest';
import { rangeFillPercent } from '../frontend/rangeFill.js';
import { progressKeyTarget } from '../frontend/progressSlider.js';
import { readStyles } from './helpers/readStyles.js';
import { readFileSync } from 'node:fs';

describe('rangeFillPercent (#39)', () => {
    it('donne la part remplie entre min et max', () => {
        expect(rangeFillPercent(50, 0, 100)).toBe(50);
        expect(rangeFillPercent(5, 0.5, 10)).toBeCloseTo(47.368, 2);
        expect(rangeFillPercent('25', '0', '100')).toBe(25);
    });

    it('borne entre 0 et 100', () => {
        expect(rangeFillPercent(-3, 0, 100)).toBe(0);
        expect(rangeFillPercent(130, 0, 100)).toBe(100);
    });

    it('vaut 0 quand min = max (rien à faire défiler) ou valeur invalide', () => {
        expect(rangeFillPercent(0, 0, 0)).toBe(0);
        expect(rangeFillPercent(NaN, 0, 100)).toBe(0);
    });
});

describe('progressKeyTarget (#39)', () => {
    const duration = 200;

    it('flèches : ±5 s', () => {
        expect(progressKeyTarget('ArrowRight', 60, duration)).toBe(65);
        expect(progressKeyTarget('ArrowUp', 60, duration)).toBe(65);
        expect(progressKeyTarget('ArrowLeft', 60, duration)).toBe(55);
        expect(progressKeyTarget('ArrowDown', 60, duration)).toBe(55);
    });

    it('PgPréc / PgSuiv : ±30 s', () => {
        expect(progressKeyTarget('PageUp', 60, duration)).toBe(90);
        expect(progressKeyTarget('PageDown', 60, duration)).toBe(30);
    });

    it('Début / Fin', () => {
        expect(progressKeyTarget('Home', 60, duration)).toBe(0);
        expect(progressKeyTarget('End', 60, duration)).toBe(duration);
    });

    it('reste dans [0, durée]', () => {
        expect(progressKeyTarget('ArrowLeft', 2, duration)).toBe(0);
        expect(progressKeyTarget('PageUp', 190, duration)).toBe(duration);
    });

    it('null pour une autre touche ou sans durée', () => {
        expect(progressKeyTarget('a', 60, duration)).toBeNull();
        expect(progressKeyTarget('Tab', 60, duration)).toBeNull();
        expect(progressKeyTarget('ArrowRight', 0, 0)).toBeNull();
    });
});

describe('style unique des curseurs (#39)', () => {
    it('seul sliders.css stylise les pseudo-éléments de curseur', () => {
        const css = readStyles();
        const sliders = readFileSync(new URL('../frontend/styles/sliders.css', import.meta.url), 'utf-8');
        const outside = css.replace(sliders, '');
        expect(outside).not.toMatch(/::-webkit-slider-(thumb|runnable-track)|::-moz-range-/);
        expect(sliders).toMatch(/input\[type="range"\]::-webkit-slider-thumb/);
    });

    it('la partie remplie suit --fill', () => {
        const sliders = readFileSync(new URL('../frontend/styles/sliders.css', import.meta.url), 'utf-8');
        expect(sliders).toMatch(/var\(--fill/);
        expect(sliders).toMatch(/@property --fill/);
        // sinon le pseudo-élément de piste ne reçoit jamais la valeur posée sur l'input
        expect(sliders).toMatch(/@property --fill\s*\{[^}]*inherits:\s*true/);
    });
});
