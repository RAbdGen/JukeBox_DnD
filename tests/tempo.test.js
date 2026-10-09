import { describe, expect, it } from 'vitest';
import { beatSyncedPosition, sanitizeTempo } from '../backend/tempo.js';

const A = { bpm: 120, offsetMs: 500 };
const B = { bpm: 60, offsetMs: 1000 };

describe('beatSyncedPosition (#18)', () => {
    it('applique Z2 = (Z1 − Y1) × (X1 / X2) + Y2', () => {
        // 10 s après le 1er temps de A (120 BPM) = 20 temps → 20 s dans B (60 BPM), + Y2
        expect(beatSyncedPosition({ from: A, to: B, position: 10.5, targetDuration: 300 })).toBeCloseTo(21);
    });

    it('null si l\'une des deux versions n\'a pas de tempo (comportement par défaut)', () => {
        expect(beatSyncedPosition({ from: A, to: undefined, position: 10, targetDuration: 300 })).toBeNull();
        expect(beatSyncedPosition({ from: null, to: B, position: 10, targetDuration: 300 })).toBeNull();
    });

    it('switch avant le premier temps de A : reprise au premier temps de B', () => {
        expect(beatSyncedPosition({ from: A, to: B, position: 0.2, targetDuration: 300 })).toBe(1);
    });

    it('au-delà de la fin de B : on retranche la zone après son premier temps autant que nécessaire (#50)', () => {
        // Z2 = (50.5 − 0.5) × 2 + 1 = 101 ; B dure 41 s, premier temps à 1 s → zone de 40 s : 101 − 40 − 40 = 21
        expect(beatSyncedPosition({ from: A, to: B, position: 50.5, targetDuration: 41 })).toBeCloseTo(21);
        // pile un tour de plus : premier temps de B
        expect(beatSyncedPosition({ from: A, to: B, position: 60.5, targetDuration: 41 })).toBeCloseTo(1);
        expect(beatSyncedPosition({ from: A, to: B, position: 15.5, targetDuration: 41 })).toBeCloseTo(31);
    });

    it('même tempo et premier temps à 0 (comportement par défaut) : 1:23 → 0:24 pour une cible de 59 s (#50)', () => {
        const same = { bpm: 1, offsetMs: 0 };
        expect(beatSyncedPosition({ from: same, to: same, position: 83, targetDuration: 59 })).toBeCloseTo(24);
        expect(beatSyncedPosition({ from: same, to: same, position: 143, targetDuration: 59 })).toBeCloseTo(25);
    });

    it('premier temps à 5 s sur une cible de 59 s : on retranche 54 s (#50)', () => {
        const from = { bpm: 120, offsetMs: 0 };
        const to = { bpm: 120, offsetMs: 5000 };
        // Z2 = 120 + 5 = 125 → 125 − 54 − 54 = 17
        expect(beatSyncedPosition({ from, to, position: 120, targetDuration: 59 })).toBeCloseTo(17);
    });

    it('zone vide (premier temps au-delà de la fin) : premier temps', () => {
        expect(beatSyncedPosition({ from: A, to: { bpm: 60, offsetMs: 50000 }, position: 60.5, targetDuration: 41 })).toBe(50);
    });

    it('durée de B inconnue (pas encore chargée) : pas de bornage', () => {
        expect(beatSyncedPosition({ from: A, to: B, position: 60.5, targetDuration: 0 })).toBeCloseTo(121);
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
