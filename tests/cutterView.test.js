import { readFileSync } from 'node:fs';
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

describe('Découpage : onglets de fichiers (#45)', () => {
    const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
    it('liste d\'onglets étiquetée, panneau, ajout et retrait de fichier, récapitulatif', () => {
        expect(html).toMatch(/id="split-tabs"[^>]*role="tablist"[^>]*data-i18n-label="split.filesLabel"/);
        expect(html).toMatch(/id="split-editor"[^>]*role="tabpanel"/);
        expect(html).toMatch(/id="split-add-file"[^>]*data-i18n="split.addFile"/);
        expect(html).toMatch(/id="split-remove-file"[^>]*data-i18n="split.removeFile"/);
        expect(html).toMatch(/id="split-summary"/);
        expect(html).not.toMatch(/id="split-choose-file"/);
    });
});
