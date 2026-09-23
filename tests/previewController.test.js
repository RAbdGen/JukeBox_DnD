import { describe, expect, it, vi } from 'vitest';
import { createPreviewController } from '../frontend/previewController.js';

function createButton() {
    return { textContent: '▶', title: 'Préécouter', ariaLabel: 'Préécouter' };
}

function createHowlFactory() {
    const howls = [];
    const createHowl = vi.fn(options => {
        const howl = {
            load: vi.fn(),
            once: vi.fn(),
            play: vi.fn(),
            state: vi.fn(() => 'loaded'),
            unload: vi.fn(),
            options,
        };
        howls.push(howl);
        return howl;
    });

    return { createHowl, howls };
}

describe('createPreviewController', () => {
    it('toggles the clicked preview button and unloads its active howl', () => {
        const { createHowl, howls } = createHowlFactory();
        const preview = createPreviewController({
            createHowl,
            getSource: () => 'file:///music/forest.mp3',
            getVolume: () => 0.5,
        });
        const button = createButton();
        const track = { id: 'forest' };

        preview.toggle(track, button);

        expect(howls[0].play).toHaveBeenCalledOnce();
        expect(button).toMatchObject({
            textContent: '⏸',
            title: 'Arrêter le preview',
            ariaLabel: 'Arrêter le preview',
        });

        preview.toggle(track, button);

        expect(howls[0].unload).toHaveBeenCalledOnce();
        expect(button).toMatchObject({
            textContent: '▶',
            title: 'Préécouter',
            ariaLabel: 'Préécouter',
        });
    });

    it('resets the preview button when the preview reaches its end', () => {
        const { createHowl, howls } = createHowlFactory();
        const preview = createPreviewController({
            createHowl,
            getSource: () => 'file:///music/forest.mp3',
            getVolume: () => 0.5,
        });
        const button = createButton();

        preview.toggle({ id: 'forest' }, button);
        howls[0].options.onend();

        expect(howls[0].unload).toHaveBeenCalledOnce();
        expect(button.textContent).toBe('▶');
    });
});
