import { describe, expect, it } from 'vitest';
import {
    addCut,
    cutsToRanges,
    formatTime,
    mergeNames,
    moveCut,
    parseTime,
    planSegmentUpdate,
    rangesToSegments,
    removeCut,
    splitNames,
    stateFromTrack,
    validateSplit,
} from '../frontend/segmentModel.js';

describe('coupes et plages', () => {
    it('convertit les coupes en plages consécutives', () => {
        expect(cutsToRanges([90, 165.5], 192)).toEqual([
            { start: 0, end: 90 },
            { start: 90, end: 165.5 },
            { start: 165.5, end: 192 },
        ]);
        expect(cutsToRanges([], 10)).toEqual([{ start: 0, end: 10 }]);
    });

    it('ajoute une coupe arrondie au dixième, triée, avec son index', () => {
        expect(addCut([90], 30.04, 192)).toEqual({ cuts: [30, 90], index: 0 });
    });

    it('refuse une coupe à moins de 0,5 s d\'une autre ou d\'une extrémité', () => {
        expect(addCut([90], 90.3, 192)).toBeNull();
        expect(addCut([], 0.4, 192)).toBeNull();
        expect(addCut([], 191.7, 192)).toBeNull();
    });

    it('déplace une coupe en la bornant entre ses voisines (± 0,5 s)', () => {
        expect(moveCut([30, 90], 1, 120.26, 192)).toEqual([30, 120.3]);
        expect(moveCut([30, 90], 1, 10, 192)).toEqual([30, 30.5]);
        expect(moveCut([30, 90], 1, 500, 192)).toEqual([30, 191.5]);
    });

    it('supprime une coupe', () => {
        expect(removeCut([30, 90], 0)).toEqual([90]);
    });

    it('les noms suivent : split insère un segment vide, merge garde le premier nom non vide', () => {
        expect(splitNames(['calm', 'combat'], 0)).toEqual(['calm', '', 'combat']);
        expect(mergeNames(['calm', 'combat', ''], 0)).toEqual(['calm', '']);
        expect(mergeNames(['', 'combat'], 0)).toEqual(['combat']);
    });
});

describe('format du temps', () => {
    it('formate en m:ss.d', () => {
        expect(formatTime(0)).toBe('0:00.0');
        expect(formatTime(90)).toBe('1:30.0');
        expect(formatTime(165.54)).toBe('2:45.5');
        expect(formatTime(59.96)).toBe('1:00.0');
    });

    it('lit m:ss.d, des secondes seules et la virgule', () => {
        expect(parseTime('1:30.0')).toBe(90);
        expect(parseTime(' 2:45,5 ')).toBe(165.5);
        expect(parseTime('75.25')).toBe(75.3);
        expect(parseTime('1:75')).toBeNull();
        expect(parseTime('abc')).toBeNull();
        expect(parseTime('')).toBeNull();
    });
});

describe('validateSplit', () => {
    const ranges = [{ start: 0, end: 90 }, { start: 90, end: 180 }];

    it('accepte une découpe valide', () => {
        expect(validateSplit({ title: 'Forêt', ranges, names: ['calm', ''] })).toBeNull();
    });

    it('exige un titre et au moins un segment nommé', () => {
        expect(validateSplit({ title: '  ', ranges, names: ['calm', ''] })).toEqual({ key: 'split.errorTitle' });
        expect(validateSplit({ title: 'x', ranges, names: [' ', ''] })).toEqual({ key: 'split.errorNoNamed' });
    });

    it('refuse les doublons après trim, sans tenir compte de la casse', () => {
        expect(validateSplit({ title: 'x', ranges, names: ['Combat', ' combat '] }))
            .toEqual({ key: 'split.errorDuplicate', vars: { name: 'combat' } });
    });

    it('refuse un nom déjà pris par une version fichier entier', () => {
        expect(validateSplit({ title: 'x', ranges, names: ['boss', ''], reservedNames: ['Boss'] }))
            .toEqual({ key: 'split.errorDuplicate', vars: { name: 'boss' } });
    });

    it('refuse un segment nommé de moins de 0,5 s', () => {
        expect(validateSplit({ title: 'x', ranges: [{ start: 0, end: 0.4 }, { start: 0.4, end: 9 }], names: ['a', ''] }))
            .toEqual({ key: 'split.errorTooShort' });
    });
});

describe('segments ↔ piste', () => {
    it('ne garde que les plages nommées, noms trimés', () => {
        expect(rangesToSegments([{ start: 0, end: 5 }, { start: 5, end: 9 }], [' intro ', ''])).toEqual({
            intro: { start: 0, end: 5 },
        });
    });

    it('reconstruit coupes et noms, trous compris, bornés à la durée', () => {
        const track = {
            segments: {
                calm: { start: 10, end: 90 },
                combat: { start: 90, end: 250 }, // dépasse la durée décodée (200 s)
            },
        };

        expect(stateFromTrack(track, 200)).toEqual({ cuts: [10, 90], names: ['', 'calm', 'combat'] });
    });

    it('la version de lancement suit un segment renommé', () => {
        const track = { defaultVersion: 'combat', segments: { calm: { start: 0, end: 90 }, combat: { start: 90, end: 180 } } };

        expect(planSegmentUpdate(track, { calm: { start: 0, end: 90 }, assaut: { start: 90, end: 180 } }))
            .toEqual({ segments: { calm: { start: 0, end: 90 }, assaut: { start: 90, end: 180 } }, defaultVersion: 'assaut' });
    });

    it('garde une version de lancement fichier entier', () => {
        const track = { defaultVersion: 'boss', segments: { calm: { start: 0, end: 90 } } };
        expect(planSegmentUpdate(track, { calme: { start: 0, end: 90 } }).defaultVersion).toBe('boss');
    });
});
