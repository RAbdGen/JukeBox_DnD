import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTooltipTimer, isIconOnly, placeTooltip, OPEN_DELAY_MS, SKIP_DELAY_MS } from '../frontend/tooltipPosition.js';

const viewport = { width: 1000, height: 800 };
const tip = { width: 120, height: 30 };
// Bouton de 40×40 au milieu de l'écran
const trigger = (left, top) => ({ left, top, width: 40, height: 40 });

describe('placeTooltip (#38)', () => {
    it('place la bulle au-dessus, centrée sur l\'élément', () => {
        const place = placeTooltip({ trigger: trigger(480, 400), tip, viewport });
        expect(place.side).toBe('top');
        expect(place.left).toBe(500 - 60);
        expect(place.top).toBe(400 - 8 - 30);
        expect(place.arrowLeft).toBe(60);
    });

    it('bascule dessous quand il n\'y a pas la place au-dessus', () => {
        const place = placeTooltip({ trigger: trigger(480, 10), tip, viewport });
        expect(place.side).toBe('bottom');
        expect(place.top).toBe(10 + 40 + 8);
    });

    it('reste au-dessus si la place manque aussi dessous', () => {
        const place = placeTooltip({ trigger: { left: 480, top: 20, width: 40, height: 770 }, tip, viewport });
        expect(place.side).toBe('top');
    });

    it('se décale pour rester dans la fenêtre, la flèche suit l\'élément', () => {
        const left = placeTooltip({ trigger: trigger(0, 400), tip, viewport });
        expect(left.left).toBe(8);
        expect(left.arrowLeft).toBe(20 - 8);

        const right = placeTooltip({ trigger: trigger(960, 400), tip, viewport });
        expect(right.left).toBe(1000 - 8 - 120);
        expect(right.arrowLeft).toBe(980 - (1000 - 8 - 120));
    });

    it('garde la flèche sur la bulle même pour un élément au bord', () => {
        const place = placeTooltip({ trigger: { left: 0, top: 400, width: 4, height: 40 }, tip, viewport });
        expect(place.arrowLeft).toBeGreaterThanOrEqual(10);
        expect(place.arrowLeft).toBeLessThanOrEqual(tip.width - 10);
    });
});

describe('isIconOnly (#38)', () => {
    it('vrai pour un glyphe ou un emoji sans lettre', () => {
        for (const text of ['⏮', '■', '▶', '✕', '↑', '✂', '✏️', '＋', '⟳', ' + ']) {
            expect(isIconOnly(text), text).toBe(true);
        }
    });

    it('faux dès qu\'il y a une lettre (libellé visible)', () => {
        for (const text of ['Calme', 'combat', '▶ Lire', 'Été', '1']) {
            expect(isIconOnly(text), text).toBe(false);
        }
    });

    it('vrai pour un élément vide (champ, curseur)', () => {
        expect(isIconOnly('')).toBe(true);
        expect(isIconOnly(undefined)).toBe(true);
    });
});

describe('createTooltipTimer (#38)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('ouvre après 500 ms de survol', () => {
        const timer = createTooltipTimer();
        const open = vi.fn();
        timer.schedule(open);
        vi.advanceTimersByTime(OPEN_DELAY_MS - 1);
        expect(open).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(open).toHaveBeenCalledOnce();
    });

    it('n\'ouvre rien si le survol cesse avant 500 ms', () => {
        const timer = createTooltipTimer();
        const open = vi.fn();
        timer.schedule(open);
        vi.advanceTimersByTime(300);
        timer.cancel();
        vi.advanceTimersByTime(1000);
        expect(open).not.toHaveBeenCalled();
    });

    it('ouvre immédiatement dans les 300 ms qui suivent une fermeture', () => {
        const timer = createTooltipTimer();
        timer.markClosed();
        vi.advanceTimersByTime(SKIP_DELAY_MS - 1);
        const open = vi.fn();
        timer.schedule(open);
        expect(open).toHaveBeenCalledOnce();
    });

    it('reprend le délai complet passé la fenêtre de 300 ms', () => {
        const timer = createTooltipTimer();
        timer.markClosed();
        vi.advanceTimersByTime(SKIP_DELAY_MS);
        const open = vi.fn();
        timer.schedule(open);
        expect(open).not.toHaveBeenCalled();
        vi.advanceTimersByTime(OPEN_DELAY_MS);
        expect(open).toHaveBeenCalledOnce();
    });

    it('ouvre immédiatement sur demande (focus clavier)', () => {
        const timer = createTooltipTimer();
        const open = vi.fn();
        timer.schedule(open, { immediate: true });
        expect(open).toHaveBeenCalledOnce();
    });

    it('une nouvelle demande remplace celle en attente', () => {
        const timer = createTooltipTimer();
        const first = vi.fn();
        const second = vi.fn();
        timer.schedule(first);
        vi.advanceTimersByTime(200);
        timer.schedule(second);
        vi.advanceTimersByTime(OPEN_DELAY_MS);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledOnce();
    });
});

describe('plus aucun title natif (#38)', () => {
    const read = path => readFileSync(new URL(`../frontend/${path}`, import.meta.url), 'utf-8');
    const scripts = readdirSync(new URL('../frontend/', import.meta.url)).filter(name => name.endsWith('.js'));

    it('index.html passe par data-tooltip / data-i18n-tooltip', () => {
        const html = read('index.html').replace(/<title>.*?<\/title>/s, '');
        expect(html).not.toMatch(/\stitle=/);
        expect(html).not.toMatch(/data-i18n-title/);
    });

    it('les scripts passent par setTooltip(), jamais par .title ou title="…"', () => {
        for (const name of scripts) {
            const code = read(name).replace(/document\.title\s*=/g, '');
            expect(code, name).not.toMatch(/\.title\s*=[^=]/);
            expect(code, name).not.toMatch(/\stitle="/);
            expect(code, name).not.toMatch(/i18nTitle|data-i18n-title/);
        }
    });
});
