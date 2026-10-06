import { describe, expect, it, vi } from 'vitest';
import { DatabaseManager } from '../backend/DatabaseManager.js';

function createDatabaseManager(data) {
    const manager = new DatabaseManager();
    manager.db = { data, write: vi.fn().mockResolvedValue() };
    return manager;
}

describe('DatabaseManager.mergeImportedLibrary', () => {
    it('importe une durée en secondes normalisée, sans ancien % (#28)', async () => {
        const manager = createDatabaseManager({ library: [], playlists: [], metadata: {} });

        await manager.mergeImportedLibrary({
            library: [{ id: 't1', title: 'Importée', crossfadeDurationSeconds: 3, crossfadeDurationPercent: 0.2 }],
            playlists: [],
        });

        expect(manager.db.data.library[0].crossfadeDurationSeconds).toBe(3);
        expect(manager.db.data.library[0]).not.toHaveProperty('crossfadeDurationPercent');
    });

    it('donne 5 s par défaut à une piste importée sans réglage de fondu (#28)', async () => {
        const manager = createDatabaseManager({ library: [], playlists: [], metadata: {} });

        await manager.mergeImportedLibrary({ library: [{ id: 't1', title: 'Importée' }], playlists: [] });

        expect(manager.db.data.library[0].crossfadeDurationSeconds).toBe(5);
    });

    it('normalises an invalid imported crossfade duration to the default', async () => {
        const manager = createDatabaseManager({
            library: [],
            playlists: [],
            metadata: {},
        });

        await manager.mergeImportedLibrary({
            library: [{ id: 't1', title: 'Importée', crossfadeDurationPercent: 'invalid' }],
            playlists: [],
        });

        expect(manager.db.data.library[0].crossfadeDurationPercent).toBe(0.1);
    });

    it('merges a malformed existing playlist as an empty track list', async () => {
        const manager = createDatabaseManager({
            library: [],
            playlists: [{ id: 'p1', name: 'Locale', trackIds: ['track-a'] }],
            metadata: {},
        });

        await manager.mergeImportedLibrary({
            library: [],
            playlists: [{ id: 'p1', name: 'Importée' }],
        });

        expect(manager.db.data.playlists[0].trackIds).toEqual(['track-a']);
        expect(manager.db.write).toHaveBeenCalledOnce();
    });

    it('stores a new malformed playlist with an empty track list', async () => {
        const manager = createDatabaseManager({
            library: [],
            playlists: [],
            metadata: {},
        });

        await manager.mergeImportedLibrary({
            library: [],
            playlists: [{ id: 'p2', name: 'Importée' }],
        });

        expect(manager.db.data.playlists).toEqual([{ id: 'p2', name: 'Importée', trackIds: [] }]);
    });
});

describe('DatabaseManager.updateTrack', () => {
    it('enregistre une durée de fondu en secondes et retire l\'ancien % (#28)', async () => {
        const manager = createDatabaseManager({
            library: [{ id: 't1', title: 'Piste', crossfadeDurationPercent: 0.2 }],
            playlists: [],
            metadata: {},
        });

        await manager.updateTrack('t1', { crossfadeDurationSeconds: 2.5 });

        expect(manager.db.data.library[0].crossfadeDurationSeconds).toBe(2.5);
        expect(manager.db.data.library[0]).not.toHaveProperty('crossfadeDurationPercent');
    });

    it('ramène une durée en secondes hors plage à la valeur par défaut (#28)', async () => {
        const manager = createDatabaseManager({
            library: [{ id: 't1', title: 'Piste' }],
            playlists: [],
            metadata: {},
        });

        await manager.updateTrack('t1', { crossfadeDurationSeconds: 60 });

        expect(manager.db.data.library[0].crossfadeDurationSeconds).toBe(5);
    });

    it('normalises an invalid crossfade duration before persisting a track update', async () => {
        const manager = createDatabaseManager({
            library: [{ id: 't1', title: 'Piste', crossfadeDurationPercent: 0.2 }],
            playlists: [],
            metadata: {},
        });

        await manager.updateTrack('t1', { crossfadeDurationPercent: 1 });

        expect(manager.db.data.library[0].crossfadeDurationPercent).toBe(0.1);
        expect(manager.db.write).toHaveBeenCalledOnce();
    });
});

describe('DatabaseManager.reorderPlaylistTracks', () => {
    it('applies a valid permutation of the existing trackIds', async () => {
        const manager = createDatabaseManager({
            library: [],
            playlists: [{ id: 'p1', name: 'Défaut', trackIds: ['a', 'b', 'c'] }],
            metadata: {},
        });

        const result = await manager.reorderPlaylistTracks('p1', ['c', 'a', 'b']);

        expect(result).toBe(true);
        expect(manager.db.data.playlists[0].trackIds).toEqual(['c', 'a', 'b']);
        expect(manager.db.write).toHaveBeenCalledOnce();
    });

    it('rejects an order that is not a permutation of the current trackIds and leaves them untouched', async () => {
        const manager = createDatabaseManager({
            library: [],
            playlists: [{ id: 'p1', name: 'Défaut', trackIds: ['a', 'b', 'c'] }],
            metadata: {},
        });

        const result = await manager.reorderPlaylistTracks('p1', ['a', 'b', 'z']);

        expect(result).toBe(false);
        expect(manager.db.data.playlists[0].trackIds).toEqual(['a', 'b', 'c']);
        expect(manager.db.write).not.toHaveBeenCalled();
    });

    it('returns false for an unknown playlist', async () => {
        const manager = createDatabaseManager({ library: [], playlists: [], metadata: {} });

        const result = await manager.reorderPlaylistTracks('missing', []);

        expect(result).toBe(false);
        expect(manager.db.write).not.toHaveBeenCalled();
    });
});

describe('DatabaseManager.removeVersionFromTrack', () => {
    function trackWithVersions(versions, extra = {}) {
        const paths = Object.fromEntries(versions.map(v => [v, `/music/${v}.mp3`]));
        return { id: 't1', title: 'Piste', originalPaths: { ...paths }, localPaths: { ...paths }, defaultVersion: versions[0], ...extra };
    }

    it('removes a non-default version and keeps the rest', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm', 'combat', 'tension'])], playlists: [], metadata: {} });

        const result = await manager.removeVersionFromTrack('t1', 'combat');
        const track = manager.db.data.library[0];

        expect(result).toBe(true);
        expect(track.localPaths).toEqual({ calm: '/music/calm.mp3', tension: '/music/tension.mp3' });
        expect(track.originalPaths).toEqual({ calm: '/music/calm.mp3', tension: '/music/tension.mp3' });
        expect(track.defaultVersion).toBe('calm');
    });

    it('resets defaultVersion to the first remaining version when the default is removed', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm', 'combat'])], playlists: [], metadata: {} });

        await manager.removeVersionFromTrack('t1', 'calm');
        const track = manager.db.data.library[0];

        expect(track.defaultVersion).toBe('combat');
    });

    it('refuses to remove the last remaining version', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm'])], playlists: [], metadata: {} });

        await expect(manager.removeVersionFromTrack('t1', 'calm')).rejects.toThrow();
        expect(manager.db.data.library[0].localPaths).toEqual({ calm: '/music/calm.mp3' });
        expect(manager.db.write).not.toHaveBeenCalled();
    });

    it('returns false for a version that does not exist on the track', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm', 'combat'])], playlists: [], metadata: {} });

        const result = await manager.removeVersionFromTrack('t1', 'inexistante');

        expect(result).toBe(false);
        expect(manager.db.write).not.toHaveBeenCalled();
    });
});

describe('DatabaseManager.reorderTrackVersions', () => {
    function trackWithVersions(versions) {
        const paths = Object.fromEntries(versions.map(v => [v, `/music/${v}.mp3`]));
        return { id: 't1', title: 'Piste', originalPaths: { ...paths }, localPaths: { ...paths }, defaultVersion: versions[0] };
    }

    it('applies a valid permutation, preserving each version path', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm', 'combat', 'tension'])], playlists: [], metadata: {} });

        const result = await manager.reorderTrackVersions('t1', ['tension', 'calm', 'combat']);
        const track = manager.db.data.library[0];

        expect(result).toBe(true);
        expect(Object.keys(track.localPaths)).toEqual(['tension', 'calm', 'combat']);
        expect(track.localPaths.combat).toBe('/music/combat.mp3');
    });

    it('rejects an order that is not a permutation of the current versions', async () => {
        const manager = createDatabaseManager({ library: [trackWithVersions(['calm', 'combat'])], playlists: [], metadata: {} });

        const result = await manager.reorderTrackVersions('t1', ['calm', 'inexistante']);

        expect(result).toBe(false);
        expect(Object.keys(manager.db.data.library[0].localPaths)).toEqual(['calm', 'combat']);
        expect(manager.db.write).not.toHaveBeenCalled();
    });
});

describe('DatabaseManager — pistes découpées (#24)', () => {
    function splitLibrary() {
        return {
            library: [{
                id: 't1',
                title: 'Forêt',
                defaultVersion: 'combat',
                originalPaths: { calm: '/o.mp3', combat: '/o.mp3', boss: '/ob.mp3' },
                localPaths: { calm: '/s.mp3', combat: '/s.mp3', boss: '/b.mp3' },
                segments: { calm: { start: 0, end: 90 }, combat: { start: 90, end: 180 } },
            }],
            playlists: [],
            metadata: {},
        };
    }

    it('garde les segments valides à l\'ajout et retire les invalides', async () => {
        const manager = createDatabaseManager({ library: [], playlists: [], metadata: {} });

        await manager.addTrackToLibrary({
            id: 't2',
            title: 'Neuve',
            localPaths: { a: '/s', b: '/s' },
            segments: { a: { start: 0, end: 5 }, b: { start: 9, end: 3 } },
        });

        expect(manager.db.data.library[0].segments).toEqual({ a: { start: 0, end: 5 } });
    });

    it('retire le segment avec la version', async () => {
        const manager = createDatabaseManager(splitLibrary());

        await manager.removeVersionFromTrack('t1', 'calm');

        expect(manager.db.data.library[0].segments).toEqual({ combat: { start: 90, end: 180 } });
    });


    it('nettoie les segments d\'une piste importée', async () => {
        const manager = createDatabaseManager({ library: [], playlists: [], metadata: {} });

        await manager.mergeImportedLibrary({
            library: [{ id: 't3', title: 'Importée', localPaths: { a: '/s' }, segments: { a: { start: 'x', end: 2 } } }],
            playlists: [],
        });

        expect(manager.db.data.library[0]).not.toHaveProperty('segments');
    });
});

describe('DatabaseManager — revue finale #24', () => {
    it('remplacer une version découpée par un vrai fichier retire son segment', async () => {
        const manager = createDatabaseManager({
            library: [{
                id: 't1',
                title: 'Forêt',
                localPaths: { calm: '/s.mp3', combat: '/s.mp3' },
                originalPaths: { calm: '/o.mp3', combat: '/o.mp3' },
                segments: { calm: { start: 0, end: 90 }, combat: { start: 90, end: 180 } },
            }],
            playlists: [],
            metadata: {},
        });

        await manager.addVersionToTrack('t1', 'calm', '/nouveau.mp3', '/m/t1_calm.mp3');

        const track = manager.db.data.library[0];
        expect(track.localPaths.calm).toBe('/m/t1_calm.mp3');
        expect(track.segments).toEqual({ combat: { start: 90, end: 180 } });
    });

    it('la dernière version découpée remplacée : plus de segments du tout', async () => {
        const manager = createDatabaseManager({
            library: [{ id: 't1', title: 'x', localPaths: { calm: '/s.mp3' }, segments: { calm: { start: 0, end: 9 } } }],
            playlists: [],
            metadata: {},
        });

        await manager.addVersionToTrack('t1', 'calm', '/n.mp3', '/m/n.mp3');

        expect(manager.db.data.library[0]).not.toHaveProperty('segments');
    });
});

describe('DatabaseManager — version de lancement (#25)', () => {
    const library = () => ({
        library: [{ id: 't1', title: 'x', launchVersion: 'combat', localPaths: { calm: '/a', combat: '/b' }, originalPaths: { calm: '/a', combat: '/b' } }],
        playlists: [],
        metadata: {},
    });

    it('retirer la version de lancement l\'efface', async () => {
        const manager = createDatabaseManager(library());

        await manager.removeVersionFromTrack('t1', 'combat');

        expect(manager.db.data.library[0]).not.toHaveProperty('launchVersion');
    });

    it('refuse une version de lancement qui n\'existe pas', async () => {
        const manager = createDatabaseManager(library());

        await manager.updateTrack('t1', { launchVersion: 'boss' });

        expect(manager.db.data.library[0]).not.toHaveProperty('launchVersion');
    });

    it('enregistre une version de lancement existante', async () => {
        const manager = createDatabaseManager(library());

        await manager.updateTrack('t1', { launchVersion: 'calm' });

        expect(manager.db.data.library[0].launchVersion).toBe('calm');
    });

});

describe('DatabaseManager — tempo (#18)', () => {
    const library = () => ({
        library: [{
            id: 't1', title: 'x',
            localPaths: { calm: '/a', combat: '/b' }, originalPaths: { calm: '/a', combat: '/b' },
            tempo: { calm: { bpm: 120, offsetMs: 0 }, combat: { bpm: 90, offsetMs: 100 } },
        }],
        playlists: [],
        metadata: {},
    });

    it('nettoie le tempo enregistré depuis la modal', async () => {
        const manager = createDatabaseManager(library());

        await manager.updateTrack('t1', { tempo: { calm: { bpm: '100', offsetMs: '' }, combat: { bpm: 1000 }, boss: { bpm: 120 } } });

        expect(manager.db.data.library[0].tempo).toEqual({ calm: { bpm: 100, offsetMs: 0 } });
    });

    it('un tempo vide retire le champ', async () => {
        const manager = createDatabaseManager(library());

        await manager.updateTrack('t1', { tempo: {} });

        expect(manager.db.data.library[0]).not.toHaveProperty('tempo');
    });

    it('retirer une version retire son tempo', async () => {
        const manager = createDatabaseManager(library());

        await manager.removeVersionFromTrack('t1', 'combat');

        expect(manager.db.data.library[0].tempo).toEqual({ calm: { bpm: 120, offsetMs: 0 } });
    });

    it('nettoie le tempo d\'une piste importée', async () => {
        const manager = createDatabaseManager({ library: [], playlists: [], metadata: {} });

        await manager.mergeImportedLibrary({
            library: [{ id: 't9', title: 'i', localPaths: { calm: '/a' }, tempo: { calm: { bpm: 'x' } } }],
            playlists: [],
        });

        expect(manager.db.data.library[0]).not.toHaveProperty('tempo');
    });
});

describe('DatabaseManager.updateSources (#45)', () => {
    const library = () => ({
        library: [{
            id: 't1', title: 'x', launchVersion: 'combat',
            originalPaths: { calm: '/oa', combat: '/ob', boss: '/ofull' },
            localPaths: { calm: '/a', combat: '/b', boss: '/full' },
            segments: { calm: { start: 0, end: 5 }, combat: { start: 0, end: 4 } },
            tempo: { combat: { bpm: 120, offsetMs: 0 } },
        }],
        playlists: [], metadata: {},
    });

    it('ajoute une source copiée, persiste, ne signale aucun fichier inutile', async () => {
        const manager = createDatabaseManager(library());
        const { result, unusedPaths } = await manager.updateSources('t1', [
            { localPath: '/a', segments: { calm: { start: 0, end: 5 } } },
            { localPath: '/b', segments: { combat: { start: 0, end: 4 } } },
            { localPath: '/new', originalPath: '/home/new.mp3', segments: { victoire: { start: 0, end: 3 } } },
        ], { newLocalPaths: ['/new'] });
        expect(Object.keys(result.localPaths)).toEqual(['calm', 'combat', 'victoire', 'boss']);
        expect(result.originalPaths.victoire).toBe('/home/new.mp3');
        expect(result.originalPaths.combat).toBe('/ob');
        expect(unusedPaths).toEqual([]);
        expect(manager.db.write).toHaveBeenCalledOnce();
    });

    it('retirer une source : son fichier, sa version de lancement et son tempo disparaissent', async () => {
        const manager = createDatabaseManager(library());
        const { result, unusedPaths } = await manager.updateSources('t1', [{ localPath: '/a', segments: { calm: { start: 0, end: 5 } } }]);
        expect(unusedPaths).toEqual(['/b']);
        expect(result).not.toHaveProperty('launchVersion');
        expect(result).not.toHaveProperty('tempo');
        expect(manager.db.data.library[0]).toBe(result);
    });

    it('version de lancement renommée : celle choisie par l\'appelant', async () => {
        const manager = createDatabaseManager(library());
        const { result } = await manager.updateSources('t1', [
            { localPath: '/a', segments: { calm: { start: 0, end: 5 } } },
            { localPath: '/b', segments: { assaut: { start: 0, end: 4 } } },
        ], { launchVersion: 'assaut' });
        expect(result.launchVersion).toBe('assaut');
    });

    it('refuse sans rien modifier : chemin étranger, chemin de version entière, bornes invalides, doublon', async () => {
        for (const sources of [
            [{ localPath: '/elsewhere', segments: { a: { start: 0, end: 1 } } }],
            [{ localPath: '/full', segments: { a: { start: 0, end: 1 } } }],
            [{ localPath: '/a', segments: { calm: { start: 5, end: 1 } } }],
            [{ localPath: '/a', segments: { Boss: { start: 0, end: 1 } } }],
        ]) {
            const data = library();
            const before = structuredClone(data.library[0]);
            const manager = createDatabaseManager(data);
            await expect(manager.updateSources('t1', sources)).rejects.toThrow();
            expect(manager.db.data.library[0]).toEqual(before);
            expect(manager.db.write).not.toHaveBeenCalled();
        }
    });
});
