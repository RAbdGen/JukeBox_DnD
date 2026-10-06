import { describe, expect, it } from 'vitest';
import {
    addCut,
    cutsToRanges,
    fileLabels,
    formatTime,
    mergeNames,
    moveCut,
    parseTime,
    planLaunchVersion,
    rangesToSegments,
    removeCut,
    sourceRequests,
    splitNames,
    stateFromSegments,
    validateSources,
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

        expect(stateFromSegments(track.segments, 200)).toEqual({ cuts: [10, 90], names: ['', 'calm', 'combat'] });
    });

});

describe('validateSources (#45)', () => {
    const ranges = [{ start: 0, end: 5 }, { start: 5, end: 9 }];
    const source = (fileName, names) => ({ fileName, ranges, names });

    it('accepte deux fichiers aux noms distincts', () => {
        expect(validateSources({ title: 'x', sources: [source('a.mp3', ['calm', '']), source('b.mp3', ['combat', 'fin'])] })).toBeNull();
    });

    it('titre vide, aucun fichier ni version entière', () => {
        expect(validateSources({ title: ' ', sources: [source('a.mp3', ['calm'])] })).toEqual({ key: 'split.errorTitle' });
        expect(validateSources({ title: 'x', sources: [] })).toEqual({ key: 'split.errorNoNamed' });
        expect(validateSources({ title: 'x', sources: [], reservedNames: ['boss'] })).toBeNull();
    });

    it('fichier sans segment nommé : erreur qui le nomme', () => {
        expect(validateSources({ title: 'x', sources: [source('a.mp3', ['calm']), source('b.mp3', ['', ' '])] }))
            .toEqual({ key: 'split.errorNoNamedIn', vars: { file: 'b.mp3' }, sourceIndex: 1 });
    });

    it('doublon entre fichiers : nomme le fichier qui l\'utilise déjà', () => {
        expect(validateSources({ title: 'x', sources: [source('a.mp3', ['Combat']), source('b.mp3', [' combat '])] }))
            .toEqual({ key: 'split.errorDuplicateIn', vars: { name: 'combat', file: 'a.mp3' }, sourceIndex: 1 });
        expect(validateSources({ title: 'x', sources: [source('a.mp3', ['boss'])], reservedNames: ['Boss'] }))
            .toEqual({ key: 'split.errorDuplicate', vars: { name: 'boss' }, sourceIndex: 0 });
    });

    it('fichier illisible : ses noms comptent pour les doublons, pas de contrôle de durée', () => {
        expect(validateSources({ title: 'x', sources: [{ fileName: 'a.mp3', ranges: null, names: ['calm'] }, source('b.mp3', ['calm'])] }))
            .toEqual({ key: 'split.errorDuplicateIn', vars: { name: 'calm', file: 'a.mp3' }, sourceIndex: 1 });
    });

    it('doublon dans un même fichier, après trim et sans casse', () => {
        expect(validateSources({ title: 'x', sources: [source('a.mp3', ['Combat', ' combat '])] }))
            .toEqual({ key: 'split.errorDuplicateIn', vars: { name: 'combat', file: 'a.mp3' }, sourceIndex: 0 });
    });

    it('segment trop court', () => {
        expect(validateSources({ title: 'x', sources: [{ fileName: 'a', ranges: [{ start: 0, end: 0.4 }, { start: 0.4, end: 9 }], names: ['a', ''] }] }))
            .toEqual({ key: 'split.errorTooShort', sourceIndex: 0 });
    });
});

describe('sourceRequests (#45)', () => {
    it('fichier existant, nouveau fichier, fichier illisible (versions gardées telles quelles)', () => {
        const kept = { calm: { start: 0, end: 5 } };
        expect(sourceRequests([
            { localPath: '/a', duration: 9, cuts: [5], names: ['intro', ''] },
            { sourcePath: '/home/b.mp3', duration: 4, cuts: [], names: ['combat'] },
            { localPath: '/c', loadError: true, keptSegments: kept },
        ])).toEqual([
            { localPath: '/a', segments: { intro: { start: 0, end: 5 } } },
            { sourcePath: '/home/b.mp3', segments: { combat: { start: 0, end: 4 } } },
            { localPath: '/c', segments: kept },
        ]);
    });
});

describe('planLaunchVersion (#45)', () => {
    const track = {
        launchVersion: 'combat',
        localPaths: { calm: '/a', combat: '/b', boss: '/full' },
        segments: { calm: { start: 0, end: 5 }, combat: { start: 0, end: 4 } },
    };

    it('suit son segment renommé dans le même fichier', () => {
        expect(planLaunchVersion(track, [{ localPath: '/b', segments: { assaut: { start: 0, end: 4 } } }])).toBe('assaut');
    });

    it('fichier retiré : undefined ; version entière : inchangée ; aucune : undefined', () => {
        expect(planLaunchVersion(track, [{ localPath: '/a', segments: { calm: { start: 0, end: 5 } } }])).toBeUndefined();
        expect(planLaunchVersion({ ...track, launchVersion: 'boss' }, [])).toBe('boss');
        expect(planLaunchVersion({ ...track, launchVersion: undefined }, [])).toBeUndefined();
    });
});

describe('fileLabels (#45)', () => {
    it('nom du fichier, précédé de son dossier quand deux fichiers portent le même nom', () => {
        expect(fileLabels(['/home/a/theme.wav', 'C:\\Musique\\b\\theme.wav', '/x/boss.mp3']))
            .toEqual(['a/theme.wav', 'b/theme.wav', 'boss.mp3']);
        expect(fileLabels(['/x/Boss.mp3'])).toEqual(['Boss.mp3']);
    });
});
