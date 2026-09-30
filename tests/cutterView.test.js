import { describe, expect, it } from 'vitest';
import { createLatestOnly } from '../frontend/cutterView.js';

describe('createLatestOnly (revue finale #24)', () => {
    it('seul le dernier chargement lancé peut appliquer son résultat', () => {
        const latest = createLatestOnly();
        const trackB = latest.start(); // retouche d'une piste longue, lente à décoder
        const fileA = latest.start(); // puis choix d'un autre fichier pendant le décodage

        expect(latest.isCurrent(trackB)).toBe(false);
        expect(latest.isCurrent(fileA)).toBe(true);
    });

    it('annuler invalide le chargement en cours', () => {
        const latest = createLatestOnly();
        const load = latest.start();

        latest.cancel();

        expect(latest.isCurrent(load)).toBe(false);
    });
});
