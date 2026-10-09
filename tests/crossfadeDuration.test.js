import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    legacyPercentToSeconds,
    normalizeCrossfadeDurationSeconds,
} from '../backend/crossfadeDuration.js';

describe('crossfadeDuration (#28)', () => {
    it('garde une durée valide et ramène les invalides à 5 s', () => {
        expect(normalizeCrossfadeDurationSeconds(2.5)).toBe(2.5);
        expect(normalizeCrossfadeDurationSeconds('3')).toBe(3);
        for (const invalid of [undefined, null, '', 'abc', -0.5, 11, NaN]) {
            expect(normalizeCrossfadeDurationSeconds(invalid)).toBe(5);
        }
    });

    it('accepte 0 s : pas de fondu du tout (pour qui n\'en veut pas)', () => {
        expect(normalizeCrossfadeDurationSeconds(0)).toBe(0);
        expect(normalizeCrossfadeDurationSeconds('0')).toBe(0);
        const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
        expect(html).toMatch(/id="edit-track-crossfade-duration" min="0" max="10"/);
    });

    it('convertit un ancien % comme l\'ancien calcul (% × durée, borné à 0,5–5 s)', () => {
        expect(legacyPercentToSeconds(0.1, 30)).toBe(3);    // 3 s
        expect(legacyPercentToSeconds(0.1, 180)).toBe(5);   // 18 s → plafonné à 5 s
        expect(legacyPercentToSeconds(0.01, 20)).toBe(0.5); // 0,2 s → plancher 0,5 s
        expect(legacyPercentToSeconds(0.05, 43)).toBe(2);   // 2,15 s → arrondi au pas de 0,5 s
    });

    it('suppose 30 s si la durée est inconnue (comportement historique)', () => {
        expect(legacyPercentToSeconds(0.1, undefined)).toBe(3);
        expect(legacyPercentToSeconds(0.1, 0)).toBe(3);
    });
});
