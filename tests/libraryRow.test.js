import { describe, expect, it } from 'vitest';
import { t } from '../backend/i18n.js';
import { readStyles } from './helpers/readStyles.js';

const css = readStyles();
const body = selector => {
    const m = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
    return m ? m[1] : '';
};

describe('Ligne de la bibliothèque (#57, #59)', () => {
    it('le bouton ✎ dit qu\'il modifie la piste, pas seulement son volume', () => {
        expect(t('fr', 'library.editTrack')).toBe('Modifier la piste');
        expect(t('en', 'library.editTrack')).toBe('Edit track');
    });

    it('les boutons d\'action restent sur une seule ligne, le titre cède la place', () => {
        const actions = body('.track-actions');
        expect(actions).toMatch(/display:\s*flex/);
        expect(actions).toMatch(/flex-wrap:\s*nowrap/);
        expect(actions).toMatch(/flex-shrink:\s*0/);
        expect(body('.track-info-main')).toMatch(/min-width:\s*0/);
    });
});
