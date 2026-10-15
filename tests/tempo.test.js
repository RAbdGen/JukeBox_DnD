import { describe, expect, it } from 'vitest';
import { beatSyncedPosition, createTapTempo, sanitizeTempo } from '../backend/tempo.js';

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

    it('switch avant le premier temps de A : même écart en temps avant celui de B (#60)', () => {
        // A (120 BPM, 1er temps à 0,5 s) à 0,2 s : 0,3 s avant = 0,6 temps → 0,6 s avant le 1er temps de B (60 BPM, 1 s)
        expect(beatSyncedPosition({ from: A, to: B, position: 0.2, targetDuration: 300 })).toBeCloseTo(0.4);
    });

    it('avant le premier temps, résultat négatif : plafonné au début de la cible (#60)', () => {
        const from = { bpm: 120, offsetMs: 60000 };
        const to = { bpm: 120, offsetMs: 2000 };
        // 59 s avant le 1er temps de A → 57 s avant celui de B, soit −57 s : début de B
        expect(beatSyncedPosition({ from, to, position: 1, targetDuration: 300 })).toBe(0);
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

describe('createTapTempo (#56, #61)', () => {
    it('un seul tap ne donne rien, le deuxième donne le BPM de l\'intervalle', () => {
        const tap = createTapTempo();
        expect(tap(1000)).toBeNull();
        expect(tap(1500)).toBe(120);
    });

    it('droite ajustée sur tous les taps, arrondie au dixième', () => {
        const tap = createTapTempo();
        [0, 510, 1000].forEach(at => tap(at));
        expect(tap(1500)).toBe(120.2); // pente 499 ms par tap
    });

    it('garde les 20 derniers taps par défaut : un début approximatif finit par être oublié', () => {
        const tap = createTapTempo();
        // 25 taps réguliers à 120 BPM, précédés de trois taps approximatifs
        const times = [0, 300, 900, ...Array.from({ length: 25 }, (_, i) => 1500 + i * 500)];
        const results = times.map(at => tap(at));
        expect(results.at(-1)).toBe(120);
    });

    it('la régression absorbe le bruit des taps humains (±40 ms en alternance)', () => {
        const tap = createTapTempo();
        let bpm = null;
        for (let i = 0; i < 20; i++) bpm = tap(i * 500 + (i % 2 ? 40 : -40));
        expect(bpm).toBeGreaterThan(119);
        expect(bpm).toBeLessThan(121);
    });

    it('le nombre de taps gardés est réglable', () => {
        const tap = createTapTempo({ maxTaps: 4 });
        [0, 900, 1400, 1900].forEach(at => tap(at));
        expect(tap(2400)).toBe(120); // il ne reste que 900, 1400, 1900, 2400
    });

    it('une pause trop longue recommence le comptage', () => {
        const tap = createTapTempo({ resetAfterMs: 3000 });
        tap(0); tap(500);
        expect(tap(10000)).toBeNull();
        expect(tap(10600)).toBe(100);
    });

    it('hors de 20–400 BPM : rien (le champ reste tel quel)', () => {
        const tap = createTapTempo({ resetAfterMs: 10000 });
        tap(0);
        expect(tap(100)).toBeNull(); // 600 BPM
        const slow = createTapTempo({ resetAfterMs: 10000 });
        slow(0);
        expect(slow(4000)).toBeNull(); // 15 BPM
    });
});
