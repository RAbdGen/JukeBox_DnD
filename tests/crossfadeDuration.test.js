import { describe, expect, it } from 'vitest';
import {
    legacyPercentToSeconds,
    normalizeCrossfadeDurationSeconds,
} from '../backend/crossfadeDuration.js';

describe('crossfadeDuration (#28)', () => {
    it('garde une durée valide et ramène les invalides à 5 s', () => {
        expect(normalizeCrossfadeDurationSeconds(2.5)).toBe(2.5);
        expect(normalizeCrossfadeDurationSeconds('3')).toBe(3);
        for (const invalid of [undefined, null, '', 'abc', 0.2, 11, NaN]) {
            expect(normalizeCrossfadeDurationSeconds(invalid)).toBe(5);
        }
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
