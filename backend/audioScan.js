/**
 * Analyse des longs fichiers pour la waveform du Découpage (#36), sans
 * décoder tout le fichier d'un bloc (1 h : ~3 Go pour un MP3, ~6 Go pour un
 * WAV). Module pur, partagé par electron/main.cjs (import dynamique) et les
 * tests :
 * - WAV PCM / float : pics calculés directement sur les échantillons, bloc
 *   par bloc (createPeakAccumulator) ;
 * - MP3 : en-têtes de trames parcourus sans décoder (createMp3Scanner) →
 *   durée exacte et tranches coupées sur des frontières de trame, décodées
 *   une à une par le renderer.
 */

export const PEAKS_PER_SECOND = 100; // = frontend/waveform.js
export const WAV_HEADER_BYTES = 64 * 1024;

const text = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));

// ── WAV ─────────────────────────────────────────────────────

/**
 * En-tête RIFF/WAVE lu dans les premiers octets du fichier.
 * @param {Uint8Array} bytes - Début du fichier (WAV_HEADER_BYTES suffisent)
 * @param {number} fileSize - Taille réelle : borne une taille de data absente ou fausse
 * @returns {object|null} null si ce n'est pas un WAV PCM / float exploitable
 */
export function parseWavHeader(bytes, fileSize) {
    if (bytes.length < 12 || text(bytes, 0, 4) !== 'RIFF' || text(bytes, 8, 4) !== 'WAVE') return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let fmt = null;

    for (let at = 12; at + 8 <= bytes.length;) {
        const id = text(bytes, at, 4);
        const size = view.getUint32(at + 4, true);
        const body = at + 8;
        if (id === 'fmt ' && body + 16 <= bytes.length) {
            let code = view.getUint16(body, true);
            if (code === 0xFFFE && size >= 26 && body + 26 <= bytes.length) code = view.getUint16(body + 24, true);
            const bitsPerSample = view.getUint16(body + 14, true);
            const format = code === 1 ? 'int' : code === 3 ? 'float' : null;
            const supported = format === 'int' ? [8, 16, 24, 32].includes(bitsPerSample) : [32, 64].includes(bitsPerSample);
            if (!format || !supported) return null;
            fmt = {
                format,
                channels: view.getUint16(body + 2, true),
                sampleRate: view.getUint32(body + 4, true),
                bitsPerSample,
                blockAlign: view.getUint16(body + 12, true),
            };
            if (!(fmt.channels > 0) || !(fmt.sampleRate > 0) || fmt.blockAlign !== fmt.channels * bitsPerSample / 8) return null;
        } else if (id === 'data') {
            if (!fmt) return null;
            const available = Math.max(0, fileSize - body);
            const dataLength = Math.min(size, available);
            return { ...fmt, dataOffset: body, dataLength: dataLength - (dataLength % fmt.blockAlign) };
        }
        at = body + size + (size % 2);
    }
    return null;
}

function sampleReader({ format, bitsPerSample }) {
    if (format === 'float') {
        return bitsPerSample === 32 ? (v, at) => v.getFloat32(at, true) : (v, at) => v.getFloat64(at, true);
    }
    switch (bitsPerSample) {
        case 8: return (v, at) => (v.getUint8(at) - 128) / 128;
        case 16: return (v, at) => v.getInt16(at, true) / 32768;
        case 24: return (v, at) => {
            const value = v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getInt8(at + 2) << 16);
            return value / 8388608;
        };
        default: return (v, at) => v.getInt32(at, true) / 2147483648;
    }
}

/**
 * Pics min/max (mono, 100 par seconde) alimentés bloc par bloc ; un bloc peut
 * s'arrêter au milieu d'une trame, le reste est gardé pour le suivant.
 */
export function createPeakAccumulator({ format, channels, sampleRate, bitsPerSample, blockAlign, totalFrames }) {
    const bucketCount = Math.max(1, Math.ceil((totalFrames * PEAKS_PER_SECOND) / sampleRate));
    const min = new Float32Array(bucketCount);
    const max = new Float32Array(bucketCount);
    const read = sampleReader({ format, bitsPerSample });
    const bytesPerSample = bitsPerSample / 8;
    let carry = new Uint8Array(0);
    let frame = 0;

    return {
        push(block) {
            let bytes = block;
            if (carry.length > 0) {
                bytes = new Uint8Array(carry.length + block.length);
                bytes.set(carry);
                bytes.set(block, carry.length);
            }
            const usable = bytes.length - (bytes.length % blockAlign);
            const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
            for (let at = 0; at < usable; at += blockAlign, frame++) {
                let sum = 0;
                for (let c = 0; c < channels; c++) sum += read(view, at + c * bytesPerSample);
                const value = sum / channels;
                const bucket = Math.min(bucketCount - 1, Math.floor((frame * PEAKS_PER_SECOND) / sampleRate));
                if (value < min[bucket]) min[bucket] = value;
                if (value > max[bucket]) max[bucket] = value;
            }
            carry = bytes.slice(usable);
        },
        finish: () => ({ min, max }),
    };
}

// ── MP3 ─────────────────────────────────────────────────────

const BITRATES = {
    // [version MPEG-1 | MPEG-2/2.5][couche] en kb/s, index 1–14
    1: { 1: [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], 2: [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], 3: [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] },
    2: { 1: [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], 2: [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], 3: [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] },
};
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
// Retard propre au décodeur MP3, ajouté par ffmpeg/Chromium au retard d'encodage du tag LAME
const DECODER_DELAY = 529;

/**
 * Retard d'encodage et remplissage du tag LAME qui suit l'en-tête Xing/Info :
 * le décodeur de Chromium les retire, on fait de même pour rester calé.
 */
function parseLameGap(bytes, tagAt) {
    const flags = bytes[tagAt + 7];
    let at = tagAt + 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
    if (!/^(LAME|Lavc|Lavf)/.test(text(bytes, at, 4)) || at + 24 > bytes.length) return null;
    at += 21;
    return { delay: (bytes[at] << 4) | (bytes[at + 1] >> 4), padding: ((bytes[at + 1] & 0x0F) << 8) | bytes[at + 2] };
}

/** En-tête de trame MPEG audio à `at`, ou null */
function parseFrameHeader(bytes, at) {
    if (bytes[at] !== 0xFF || (bytes[at + 1] & 0xE0) !== 0xE0) return null;
    const versionBits = (bytes[at + 1] >> 3) & 3;
    const layerBits = (bytes[at + 1] >> 1) & 3;
    const bitrateIndex = bytes[at + 2] >> 4;
    const rateIndex = (bytes[at + 2] >> 2) & 3;
    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;

    const layer = 4 - layerBits; // 1, 2 ou 3
    const mpeg1 = versionBits === 3;
    const bitrate = BITRATES[mpeg1 ? 1 : 2][layer][bitrateIndex - 1] * 1000;
    const sampleRate = SAMPLE_RATES[versionBits][rateIndex];
    const padding = (bytes[at + 2] >> 1) & 1;
    const mono = (bytes[at + 3] >> 6) === 3;

    let length;
    let samples;
    if (layer === 1) {
        length = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
        samples = 384;
    } else {
        const lowRateLayer3 = layer === 3 && !mpeg1;
        length = Math.floor(((lowRateLayer3 ? 72 : 144) * bitrate) / sampleRate) + padding;
        samples = lowRateLayer3 ? 576 : 1152;
    }
    const sideInfo = layer !== 3 ? 0 : mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    return { length, samples, sampleRate, versionBits, layer, sideInfo };
}

/**
 * Parcourt les trames d'un MP3 alimenté bloc par bloc, sans décoder.
 * finish() → { duration, sampleRate, chunks: [{ offset, length, endTime }] },
 * tranches d'au moins `chunkBytes` octets coupées sur des frontières de trame
 * (la première part du début du fichier : tag ID3 compris), ou null si le
 * fichier n'est pas exploitable ainsi (→ décodage complet).
 */
export function createMp3Scanner({ chunkBytes = 4 * 1024 * 1024, fileSize = 0 } = {}) {
    const maxJunk = Math.max(64 * 1024, fileSize * 0.01);
    let carry = new Uint8Array(0);
    let base = 0; // position dans le fichier de carry[0]
    let skip = 0; // octets restants de la trame (ou du tag) en cours
    let started = false;
    let reference = null; // version/couche/fréquence de la première trame
    let junk = 0;
    let firstFrame = true;
    let samples = 0;
    let gap = null; // { delay, padding } du tag LAME
    let lastFrameEnd = 0;
    const chunks = [];
    let chunk = null;

    function addFrame(offset, header, isAudio) {
        if (isAudio) samples += header.samples;
        if (!chunk) chunk = { offset: chunks.length === 0 ? 0 : offset };
        lastFrameEnd = offset + header.length;
        if (lastFrameEnd - chunk.offset >= chunkBytes) closeChunk();
    }

    function closeChunk() {
        if (!chunk) return;
        const skipped = gap ? gap.delay + DECODER_DELAY : 0;
        chunks.push({ offset: chunk.offset, length: lastFrameEnd - chunk.offset, endTime: Math.max(0, samples - skipped) / reference.sampleRate });
        chunk = null;
    }

    return {
        push(block) {
            const bytes = new Uint8Array(carry.length + block.length);
            bytes.set(carry);
            bytes.set(block, carry.length);
            let i = 0;

            if (!started) {
                if (bytes.length < 10) { carry = bytes; return; }
                started = true;
                if (text(bytes, 0, 3) === 'ID3') {
                    const size = ((bytes[6] & 0x7F) << 21) | ((bytes[7] & 0x7F) << 14) | ((bytes[8] & 0x7F) << 7) | (bytes[9] & 0x7F);
                    skip = 10 + size + ((bytes[5] & 0x10) ? 10 : 0);
                }
            }

            while (i < bytes.length) {
                if (skip > 0) {
                    const step = Math.min(skip, bytes.length - i);
                    i += step;
                    skip -= step;
                    continue;
                }
                if (i + 4 > bytes.length) break;
                const header = parseFrameHeader(bytes, i);
                const consistent = header && (!reference || (header.versionBits === reference.versionBits
                    && header.layer === reference.layer && header.sampleRate === reference.sampleRate));
                if (!consistent) {
                    junk++;
                    i++;
                    continue;
                }
                if (firstFrame && i + header.length > bytes.length) break; // attendre la trame entière (tag Xing/LAME)
                reference ||= header;
                const tagAt = i + 4 + header.sideInfo;
                const isXing = firstFrame && ['Xing', 'Info'].includes(text(bytes, tagAt, 4));
                if (isXing) gap = parseLameGap(bytes.subarray(0, i + header.length), tagAt);
                firstFrame = false;
                addFrame(base + i, header, !isXing);
                skip = header.length;
            }
            carry = bytes.slice(i);
            base += i;
        },
        finish() {
            closeChunk();
            if (!reference || samples === 0 || junk > maxJunk) return null;
            const trimmed = gap ? samples - gap.delay - gap.padding : samples;
            return { duration: Math.max(0, trimmed) / reference.sampleRate, sampleRate: reference.sampleRate, chunks };
        },
    };
}
