import { describe, expect, it, vi } from 'vitest';
import { createPreviewState } from '../frontend/previewState.js';

describe('createPreviewState', () => {
    it('cancels a pending timer and active preview before a re-render', () => {
        const clearTimer = vi.fn();
        const stopHowl = vi.fn();
        const preview = createPreviewState({ clearTimer, stopHowl });
        preview.setTimer(42);

        preview.cancel();

        expect(clearTimer).toHaveBeenCalledWith(42);
        expect(stopHowl).toHaveBeenCalledOnce();
        expect(preview.getTimer()).toBeNull();
    });
});
