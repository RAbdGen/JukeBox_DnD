import { describe, expect, it, vi } from 'vitest';
import {
    applySourcesUpdate,
    buildSegmentedTrack,
    isPathSharedByOtherVersion,
    orderedSegmentNames,
    persistSources,
    sanitizeSegments,
    sourceGroups,
    trackSignature,
    uniquePaths,
    unusedPaths,
} from '../backend/segments.js';

describe('trackSignature', () => {
    it('ignore l\'ordre des versions', () => {
        expect(trackSignature({ a: '/x', b: '/y' })).toBe(trackSignature({ b: '/y', a: '/x' }));
    });

    it('change si un chemin ou un segment change', () => {
        const base = trackSignature({ a: '/x' }, { a: { start: 0, end: 10 } });
        expect(trackSignature({ a: '/z' }, { a: { start: 0, end: 10 } })).not.toBe(base);
        expect(trackSignature({ a: '/x' }, { a: { start: 0, end: 12 } })).not.toBe(base);
        expect(trackSignature({ a: '/x' })).not.toBe(base);
    });
});

describe('sanitizeSegments', () => {
    it('garde les segments valides des versions existantes', () => {
        expect(sanitizeSegments(
            { calm: { start: 0, end: 90 }, combat: { start: '90', end: 180 } },
            { calm: '/s', combat: '/s' },
        )).toEqual({ calm: { start: 0, end: 90 }, combat: { start: 90, end: 180 } });
    });

    it('retire les segments invalides ou orphelins, undefined si plus rien', () => {
        const localPaths = { a: '/s', b: '/s', c: '/s' };
        expect(sanitizeSegments({ a: { start: 5, end: 5 }, b: { start: -1, end: 3 }, c: null, z: { start: 0, end: 1 } }, localPaths))
            .toBeUndefined();
        expect(sanitizeSegments('nope', localPaths)).toBeUndefined();
        expect(sanitizeSegments(undefined, localPaths)).toBeUndefined();
    });
});

describe('fichier partagé', () => {
    const track = { localPaths: { calm: '/s.mp3', combat: '/s.mp3', boss: '/b.mp3' } };

    it('détecte un chemin encore utilisé par une autre version', () => {
        expect(isPathSharedByOtherVersion(track, 'calm')).toBe(true);
        expect(isPathSharedByOtherVersion(track, 'boss')).toBe(false);
        expect(isPathSharedByOtherVersion(track, 'absent')).toBe(false);
    });

    it('dédoublonne les chemins', () => {
        expect(uniquePaths(track.localPaths)).toEqual(['/s.mp3', '/b.mp3']);
        expect(uniquePaths(undefined)).toEqual([]);
    });
});

describe('sourceGroups (#45)', () => {
    it('regroupe les versions découpées par fichier, dans l\'ordre, noms triés par début', () => {
        const track = {
            localPaths: { tension: '/a', calm: '/a', boss: '/full', victoire: '/b', combat: '/b' },
            originalPaths: { tension: '/oa', calm: '/oa', boss: '/ofull', victoire: '/ob', combat: '/ob' },
            segments: { calm: { start: 0, end: 5 }, tension: { start: 5, end: 9 }, combat: { start: 0, end: 4 }, victoire: { start: 4, end: 8 } },
        };
        expect(sourceGroups(track)).toEqual([
            { localPath: '/a', originalPath: '/oa', names: ['calm', 'tension'] },
            { localPath: '/b', originalPath: '/ob', names: ['combat', 'victoire'] },
        ]);
    });

    it('piste sans découpe : aucune source', () => {
        expect(sourceGroups({ localPaths: { a: '/a' } })).toEqual([]);
        expect(sourceGroups(undefined)).toEqual([]);
    });
});

describe('buildSegmentedTrack (#45 : plusieurs sources)', () => {
    it('versions dans l\'ordre des sources puis des segments, chacune sur son fichier', () => {
        const track = buildSegmentedTrack({
            trackId: 't1', title: 'Donjon',
            sources: [
                { sourcePath: '/home/exploration.mp3', localPath: '/m/t1_source.mp3', segments: { tension: { start: 90, end: 180 }, calm: { start: 0, end: 90 } } },
                { sourcePath: '/home/boss.ogg', localPath: '/m/t1_source.ogg', segments: { combat: { start: 0, end: 60 } } },
            ],
            selectedPlaylists: ['p1'],
            now: new Date('2026-10-06T10:00:00Z'),
        });
        expect(Object.keys(track.localPaths)).toEqual(['calm', 'tension', 'combat']);
        expect(track.localPaths.combat).toBe('/m/t1_source.ogg');
        expect(track.originalPaths.calm).toBe('/home/exploration.mp3');
        expect(track.segments.combat).toEqual({ start: 0, end: 60 });
        expect(track.inPlaylists).toEqual(['p1']);
    });

    it('refuse un nom en double entre deux sources, et une découpe vide', () => {
        const seg = { combat: { start: 0, end: 5 } };
        expect(() => buildSegmentedTrack({ trackId: 't', title: 'x', sources: [
            { sourcePath: '/a', localPath: '/la', segments: seg },
            { sourcePath: '/b', localPath: '/lb', segments: { Combat: { start: 0, end: 5 } } },
        ] })).toThrow(/Combat/);
        expect(() => buildSegmentedTrack({ trackId: 't', title: 'x', sources: [] })).toThrow();
    });
});

describe('applySourcesUpdate (#45)', () => {
    const track = () => ({
        id: 't1',
        originalPaths: { calm: '/oa', tension: '/oa', boss: '/ofull' },
        localPaths: { calm: '/a', tension: '/a', boss: '/full' },
        segments: { calm: { start: 0, end: 5 }, tension: { start: 5, end: 9 } },
    });

    it('ajoute une source, garde les versions entières après', () => {
        const next = applySourcesUpdate(track(), [
            { localPath: '/a', originalPath: '/oa', segments: { calm: { start: 0, end: 5 }, tension: { start: 5, end: 9 } } },
            { localPath: '/b', originalPath: '/ob', segments: { combat: { start: 0, end: 4 } } },
        ]);
        expect(Object.keys(next.localPaths)).toEqual(['calm', 'tension', 'combat', 'boss']);
        expect(next.originalPaths).toEqual({ calm: '/oa', tension: '/oa', combat: '/ob', boss: '/ofull' });
        expect(next.segments.combat).toEqual({ start: 0, end: 4 });
    });

    it('retirer toutes les sources : il reste les versions entières, plus de segments', () => {
        const next = applySourcesUpdate(track(), []);
        expect(next.localPaths).toEqual({ boss: '/full' });
        expect(next).not.toHaveProperty('segments');
    });

    it('refuse un nom pris par une version entière ou par une autre source, et une piste sans version', () => {
        expect(() => applySourcesUpdate(track(), [{ localPath: '/a', segments: { Boss: { start: 0, end: 5 } } }])).toThrow(/boss/i);
        expect(() => applySourcesUpdate(track(), [
            { localPath: '/a', segments: { x: { start: 0, end: 5 } } },
            { localPath: '/b', segments: { X: { start: 0, end: 5 } } },
        ])).toThrow(/X/);
        expect(() => applySourcesUpdate({ localPaths: { a: '/a' }, segments: { a: { start: 0, end: 1 } } }, [])).toThrow();
    });
});

describe('unusedPaths (#45)', () => {
    it('chemins qui ne servent plus à aucune version', () => {
        expect(unusedPaths({ a: '/a', b: '/a', c: '/c' }, { a: '/a', d: '/d' })).toEqual(['/c']);
    });
});

describe('persistSources (#45)', () => {
    const deps = () => ({
        reservedPaths: ['/m/t1_source.mp3'],
        copyFile: vi.fn(async (sourcePath, reserved) => `/m/copy${reserved.length}`),
        deleteFile: vi.fn(async () => true),
    });

    it('copie les nouveaux fichiers, enregistre, puis supprime les fichiers inutilisés', async () => {
        const d = deps();
        const persist = vi.fn(async () => ({ result: 'saved', unusedPaths: ['/m/old'] }));
        const result = await persistSources({ ...d, persist, requests: [
            { localPath: '/m/t1_source.mp3', segments: { calm: { start: 0, end: 5 } } },
            { sourcePath: '/home/boss.mp3', segments: { combat: { start: 0, end: 5 } } },
        ] });
        expect(result).toBe('saved');
        expect(d.copyFile).toHaveBeenCalledWith('/home/boss.mp3', ['/m/t1_source.mp3']);
        expect(persist).toHaveBeenCalledWith([
            { localPath: '/m/t1_source.mp3', segments: { calm: { start: 0, end: 5 } } },
            { localPath: '/m/copy1', originalPath: '/home/boss.mp3', segments: { combat: { start: 0, end: 5 } } },
        ], ['/m/copy1']);
        expect(d.deleteFile.mock.calls).toEqual([['/m/old']]);
    });

    it('enregistrement refusé : les fichiers copiés sont supprimés, l\'erreur remonte', async () => {
        const d = deps();
        const persist = vi.fn(async () => { throw new Error('Segments invalides'); });
        await expect(persistSources({ ...d, persist, requests: [{ sourcePath: '/home/a.mp3', segments: {} }] }))
            .rejects.toThrow('Segments invalides');
        expect(d.deleteFile.mock.calls).toEqual([['/m/copy1']]);
    });

    it('deux nouveaux fichiers : le second ne peut pas écraser le premier', async () => {
        const d = deps();
        await persistSources({ ...d, persist: async () => ({ result: null }), requests: [
            { sourcePath: '/x/a.mp3', segments: {} }, { sourcePath: '/y/a.mp3', segments: {} },
        ] });
        expect(d.copyFile.mock.calls[1][1]).toEqual(['/m/t1_source.mp3', '/m/copy1']);
    });
});

describe('orderedSegmentNames', () => {
    it('trie par début de segment', () => {
        expect(orderedSegmentNames({ b: { start: 5, end: 9 }, a: { start: 0, end: 5 } })).toEqual(['a', 'b']);
        expect(orderedSegmentNames()).toEqual([]);
    });
});
