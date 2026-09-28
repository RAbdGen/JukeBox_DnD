/**
 * Waveform de l'onglet Découpage (#24). Décodage mono à 8 kHz uniquement pour
 * le dessin : un fichier d'ambiance d'une heure tient en ~100 Mo au lieu de
 * >1 Go en pleine qualité (machine cible : 8 Go). Pics précalculés
 * (100 / s), seule la fenêtre visible est redessinée.
 */

export const PEAKS_PER_SECOND = 100;
export const WAVEFORM_SAMPLE_RATE = 8000;
export const MIN_VISIBLE_SECONDS = 4;

export function computePeaks(samples, bucketCount) {
    const min = new Float32Array(bucketCount);
    const max = new Float32Array(bucketCount);
    const size = samples.length / bucketCount;

    for (let bucket = 0; bucket < bucketCount; bucket++) {
        const from = Math.floor(bucket * size);
        const to = Math.min(samples.length, Math.max(from + 1, Math.floor((bucket + 1) * size)));
        let low = 0;
        let high = 0;
        for (let i = from; i < to; i++) {
            const value = samples[i];
            if (value < low) low = value;
            if (value > high) high = value;
        }
        min[bucket] = low;
        max[bucket] = high;
    }
    return { min, max };
}

export function mixToMono(channels) {
    if (channels.length === 1) return channels[0];
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) {
        for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    }
    return mono;
}

export async function decodeForWaveform(arrayBuffer, {
    createContext = sampleRate => new OfflineAudioContext(1, 1, sampleRate),
} = {}) {
    const context = createContext(WAVEFORM_SAMPLE_RATE);
    const buffer = await context.decodeAudioData(arrayBuffer);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const bucketCount = Math.max(1, Math.ceil(buffer.duration * PEAKS_PER_SECOND));
    return { duration: buffer.duration, peaks: computePeaks(mixToMono(channels), bucketCount) };
}

export function timeToX(time, view, width) {
    return ((time - view.start) / (view.end - view.start)) * width;
}

export function xToTime(x, view, width) {
    return view.start + (x / width) * (view.end - view.start);
}

export function fullView(duration) {
    return { start: 0, end: duration };
}

function clampView(start, span, duration) {
    const clampedStart = Math.min(Math.max(0, start), Math.max(0, duration - span));
    return { start: clampedStart, end: clampedStart + span };
}

export function zoomView(view, factor, anchorTime, duration, minSpan = MIN_VISIBLE_SECONDS) {
    const span = view.end - view.start;
    const newSpan = Math.min(duration, Math.max(Math.min(minSpan, duration), span / factor));
    const ratio = span > 0 ? (anchorTime - view.start) / span : 0.5;
    return clampView(anchorTime - ratio * newSpan, newSpan, duration);
}

export function scrollView(view, deltaSeconds, duration) {
    return clampView(view.start + deltaSeconds, view.end - view.start, duration);
}

/**
 * Dessine la fenêtre visible : waveform, points de coupe (◆ en haut) et tête
 * de lecture. `colors` vient des variables CSS du thème actif.
 */
export function drawWaveform(ctx, { peaks, view, width, height, cuts, playhead, selectedCut, colors }) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);

    const middle = height / 2;
    ctx.fillStyle = colors.wave;
    for (let x = 0; x < width; x++) {
        const from = Math.max(0, Math.floor(xToTime(x, view, width) * PEAKS_PER_SECOND));
        const to = Math.min(peaks.max.length, Math.max(from + 1, Math.ceil(xToTime(x + 1, view, width) * PEAKS_PER_SECOND)));
        let low = 0;
        let high = 0;
        for (let i = from; i < to; i++) {
            if (peaks.min[i] < low) low = peaks.min[i];
            if (peaks.max[i] > high) high = peaks.max[i];
        }
        const top = middle - high * middle * 0.9;
        const bottom = middle - low * middle * 0.9;
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }

    cuts.forEach((cut, i) => {
        const x = Math.round(timeToX(cut, view, width)) + 0.5;
        if (x < -6 || x > width + 6) return;
        ctx.strokeStyle = ctx.fillStyle = i === selectedCut ? colors.cutSelected : colors.cut;
        ctx.lineWidth = i === selectedCut ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.beginPath(); // ◆ poignée
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 6, 6);
        ctx.lineTo(x, 12);
        ctx.lineTo(x - 6, 6);
        ctx.closePath();
        ctx.fill();
    });

    const playheadX = Math.round(timeToX(playhead, view, width)) + 0.5;
    if (playheadX >= 0 && playheadX <= width) {
        ctx.strokeStyle = colors.playhead;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();
    }
}
