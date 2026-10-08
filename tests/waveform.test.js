import { describe, expect, it, vi } from 'vitest';
import {
    addSamplesToPeaks,
    computePeaks,
    decodeChunks,
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

describe('tranches MP3 (#36)', () => {
    it('addSamplesToPeaks place les échantillons à leur temps (100 cases par seconde)', () => {
        const peaks = { min: new Float32Array(4), max: new Float32Array(4) };
        // 200 Hz, départ à 0,015 s → échantillons à 0,015 / 0,020 / 0,025 / 0,030 s
        addSamplesToPeaks(peaks, new Float32Array([0.5, -0.25, 0.75, -1]), 0.015, 200);
        expect([...peaks.max]).toEqual([0, 0.5, 0.75, 0]);
        expect([...peaks.min]).toEqual([0, 0, -0.25, -1]);
    });

    it('addSamplesToPeaks ignore ce qui sort de la waveform', () => {
        const peaks = { min: new Float32Array(2), max: new Float32Array(2) };
        addSamplesToPeaks(peaks, new Float32Array([1, 1, 1]), -0.01, 100);
        expect([...peaks.max]).toEqual([1, 1]);
    });

    it('decodeChunks : chaque tranche décodée est calée sur sa fin exacte, puis libérée', async () => {
        const info = { duration: 0.04, chunks: [{ offset: 0, length: 10, endTime: 0.02 }, { offset: 10, length: 10, endTime: 0.04 }] };
        const readRange = vi.fn(async (offset, length) => new Uint8Array(length).fill(offset));
        // 2e tranche : une trame perdue au début (décodée plus courte) → décalée vers sa fin
        const decode = vi.fn(async bytes => (bytes[0] === 0
            ? { sampleRate: 100, samples: new Float32Array([0.1, 0.2]) }
            : { sampleRate: 100, samples: new Float32Array([0.9]) }));

        const result = await decodeChunks(info, readRange, { decode });

        expect(readRange.mock.calls).toEqual([[0, 10], [10, 10]]);
        expect(result.duration).toBe(0.04);
        expect([...result.peaks.max].map(v => Math.round(v * 10) / 10)).toEqual([0.1, 0.2, 0, 0.9]);
    });

    it('decodeChunks s\'arrête si le chargement est abandonné', async () => {
        const info = { duration: 0.02, chunks: [{ offset: 0, length: 1, endTime: 0.01 }, { offset: 1, length: 1, endTime: 0.02 }] };
        const readRange = vi.fn(async () => new Uint8Array(1));
        const decode = vi.fn(async () => ({ sampleRate: 100, samples: new Float32Array([0.5]) }));
        let calls = 0;

        const result = await decodeChunks(info, readRange, { decode, isCancelled: () => ++calls > 1 });

        expect(result).toBeNull();
        expect(readRange).toHaveBeenCalledOnce();
    });
});
