import { describe, expect, it, vi } from 'vitest';
import { createPreviewController } from '../frontend/previewController.js';

function createButton() {
    return { textContent: '▶', dataset: { tooltip: 'Préécouter' }, ariaLabel: 'Préécouter' };
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
            dataset: { tooltip: 'Arrêter le preview' },
            ariaLabel: 'Arrêter le preview',
        });

        preview.toggle(track, button);

        expect(howls[0].unload).toHaveBeenCalledOnce();
        expect(button).toMatchObject({
            textContent: '▶',
            dataset: { tooltip: 'Préécouter' },
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

    it('uses an injected translator for the button labels (#22)', () => {
        const { createHowl } = createHowlFactory();
        const t = vi.fn(key => (key === 'preview.stop' ? 'Stop preview' : 'Preview'));
        const preview = createPreviewController({
            createHowl,
            getSource: () => 'file:///music/forest.mp3',
            getVolume: () => 0.5,
            t,
        });
        const button = createButton();

        preview.toggle({ id: 'forest' }, button);

        expect(t).toHaveBeenCalledWith('preview.stop');
        expect(button.dataset.tooltip).toBe('Stop preview');
    });

    it('passes the label through an injected setTooltip (#38)', () => {
        const { createHowl } = createHowlFactory();
        const setTooltip = vi.fn();
        const preview = createPreviewController({ createHowl, getSource: () => 'file:///forest.mp3', getVolume: () => 1, setTooltip });
        const button = createButton();

        preview.toggle({ id: 'forest' }, button);

        expect(setTooltip).toHaveBeenCalledWith(button, 'Arrêter le preview');
    });
});
