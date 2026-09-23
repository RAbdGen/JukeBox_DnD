import { describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, _dictionaries, getAppName, normalizeLanguage, t } from '../backend/i18n.js';

describe('i18n', () => {
    it('translates a known key in both supported languages', () => {
        expect(t('fr', 'nav.settings')).toBe('Réglages');
        expect(t('en', 'nav.settings')).toBe('Settings');
    });

    it('falls back to French for an unsupported language', () => {
        expect(t('de', 'nav.settings')).toBe(t('fr', 'nav.settings'));
    });

    it('falls back to the raw key when missing from every dictionary', () => {
        expect(t('en', 'totally.unknown.key')).toBe('totally.unknown.key');
    });

    it('interpolates {placeholder} variables', () => {
        expect(t('fr', 'player.trackCounter', { current: 2, total: 5 })).toBe('Piste 2/5');
        expect(t('en', 'player.trackCounter', { current: 2, total: 5 })).toBe('Track 2/5');
    });

    it('interpolates the same variable used more than once', () => {
        const result = t('en', 'toast.trackDeleted', { title: 'Forest Ambiance' });
        expect(result).toBe('Track "Forest Ambiance" deleted.');
    });

    it('normalizes an unsupported language to the default', () => {
        expect(normalizeLanguage('de')).toBe(DEFAULT_LANGUAGE);
        expect(normalizeLanguage('en')).toBe('en');
    });

    it('exposes the app name translation per language', () => {
        expect(getAppName('fr')).toBe('Jukebox JDR');
        expect(getAppName('en')).toBe('Jukebox RPG');
    });

    it('has an identical key set in every supported dictionary', () => {
        // Régression : une clé absente d'une langue retombe silencieusement
        // sur le français (ou la clé brute) au lieu de planter — ce test
        // attrape tout de suite un dictionnaire qui diverge, sans attendre
        // de tomber dessus manuellement dans l'UI.
        expect(SUPPORTED_LANGUAGES).toEqual(['fr', 'en']);
        const frKeys = Object.keys(_dictionaries.fr).sort();
        const enKeys = Object.keys(_dictionaries.en).sort();
        expect(enKeys).toEqual(frKeys);
    });
});
