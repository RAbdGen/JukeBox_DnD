import { describe, expect, it } from 'vitest';
import { getPreviewVolume } from '../frontend/trackVolume.js';

describe('getPreviewVolume', () => {
    it('keeps a normalised volume of zero for an audio preview', () => {
        expect(getPreviewVolume({ defaultVolume: 0 })).toBe(0);
    });

    it('uses the default normalised volume when the track predates the field', () => {
        expect(getPreviewVolume({})).toBe(0.5);
    });
});
