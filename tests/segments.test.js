import { describe, expect, it } from 'vitest';
import {
    applySegmentUpdate,
    buildSegmentedTrack,
    isPathSharedByOtherVersion,
    orderedSegmentNames,
    sanitizeSegments,
    trackSignature,
    uniquePaths,
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

describe('buildSegmentedTrack', () => {
    it('construit une piste dont toutes les versions pointent sur le fichier copié', () => {
        const track = buildSegmentedTrack({
            trackId: 't1',
            title: 'Forêt',
            sourcePath: '/home/me/foret.mp3',
            localPath: '/data/music/t1_source.mp3',
            segments: { combat: { start: 90, end: 180 }, calm: { start: 0, end: 90 } },
            selectedPlaylists: ['p1'],
            now: new Date('2026-09-28T10:00:00Z'),
        });

        expect(Object.keys(track.localPaths)).toEqual(['calm', 'combat']); // ordre de la timeline
        expect(track.localPaths).toEqual({ calm: '/data/music/t1_source.mp3', combat: '/data/music/t1_source.mp3' });
        expect(track.originalPaths.calm).toBe('/home/me/foret.mp3');
        expect(track.segments).toEqual({ calm: { start: 0, end: 90 }, combat: { start: 90, end: 180 } });
        expect(track.defaultVersion).toBe('calm');
        expect(track.inPlaylists).toEqual(['p1']);
        expect(track.metadata.addedAt).toBe('2026-09-28T10:00:00.000Z');
    });

    it('refuse une découpe sans segment nommé', () => {
        expect(() => buildSegmentedTrack({ trackId: 't', title: 'x', sourcePath: '/a', localPath: '/b', segments: {} }))
            .toThrow();
    });
});

describe('applySegmentUpdate', () => {
    function splitTrack() {
        return {
            id: 't1',
            defaultVersion: 'combat',
            originalPaths: { calm: '/o.mp3', combat: '/o.mp3', boss: '/ob.mp3' },
            localPaths: { calm: '/s.mp3', combat: '/s.mp3', boss: '/b.mp3' },
            segments: { calm: { start: 0, end: 90 }, combat: { start: 90, end: 180 } },
        };
    }

    it('remplace les versions découpées et garde les versions fichier entier après', () => {
        const track = applySegmentUpdate(splitTrack(), {
            tension: { start: 60, end: 120 },
            calme: { start: 0, end: 60 },
        }, 'tension');

        expect(Object.keys(track.localPaths)).toEqual(['calme', 'tension', 'boss']);
        expect(track.localPaths.tension).toBe('/s.mp3');
        expect(track.originalPaths.tension).toBe('/o.mp3');
        expect(track.localPaths.boss).toBe('/b.mp3');
        expect(track.originalPaths.boss).toBe('/ob.mp3');
        expect(track.segments).toEqual({ calme: { start: 0, end: 60 }, tension: { start: 60, end: 120 } });
        expect(track.defaultVersion).toBe('tension');
    });

    it('version de lancement disparue → première version', () => {
        const track = applySegmentUpdate(splitTrack(), { calm: { start: 0, end: 90 } }, 'combat');
        expect(track.defaultVersion).toBe('calm');
    });

    it('garde une version de lancement fichier entier', () => {
        const base = splitTrack();
        base.defaultVersion = 'boss';
        expect(applySegmentUpdate(base, { calm: { start: 0, end: 90 } }).defaultVersion).toBe('boss');
    });

    it('refuse un segment qui prendrait le nom d\'une version fichier entier', () => {
        expect(() => applySegmentUpdate(splitTrack(), { boss: { start: 0, end: 90 } })).toThrow(/boss/);
    });

    it('refuse une piste qui n\'est pas découpée', () => {
        expect(() => applySegmentUpdate({ id: 'x', localPaths: { a: '/a' } }, { a: { start: 0, end: 1 } })).toThrow();
    });
});

describe('orderedSegmentNames', () => {
    it('trie par début de segment', () => {
        expect(orderedSegmentNames({ b: { start: 5, end: 9 }, a: { start: 0, end: 5 } })).toEqual(['a', 'b']);
        expect(orderedSegmentNames()).toEqual([]);
    });
});
