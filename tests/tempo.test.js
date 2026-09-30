import { describe, expect, it } from 'vitest';
import { beatSyncedPosition, sanitizeTempo } from '../backend/tempo.js';

const A = { bpm: 120, offsetMs: 500 };
const B = { bpm: 60, offsetMs: 1000 };

describe('beatSyncedPosition (#18)', () => {
    it('applique Z2 = (Z1 − Y1) × (X1 / X2) + Y2', () => {
        // 10 s après le 1er temps de A (120 BPM) = 20 temps → 20 s dans B (60 BPM), + Y2
        expect(beatSyncedPosition({ from: A, to: B, position: 10.5, targetDuration: 300, loop: false })).toBeCloseTo(21);
    });

    it('null si l\'une des deux versions n\'a pas de tempo (comportement par défaut)', () => {
        expect(beatSyncedPosition({ from: A, to: undefined, position: 10, targetDuration: 300, loop: false })).toBeNull();
        expect(beatSyncedPosition({ from: null, to: B, position: 10, targetDuration: 300, loop: false })).toBeNull();
    });

    it('switch avant le premier temps de A : reprise au premier temps de B', () => {
        expect(beatSyncedPosition({ from: A, to: B, position: 0.2, targetDuration: 300, loop: false })).toBe(1);
    });

    it('au-delà de la fin de B : modulo sur la zone bouclée si la piste boucle, sinon premier temps', () => {
        // Z2 = (60.5 − 0.5) × 2 + 1 = 121 ; B dure 41 s, zone bouclée = [1, 41[ (40 s) → 1 + (120 mod 40) = 1
        expect(beatSyncedPosition({ from: A, to: B, position: 60.5, targetDuration: 41, loop: true })).toBeCloseTo(1);
        expect(beatSyncedPosition({ from: A, to: B, position: 50.5, targetDuration: 41, loop: true })).toBeCloseTo(21);
        expect(beatSyncedPosition({ from: A, to: B, position: 60.5, targetDuration: 41, loop: false })).toBe(1);
    });

    it('durée de B inconnue (pas encore chargée) : pas de bornage', () => {
        expect(beatSyncedPosition({ from: A, to: B, position: 60.5, targetDuration: 0, loop: false })).toBeCloseTo(121);
    });
});

describe('sanitizeTempo (#18)', () => {
    it('garde les tempos valides des versions existantes, décalage absent = 0', () => {
        expect(sanitizeTempo({ calm: { bpm: '120', offsetMs: 250 }, combat: { bpm: 90 } }, ['calm', 'combat']))
            .toEqual({ calm: { bpm: 120, offsetMs: 250 }, combat: { bpm: 90, offsetMs: 0 } });
    });

    it('retire BPM hors 20–400, décalage négatif, versions inconnues ; undefined si plus rien', () => {
        expect(sanitizeTempo({
            calm: { bpm: 10, offsetMs: 0 },
            combat: { bpm: 120, offsetMs: -5 },
            boss: { bpm: 120, offsetMs: 0 },
        }, ['calm', 'combat'])).toBeUndefined();
        expect(sanitizeTempo('nope', ['calm'])).toBeUndefined();
    });
});
