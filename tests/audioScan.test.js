import { describe, expect, it } from 'vitest';
import { createMp3Scanner, createPeakAccumulator, parseWavHeader } from '../backend/audioScan.js';

// ── Fabrication de fichiers de test ─────────────────────────

function wav({ format = 1, channels = 2, sampleRate = 44100, bits = 16, data = new Uint8Array(0), extra = [], dataSize }) {
    const blockAlign = channels * bits / 8;
    const chunks = [];
    const chunk = (id, body) => {
        const head = new Uint8Array(8);
        head.set([...id].map(c => c.charCodeAt(0)));
        new DataView(head.buffer).setUint32(4, body.length, true);
        chunks.push(head, body);
        if (body.length % 2) chunks.push(new Uint8Array(1)); // remplissage RIFF
    };
    const fmt = new Uint8Array(format === 0xFFFE ? 40 : 16);
    const view = new DataView(fmt.buffer);
    view.setUint16(0, format, true);
    view.setUint16(2, channels, true);
    view.setUint32(4, sampleRate, true);
    view.setUint32(8, sampleRate * blockAlign, true);
    view.setUint16(12, blockAlign, true);
    view.setUint16(14, bits, true);
    if (format === 0xFFFE) view.setUint16(24, 1, true); // sous-format PCM
    chunk('fmt ', fmt);
    extra.forEach(([id, body]) => chunk(id, body));
    chunk('data', data);
    const body = concat(new TextEncoder().encode('WAVE'), ...chunks);
    const out = concat(new TextEncoder().encode('RIFF'), new Uint8Array(4), body);
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
    if (dataSize !== undefined) {
        const at = indexOf(out, 'data');
        new DataView(out.buffer).setUint32(at + 4, dataSize, true);
    }
    return out;
}

function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    parts.forEach(p => { out.set(p, at); at += p.length; });
    return out;
}

function indexOf(bytes, text) {
    const codes = [...text].map(c => c.charCodeAt(0));
    for (let i = 0; i < bytes.length; i++) if (codes.every((c, j) => bytes[i + j] === c)) return i;
    return -1;
}

function int16Frames(frames) {
    const out = new Uint8Array(frames.length * frames[0].length * 2);
    const view = new DataView(out.buffer);
    frames.flat().forEach((v, i) => view.setInt16(i * 2, v, true));
    return out;
}

// MPEG-1 Layer III, 44,1 kHz : 128 kb/s → 417 octets (418 avec remplissage), 1152 échantillons
function mp3Frame({ bitrateIndex = 9, sampleRateIndex = 0, padding = 0, mono = false, mpeg2 = false, xing = false, lame = null } = {}) {
    const bitrates = mpeg2 ? [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] : [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    const rates = mpeg2 ? [22050, 24000, 16000] : [44100, 48000, 32000];
    const length = Math.floor(((mpeg2 ? 72 : 144) * bitrates[bitrateIndex] * 1000) / rates[sampleRateIndex]) + padding;
    const frame = new Uint8Array(length).fill(0x55);
    frame[0] = 0xFF;
    frame[1] = mpeg2 ? 0xF3 : 0xFB;
    frame[2] = (bitrateIndex << 4) | (sampleRateIndex << 2) | (padding << 1);
    frame[3] = mono ? 0xC0 : 0x00;
    const tagAt = 4 + (mpeg2 ? (mono ? 9 : 17) : (mono ? 17 : 32));
    if (xing) {
        frame.set(new TextEncoder().encode('Info'), tagAt);
        frame.set([0, 0, 0, 0x0F], tagAt + 4); // drapeaux : trames, octets, TOC, qualité
        if (lame) {
            const at = tagAt + 8 + 4 + 4 + 100 + 4; // tag LAME
            frame.set(new TextEncoder().encode('LAME3.100'), at);
            frame.set([lame.delay >> 4, ((lame.delay & 0xF) << 4) | (lame.padding >> 8), lame.padding & 0xFF], at + 21);
        }
    }
    return frame;
}

function id3v2(bodyLength) {
    const tag = new Uint8Array(10 + bodyLength);
    tag.set([0x49, 0x44, 0x33, 4, 0, 0]);
    tag.set([(bodyLength >> 21) & 0x7F, (bodyLength >> 14) & 0x7F, (bodyLength >> 7) & 0x7F, bodyLength & 0x7F], 6);
    return tag;
}

function scan(bytes, blockSize, chunkBytes) {
    const scanner = createMp3Scanner({ chunkBytes, fileSize: bytes.length });
    for (let i = 0; i < bytes.length; i += blockSize) scanner.push(bytes.subarray(i, i + blockSize));
    return scanner.finish();
}

// ── WAV ─────────────────────────────────────────────────────

describe('parseWavHeader (#36)', () => {
    it('PCM 16 bits stéréo, chunk LIST avant data (remplissage impair)', () => {
        const data = int16Frames([[1, 2], [3, 4]]);
        const bytes = wav({ data, extra: [['LIST', new Uint8Array(3)]] });
        expect(parseWavHeader(bytes, bytes.length)).toEqual({
            format: 'int', channels: 2, sampleRate: 44100, bitsPerSample: 16, blockAlign: 4,
            dataOffset: indexOf(bytes, 'data') + 8, dataLength: 8,
        });
    });

    it('float 32 bits, et WAVE_FORMAT_EXTENSIBLE à sous-format PCM', () => {
        expect(parseWavHeader(wav({ format: 3, bits: 32 }), 100).format).toBe('float');
        expect(parseWavHeader(wav({ format: 0xFFFE, bits: 24 }), 100)).toMatchObject({ format: 'int', bitsPerSample: 24 });
    });

    it('taille de data absente ou fausse (enregistrement en flux) : bornée au fichier', () => {
        const bytes = wav({ data: new Uint8Array(40), dataSize: 0xFFFFFFFF });
        const header = parseWavHeader(bytes, bytes.length);
        expect(header.dataLength).toBe(40);
    });

    it('compressé (ADPCM), pas RIFF, ou data introuvable : null', () => {
        expect(parseWavHeader(wav({ format: 2 }), 100)).toBeNull();
        expect(parseWavHeader(new TextEncoder().encode('ID3 pas un wav du tout'), 100)).toBeNull();
        const noData = wav({});
        expect(parseWavHeader(noData.subarray(0, indexOf(noData, 'data')), 1000)).toBeNull();
    });
});

describe('createPeakAccumulator (#36)', () => {
    const header = { format: 'int', channels: 2, sampleRate: 200, bitsPerSample: 16, blockAlign: 4 };

    it('mixe en mono et garde min/max par centième de seconde', () => {
        // 200 Hz → 2 trames par case ; 3 trames → 2 cases
        const acc = createPeakAccumulator({ ...header, totalFrames: 3 });
        acc.push(int16Frames([[16384, 0], [-32768, -32768], [8192, 8192]]));
        const { min, max } = acc.finish();
        expect([...min]).toEqual([-1, 0]);
        expect([...max]).toEqual([0.25, 0.25]);
    });

    it('blocs coupés au milieu d\'une trame : même résultat qu\'en un seul bloc', () => {
        const bytes = int16Frames([[100, 200], [-300, 400], [500, -600], [700, 800]]);
        const whole = createPeakAccumulator({ ...header, totalFrames: 4 });
        whole.push(bytes);
        const split = createPeakAccumulator({ ...header, totalFrames: 4 });
        [bytes.subarray(0, 3), bytes.subarray(3, 9), bytes.subarray(9)].forEach(part => split.push(part));
        expect(split.finish()).toEqual(whole.finish());
    });

    it('24 bits, 8 bits non signé et float 32', () => {
        const pcm24 = createPeakAccumulator({ format: 'int', channels: 1, sampleRate: 100, bitsPerSample: 24, blockAlign: 3, totalFrames: 1 });
        pcm24.push(new Uint8Array([0x00, 0x00, 0xC0])); // -4194304 / 8388608
        expect(pcm24.finish().min[0]).toBe(-0.5);

        const pcm8 = createPeakAccumulator({ format: 'int', channels: 1, sampleRate: 100, bitsPerSample: 8, blockAlign: 1, totalFrames: 1 });
        pcm8.push(new Uint8Array([192])); // (192 − 128) / 128
        expect(pcm8.finish().max[0]).toBe(0.5);

        const float = createPeakAccumulator({ format: 'float', channels: 1, sampleRate: 100, bitsPerSample: 32, blockAlign: 4, totalFrames: 1 });
        float.push(new Uint8Array(new Float32Array([-0.75]).buffer));
        expect(float.finish().min[0]).toBe(-0.75);
    });
});

// ── MP3 ─────────────────────────────────────────────────────

describe('createMp3Scanner (#36)', () => {
    it('durée exacte : tag ID3v2 sauté, trame Xing ignorée, ID3v1 final ignoré', () => {
        const frames = Array.from({ length: 10 }, (_, i) => mp3Frame({ padding: i % 2 }));
        const bytes = concat(id3v2(20), mp3Frame({ xing: true }), ...frames, new TextEncoder().encode('TAG'), new Uint8Array(125));
        const result = scan(bytes, 1000, 1 << 20);
        expect(result.duration).toBeCloseTo(10 * 1152 / 44100, 9);
        expect(result.sampleRate).toBe(44100);
    });

    it('tranches coupées sur des frontières de trame, la première depuis le début du fichier', () => {
        const frames = Array.from({ length: 10 }, () => mp3Frame());
        const bytes = concat(id3v2(20), ...frames);
        const result = scan(bytes, 333, 1000); // ≥ 1000 octets par tranche : 3 trames
        expect(result.chunks.map(c => c.offset)).toEqual([0, 30 + 3 * 417, 30 + 6 * 417, 30 + 9 * 417]);
        expect(result.chunks.at(-1).offset + result.chunks.at(-1).length).toBe(bytes.length);
        expect(result.chunks.map(c => c.endTime)).toEqual([3, 6, 9, 10].map(n => n * 1152 / 44100));
    });

    it('tag LAME : retard d\'encodage et remplissage retirés comme le fait le décodeur', () => {
        const frames = Array.from({ length: 10 }, () => mp3Frame());
        const bytes = concat(mp3Frame({ xing: true, lame: { delay: 576, padding: 1000 } }), ...frames);
        const result = scan(bytes, 4096, 1000);
        expect(result.duration).toBeCloseTo((10 * 1152 - 576 - 1000) / 44100, 9);
        // le décodeur saute retard + 529 échantillons : chaque fin de tranche avance d'autant
        expect(result.chunks[0].endTime).toBeCloseTo((2 * 1152 - 576 - 529) / 44100, 9);
    });

    it('MPEG-2 (22,05 kHz, 576 échantillons par trame)', () => {
        const frames = Array.from({ length: 4 }, () => mp3Frame({ mpeg2: true, bitrateIndex: 8, mono: true }));
        expect(scan(concat(...frames), 100, 1 << 20).duration).toBeCloseTo(4 * 576 / 22050, 9);
    });

    it('pas un MP3, ou trop d\'octets inexploitables : null (décodage complet)', () => {
        expect(scan(new Uint8Array(5000).fill(7), 512, 1 << 20)).toBeNull();
        const frames = Array.from({ length: 4 }, () => mp3Frame());
        expect(scan(concat(...frames, new Uint8Array(100000).fill(7)), 4096, 1 << 20)).toBeNull();
    });
});
