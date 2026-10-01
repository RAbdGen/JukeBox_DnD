import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { t } from '../backend/i18n.js';

const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf-8');
const renderer = readFileSync(new URL('../frontend/renderer.js', import.meta.url), 'utf-8');
const MODALS = ['add-track-modal', 'create-playlist-modal', 'edit-track-modal'];

describe('modals en <dialog> natif (#41)', () => {
    it('les 3 modals sont des <dialog class="modal">, plus aucun <div class="modal"', () => {
        for (const id of MODALS) {
            expect(html, id).toMatch(new RegExp(`<dialog id="${id}" class="modal"`));
        }
        expect(html).not.toMatch(/<div[^>]*class="modal[ "]/);
    });

    it('chaque modal est nommée par un titre qui existe', () => {
        for (const id of MODALS) {
            const labelledBy = html.match(new RegExp(`<dialog id="${id}"[^>]*aria-labelledby="([^"]+)"`))?.[1];
            expect(labelledBy, id).toBeTruthy();
            expect(html, `${id} → #${labelledBy}`).toMatch(new RegExp(`<h2 id="${labelledBy}"`));
        }
    });

    it('aucun id en double dans index.html', () => {
        const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
        expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    });

    it('chaque modal donne le focus à son premier champ (autofocus)', () => {
        for (const id of MODALS) {
            const body = html.slice(html.indexOf(`<dialog id="${id}"`), html.indexOf('</dialog>', html.indexOf(`<dialog id="${id}"`)));
            expect(body.match(/autofocus/g), id).toHaveLength(1);
        }
    });

    it('le bouton × a un nom traduit', () => {
        const closeButtons = html.match(/<button[^>]*class="close-modal-btn"[^>]*>/g) ?? [];
        expect(closeButtons).toHaveLength(3);
        for (const button of closeButtons) expect(button).toMatch(/data-i18n-tooltip="modal\.close"/);
        expect(t('fr', 'modal.close')).toBe('Fermer');
        expect(t('en', 'modal.close')).toBe('Close');
    });

    it('renderer.js passe par openModal/closeModal, sans gérer le défilement à la main', () => {
        expect(renderer).not.toMatch(/body\.style\.overflow/);
        expect(renderer).not.toMatch(/querySelectorAll\('\.modal'\)/);
        expect(renderer).not.toMatch(/[Mm]odal\.classList\.(add|remove)\('hidden'\)/);
        expect(renderer).toMatch(/openModal\(/);
        expect(renderer).toMatch(/closeModal\(/);
    });
});
