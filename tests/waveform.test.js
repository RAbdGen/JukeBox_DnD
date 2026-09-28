import { describe, expect, it, vi } from 'vitest';
import {
    computePeaks,
    decodeForWaveform,
    fullView,
    mixToMono,
    scrollView,
    timeToX,
    xToTime,
    zoomView,
} from '../frontend/waveform.js';

describe('computePeaks', () => {
    it('calcule min/max par tranche, y compris taille non multiple', () => {
        const peaks = computePeaks(new Float32Array([0.1, -0.5, 0.3, 0.9, -0.2]), 2);
        expect(Array.from(peaks.min)).toEqual([-0.5, -0.2].map(Math.fround));
        expect(Array.from(peaks.max)).toEqual([0.1, 0.9].map(Math.fround));
    });

    it('silence → zéros', () => {
        const peaks = computePeaks(new Float32Array(10), 5);
        expect(Array.from(peaks.max)).toEqual([0, 0, 0, 0, 0]);
    });
});

describe('decodeForWaveform', () => {
    it('décode à 8 kHz et mixe en mono (fichiers longs)', async () => {
        const buffer = {
            duration: 2,
            numberOfChannels: 2,
            getChannelData: i => new Float32Array(16000).fill(i === 0 ? 1 : 0),
        };
        const createContext = vi.fn(() => ({ decodeAudioData: vi.fn().mockResolvedValue(buffer) }));

        const result = await decodeForWaveform(new ArrayBuffer(8), { createContext });

        expect(createContext).toHaveBeenCalledWith(8000);
        expect(result.duration).toBe(2);
        expect(result.peaks.max.length).toBe(200); // 100 pics / s
        expect(result.peaks.max[0]).toBeCloseTo(0.5); // moyenne des 2 canaux
    });

    it('mixToMono laisse un canal unique tel quel', () => {
        const mono = new Float32Array([1, 2]);
        expect(mixToMono([mono])).toBe(mono);
    });
});

describe('vue (zoom et défilement)', () => {
    it('convertit temps ↔ x', () => {
        const view = { start: 10, end: 20 };
        expect(timeToX(15, view, 200)).toBe(100);
        expect(xToTime(50, view, 200)).toBe(12.5);
    });

    it('zoome autour du point visé, sans descendre sous 4 s visibles', () => {
        expect(zoomView({ start: 0, end: 100 }, 2, 50, 100)).toEqual({ start: 25, end: 75 });
        expect(zoomView({ start: 0, end: 8 }, 10, 0, 100)).toEqual({ start: 0, end: 4 });
    });

    it('dézoome sans dépasser le fichier', () => {
        expect(zoomView({ start: 90, end: 100 }, 0.1, 95, 100)).toEqual({ start: 0, end: 100 });
    });

    it('défile en restant dans le fichier', () => {
        expect(scrollView({ start: 10, end: 20 }, 100, 50)).toEqual({ start: 40, end: 50 });
        expect(scrollView({ start: 10, end: 20 }, -100, 50)).toEqual({ start: 0, end: 10 });
    });

    it('vue complète', () => {
        expect(fullView(42)).toEqual({ start: 0, end: 42 });
    });
});
