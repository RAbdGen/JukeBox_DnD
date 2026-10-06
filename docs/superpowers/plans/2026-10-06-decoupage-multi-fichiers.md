# Découpage multi-fichiers — plan d'implémentation (#45)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une piste peut contenir les versions découpées de plusieurs fichiers sources, créées et retouchées depuis l'onglet Découpage (un onglet par fichier).

**Architecture:** `data.json` inchangé : une « source » est dérivée (versions découpées partageant un `localPath`). Logique pure dans `backend/segments.js` (regroupement, construction, mise à jour, flux copie→enregistrement→nettoyage) et `frontend/segmentModel.js` (validation, requêtes, version de lancement). `DatabaseManager.updateSources` remplace `updateSegments`, l'IPC `library:updateSources` remplace `library:updateSegments`. L'onglet Découpage gère une liste d'onglets (modèle Tabs Radix, `rovingKeyTarget` de `frontend/roving.js`).

**Tech Stack:** Electron 44, Vanilla JS ESM, Howler 2.2.4, lowdb 7, Vitest, ESLint 10.

**Spec:** `docs/superpowers/specs/2026-10-06-decoupage-multi-fichiers-design.md`

## Global Constraints

- Aucune migration de `data.json` ; `track.segments || {}` toujours lu ainsi.
- Un fichier de `userData/music/` n'est supprimé que via `FileManager.deleteAudioFile`, et seulement s'il ne sert plus à aucune version.
- Bornes reçues par IPC validées côté base, rejet atomique : rien de modifié, fichiers copiés pour l'occasion supprimés (#34).
- Noms de version uniques sur toute la piste, sans casse, après trim, versions entières comprises.
- Texte UI : `data-i18n*` ou `t()`, clés fr + en (parité), jamais de `title` natif (`setTooltip`), couleurs par variables, durées par jetons, `frontend/styles/cutter.css` < 40 000 octets.
- `npm test` et `npm run lint` à 0 échec / 0 problème à chaque commit. Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Retouche refusée par la base après la copie d'un nouveau fichier → le fichier copié est supprimé, la piste est intacte (test Task 1, `persistSources`).
2. Fichier source existant illisible à la retouche → ses versions sont renvoyées telles quelles, jamais supprimées en silence (test Task 3, `sourceRequests`).
3. Onglet sans aucun segment nommé → erreur nommant le fichier, pas une suppression silencieuse de ses versions (test Task 3, `validateSources`).
4. La version de lancement appartenait à un fichier retiré → effacée, la piste démarre sur sa première version (test Task 2).
5. Un `localPath` de version **entière**, ou étranger à la piste, envoyé comme source → rejeté (test Task 2).

---

### Task 1: `backend/segments.js` — sources dérivées et flux de sauvegarde

**Files:**
- Modify: `backend/segments.js`
- Test: `tests/segments.test.js`

**Interfaces:**
- Produces:
  - `sourceGroups(track) → [{ localPath, originalPath, names: string[] }]` (ordre d'apparition dans `localPaths`, noms triés par début)
  - `buildSegmentedTrack({ trackId, title, sources: [{ sourcePath, localPath, segments }], selectedPlaylists?, now? })`
  - `applySourcesUpdate(track, sources: [{ localPath, originalPath, segments }]) → track` (remplace `applySegmentUpdate`, supprimé)
  - `unusedPaths(beforeLocalPaths, afterLocalPaths) → string[]`
  - `persistSources({ requests: [{ sourcePath? , localPath?, segments }], reservedPaths, copyFile(sourcePath, reserved) → Promise<localPath>, deleteFile(path) → Promise, persist(sources, copiedPaths) → Promise<{ result, unusedPaths? }> }) → Promise<result>`

- [ ] **Step 1: tests (remplacent ceux de `buildSegmentedTrack` et `applySegmentUpdate`)**

```js
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
        expect(() => applySourcesUpdate(track(), [{ localPath: '/a', segments: { Boss: { start: 0, end: 5 } } }])).toThrow(/Boss/);
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
```

- [ ] **Step 2:** `npm test -- tests/segments.test.js` → FAIL (`sourceGroups is not a function`…).

- [ ] **Step 3: implémentation** (supprimer `applySegmentUpdate`)

```js
/** Versions nommées des sources, dans l'ordre des sources puis des segments */
function flattenSources(sources = []) {
    return sources.flatMap(source => orderedSegmentNames(source.segments)
        .map(name => ({ name, source, segment: source.segments[name] })));
}

function assertUniqueNames(names) {
    const seen = new Set();
    for (const name of names) {
        const key = name.trim().toLowerCase();
        if (seen.has(key)) throw new Error(`Nom de version déjà utilisé : ${name}`);
        seen.add(key);
    }
}

const copySegment = ({ start, end }) => ({ start, end });

export function sourceGroups(track) {
    const segments = track?.segments || {};
    const originalPaths = track?.originalPaths || {};
    const groups = new Map();
    for (const [name, localPath] of Object.entries(track?.localPaths || {})) {
        if (!segments[name] || !localPath) continue;
        if (!groups.has(localPath)) groups.set(localPath, { localPath, originalPath: originalPaths[name] ?? localPath, names: [] });
        groups.get(localPath).names.push(name);
    }
    return [...groups.values()].map(group => ({
        ...group,
        names: group.names.sort((a, b) => segments[a].start - segments[b].start),
    }));
}

export function buildSegmentedTrack({ trackId, title, sources, selectedPlaylists = [], now = new Date() }) {
    const entries = flattenSources(sources);
    if (entries.length === 0) throw new Error('Aucun segment nommé');
    assertUniqueNames(entries.map(entry => entry.name));

    const timestamp = now.toISOString();
    return {
        id: trackId,
        title,
        originalPaths: Object.fromEntries(entries.map(({ name, source }) => [name, source.sourcePath])),
        localPaths: Object.fromEntries(entries.map(({ name, source }) => [name, source.localPath])),
        segments: Object.fromEntries(entries.map(({ name, segment }) => [name, copySegment(segment)])),
        defaultVersion: entries[0].name,
        defaultVolume: 0.5,
        metadata: { addedAt: timestamp, modifiedAt: timestamp },
        inPlaylists: selectedPlaylists,
    };
}

export function applySourcesUpdate(track, sources) {
    const segmented = new Set(Object.keys(track.segments || {}));
    const oldLocal = track.localPaths || {};
    const oldOriginal = track.originalPaths || {};
    const fullFileNames = Object.keys(oldLocal).filter(name => !segmented.has(name));
    const entries = flattenSources(sources);

    assertUniqueNames([...entries.map(entry => entry.name), ...fullFileNames]);
    if (entries.length + fullFileNames.length === 0) throw new Error(`La piste ${track.id} n'aurait plus aucune version`);

    track.localPaths = {
        ...Object.fromEntries(entries.map(({ name, source }) => [name, source.localPath])),
        ...Object.fromEntries(fullFileNames.map(name => [name, oldLocal[name]])),
    };
    track.originalPaths = {
        ...Object.fromEntries(entries.map(({ name, source }) => [name, source.originalPath ?? source.localPath])),
        ...Object.fromEntries(fullFileNames.map(name => [name, oldOriginal[name] ?? oldLocal[name]])),
    };
    if (entries.length > 0) {
        track.segments = Object.fromEntries(entries.map(({ name, segment }) => [name, copySegment(segment)]));
    } else {
        delete track.segments;
    }
    return track;
}

export function unusedPaths(before = {}, after = {}) {
    const kept = new Set(uniquePaths(after));
    return uniquePaths(before).filter(path => !kept.has(path));
}

/**
 * Création ou retouche d'une piste découpée (#45) : copie des nouveaux
 * fichiers, enregistrement, puis suppression des fichiers devenus inutiles.
 * Enregistrement refusé : les copies sont supprimées, rien d'autre ne bouge.
 */
export async function persistSources({ requests, reservedPaths = [], copyFile, deleteFile, persist }) {
    const copied = [];
    let saved;
    try {
        const sources = [];
        for (const request of requests) {
            if (request.sourcePath) {
                const localPath = await copyFile(request.sourcePath, [...reservedPaths, ...copied]);
                copied.push(localPath);
                sources.push({ localPath, originalPath: request.sourcePath, segments: request.segments });
            } else {
                sources.push({ localPath: request.localPath, segments: request.segments });
            }
        }
        saved = await persist(sources, copied);
    } catch (error) {
        for (const path of copied) await deleteFile(path);
        throw error;
    }
    for (const path of saved.unusedPaths || []) await deleteFile(path);
    return saved.result;
}
```

- [ ] **Step 4:** `npm test -- tests/segments.test.js` → PASS (les tests `DatabaseManager` sur `updateSegments` cassent : corrigés en Task 2, ne pas committer avant).

---

### Task 2: `DatabaseManager.updateSources` + IPC

**Files:**
- Modify: `backend/DatabaseManager.js` (remplace `updateSegments`), `electron/main.cjs` (`library:addSegmentedTrack`, `library:updateSources`), `electron/preload.cjs`
- Test: `tests/DatabaseManager.test.js` (les tests `updateSegments` deviennent `updateSources`)

**Interfaces:**
- Consumes: `applySourcesUpdate`, `unusedPaths`, `sanitizeSegments`, `sourceGroups`, `persistSources` (Task 1)
- Produces:
  - `dbManager.updateSources(trackId, sources: [{ localPath, originalPath?, segments }], { launchVersion?, newLocalPaths? = [] }) → Promise<{ result: track, unusedPaths: string[] }>`
  - `window.electronAPI.addSegmentedTrack({ title, sources: [{ sourcePath, segments }] }, playlists)`
  - `window.electronAPI.updateSources(trackId, requests: [{ localPath | sourcePath, segments }], launchVersion?)`

- [ ] **Step 1: tests**

```js
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
```
(Supprimer les anciens tests `updateSegments` : `applique la retouche et persiste`, `fait disparaître la version de lancement`, `bornes reçues par IPC (#34)` — couverts ci-dessus.)

- [ ] **Step 2:** `npm test -- tests/DatabaseManager.test.js` → FAIL.

- [ ] **Step 3: `DatabaseManager.updateSources`** (remplace `updateSegments` ; importer `applySourcesUpdate`, `unusedPaths`, `sourceGroups` depuis `./segments.js`, retirer `applySegmentUpdate`)

```js
    /**
     * Retouche des versions découpées d'une piste (#45) : `sources` remplace
     * toutes ses sources. Un `localPath` doit être celui d'une source de la
     * piste, ou un fichier tout juste copié (`newLocalPaths`). Tout est validé
     * avant la moindre modification (#34).
     * @returns {{ result: object, unusedPaths: string[] }} piste enregistrée, fichiers qui ne servent plus
     */
    async updateSources(trackId, sources, { launchVersion, newLocalPaths = [] } = {}) {
        const index = this.db.data.library.findIndex(t => t.id === trackId);
        if (index === -1) throw new Error(`Track ${trackId} introuvable`);
        const track = this.db.data.library[index];
        if (!Array.isArray(sources)) throw new Error(`Sources invalides pour ${trackId}`);

        const existing = new Map(sourceGroups(track).map(group => [group.localPath, group.originalPath]));
        const clean = sources.map(source => {
            const isNew = newLocalPaths.includes(source?.localPath);
            if (!isNew && !existing.has(source?.localPath)) throw new Error(`Fichier inconnu pour ${trackId}`);
            const names = Object.keys(source.segments || {});
            const segments = sanitizeSegments(source.segments, Object.fromEntries(names.map(name => [name, true])));
            if (!segments || Object.keys(segments).length !== names.length) {
                throw new Error(`Segments invalides pour ${trackId}`);
            }
            const originalPath = isNew ? (source.originalPath ?? source.localPath) : existing.get(source.localPath);
            return { localPath: source.localPath, originalPath, segments };
        });

        const next = applySourcesUpdate(structuredClone(track), clean);
        if (launchVersion && Object.hasOwn(next.localPaths, launchVersion)) {
            next.launchVersion = launchVersion;
        } else if (next.launchVersion && !Object.hasOwn(next.localPaths, next.launchVersion)) {
            delete next.launchVersion; // version de lancement retirée (#25)
        }
        if (next.tempo) setTempo(next, next.tempo); // tempo des versions renommées/retirées (#18)
        if (next.metadata) next.metadata.modifiedAt = new Date().toISOString();

        this.db.data.library[index] = next;
        this.updateMetadata();
        await this.db.write();

        console.log(`✂️ Découpe de "${next.title}" mise à jour`);
        return { result: next, unusedPaths: unusedPaths(track.localPaths, next.localPaths) };
    }
```
Vérifier que `setTempo` retire le champ quand plus rien ne reste (sinon adapter le test « son tempo disparaît »).

- [ ] **Step 4: IPC** (`electron/main.cjs`)

```js
// Musique découpée (#24, plusieurs fichiers #45) : chaque fichier source est
// copié une fois, ses versions découpées pointent dessus ; jamais modifié.
ipcHandle('library:addSegmentedTrack', async (event, trackData, selectedPlaylists = []) => {
    try {
        const trackId = fileManager.generateTrackId();
        let saved = null;
        return await segmentsModule.persistSources({
            requests: (trackData.sources || []).map(source => ({ sourcePath: source.sourcePath, segments: source.segments })),
            copyFile: (sourcePath, reserved) => fileManager.copyAudioFile(sourcePath, trackId, segmentsModule.SOURCE_VERSION_KEY, reserved),
            // Piste enregistrée puis échec sur une playlist : ses fichiers doivent rester (#34)
            deleteFile: path => (saved ? Promise.resolve(false) : fileManager.deleteAudioFile(path)),
            persist: async sources => {
                const track = segmentsModule.buildSegmentedTrack({
                    trackId,
                    title: trackData.title,
                    sources: sources.map(source => ({ ...source, sourcePath: source.originalPath })),
                    selectedPlaylists,
                });
                saved = await dbManager.addTrackToLibrary(track);
                await Promise.all(selectedPlaylists.map(playlistId => dbManager.addTrackIdToPlaylist(playlistId, trackId)));
                console.log(`✂️ Piste découpée "${track.title}" ajoutée`);
                return { result: saved };
            },
        });
    } catch (error) {
        console.error('❌ Erreur addSegmentedTrack:', error);
        throw error;
    }
});

ipcHandle('library:updateSources', async (event, trackId, requests, launchVersion) => {
    try {
        const track = await dbManager.getTrack(trackId);
        if (!track) throw new Error(`Track ${trackId} introuvable`);
        return await segmentsModule.persistSources({
            requests: Array.isArray(requests) ? requests.map(r => ({ sourcePath: r?.sourcePath, localPath: r?.localPath, segments: r?.segments })) : [],
            reservedPaths: segmentsModule.uniquePaths(track.localPaths),
            copyFile: (sourcePath, reserved) => fileManager.copyAudioFile(sourcePath, trackId, segmentsModule.SOURCE_VERSION_KEY, reserved),
            deleteFile: path => fileManager.deleteAudioFile(path),
            persist: (sources, copied) => dbManager.updateSources(trackId, sources, { launchVersion, newLocalPaths: copied }),
        });
    } catch (error) {
        console.error('❌ Erreur updateSources:', error);
        throw error;
    }
});
```
`preload.cjs` : remplacer `updateSegments` par
```js
    updateSources: (trackId, requests, launchVersion) =>
        ipcRenderer.invoke('library:updateSources', trackId, requests, launchVersion),
```

- [ ] **Step 5:** `npm test && npm run lint` → PASS (le renderer appelle encore `updateSegments` : corrigé en Task 4 ; `grep -rn updateSegments frontend backend electron` ne doit plus lister que `cutterView.js`).

- [ ] **Step 6: commit** `feat(découpage): sources multiples côté données et IPC (#45)`.

---

### Task 3: `frontend/segmentModel.js` — validation, requêtes, version de lancement

**Files:**
- Modify: `frontend/segmentModel.js` (remplace `validateSplit`, `stateFromTrack`, `planSegmentUpdate`)
- Test: `tests/segmentModel.test.js`

**Interfaces:**
- Produces:
  - `stateFromSegments(segments, duration) → { cuts, names }` (corps de l'ancien `stateFromTrack`, sur les segments d'une source)
  - `validateSources({ title, sources: [{ fileName, ranges: Range[] | null, names: string[] }], reservedNames }) → { key, vars?, sourceIndex? } | null` (`ranges: null` = fichier illisible, `names` = ses versions conservées)
  - `sourceRequests(tabs) → [{ localPath | sourcePath, segments }]` (tab : `{ localPath?, sourcePath?, duration, cuts, names, loadError, keptSegments? }`)
  - `planLaunchVersion(track, requests) → string | undefined`

- [ ] **Step 1: tests**

```js
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
```
Le test existant de `stateFromTrack` devient `stateFromSegments(track.segments, 200)` ; les tests `validateSplit` et `planSegmentUpdate` sont supprimés (remplacés).

- [ ] **Step 2:** `npm test -- tests/segmentModel.test.js` → FAIL.

- [ ] **Step 3: implémentation**

```js
export function validateSources({ title, sources, reservedNames = [] }) {
    if (!title || !title.trim()) return { key: 'split.errorTitle' };
    if (sources.length === 0 && reservedNames.length === 0) return { key: 'split.errorNoNamed' };

    const seen = new Map(reservedNames.map(name => [name.trim().toLowerCase(), null])); // nom → fichier (null : version entière)
    for (const [sourceIndex, source] of sources.entries()) {
        const named = source.ranges
            ? source.ranges.map((range, i) => ({ ...range, name: (source.names[i] || '').trim() })).filter(range => range.name)
            : source.names.map(name => ({ name: name.trim() }));
        if (named.length === 0) return { key: 'split.errorNoNamedIn', vars: { file: source.fileName }, sourceIndex };

        for (const range of named) {
            const key = range.name.toLowerCase();
            if (seen.has(key)) {
                const file = seen.get(key);
                return file === null
                    ? { key: 'split.errorDuplicate', vars: { name: range.name }, sourceIndex }
                    : { key: 'split.errorDuplicateIn', vars: { name: range.name, file }, sourceIndex };
            }
            seen.set(key, source.fileName);
        }
        if (source.ranges && named.some(range => range.end - range.start < MIN_SEGMENT_SECONDS - EPSILON)) {
            return { key: 'split.errorTooShort', sourceIndex };
        }
    }
    return null;
}

export function sourceRequests(tabs) {
    return tabs.map(tab => {
        const segments = tab.loadError
            ? tab.keptSegments
            : rangesToSegments(cutsToRanges(tab.cuts, tab.duration), tab.names);
        return tab.localPath ? { localPath: tab.localPath, segments } : { sourcePath: tab.sourcePath, segments };
    });
}

export function planLaunchVersion(track, requests) {
    const launch = track.launchVersion;
    if (!launch) return undefined;
    const old = (track.segments || {})[launch];
    if (!old) return launch; // version entière : inchangée
    const source = requests.find(request => request.localPath && request.localPath === track.localPaths?.[launch]);
    if (!source) return undefined;
    const middle = (old.start + old.end) / 2;
    return Object.keys(source.segments).find(name => source.segments[name].start <= middle && middle < source.segments[name].end);
}
```
`stateFromSegments(segments, duration)` = corps de `stateFromTrack` avec `const segments = segments || {}` en paramètre.

- [ ] **Step 4:** `npm test -- tests/segmentModel.test.js` → PASS.

---

### Task 4: onglet Découpage multi-fichiers + ✂ sur toute piste

**Files:**
- Modify: `frontend/index.html` (vue `#decoupage-view`), `frontend/cutterView.js`, `frontend/renderer.js` (bouton ✂), `backend/i18n.js`, `frontend/styles/cutter.css`
- Test: `tests/cutterView.test.js` (HTML : rôles ARIA), `tests/i18n.test.js` (parité, déjà là)

**Interfaces:**
- Consumes: `rovingKeyTarget(key, index, count)` (`frontend/roving.js`), `sourceGroups` (Task 1), `stateFromSegments`, `validateSources`, `sourceRequests`, `planLaunchVersion` (Task 3), `electronAPI.addSegmentedTrack` / `updateSources` (Task 2)
- Produces: `cutterView.openTrack(track)` accepte toute piste.

- [ ] **Step 1: test HTML** (`tests/cutterView.test.js`)

```js
describe('Découpage : onglets de fichiers (#45)', () => {
    const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
    it('liste d\'onglets étiquetée, panneau, ajout et retrait de fichier, récapitulatif', () => {
        expect(html).toMatch(/id="split-tabs"[^>]*role="tablist"[^>]*data-i18n-label="split.filesLabel"/);
        expect(html).toMatch(/id="split-editor"[^>]*role="tabpanel"/);
        expect(html).toMatch(/id="split-add-file"[^>]*data-i18n="split.addFile"/);
        expect(html).toMatch(/id="split-remove-file"[^>]*data-i18n="split.removeFile"/);
        expect(html).toMatch(/id="split-summary"/);
        expect(html).not.toMatch(/id="split-choose-file"/);
    });
});
```
→ FAIL.

- [ ] **Step 2: HTML.** Dans `#decoupage-view .split-panel` :
  - `.split-header` : `<div id="split-tabs" class="split-tabs" role="tablist" data-i18n-label="split.filesLabel" aria-label="Fichiers découpés"></div>` + `<button type="button" id="split-add-file" class="secondary-btn" data-i18n="split.addFile">＋ Ajouter un fichier</button>` (remplace `#split-choose-file` et `#split-file-name`).
  - `#split-editor` reçoit `role="tabpanel"` ; la barre d'outils gagne `<button type="button" id="split-remove-file" class="danger-btn-small" data-i18n="split.removeFile">Retirer ce fichier</button>` en fin.
  - Le pied (titre, playlists, `#split-error`, actions) sort de `#split-editor` dans `<div id="split-form" class="split-form hidden">`, précédé de `<p id="split-summary" class="split-summary"></p>`.

- [ ] **Step 3: i18n** (fr / en), retirer `split.chooseFile` :

| clé | fr | en |
|---|---|---|
| `split.addFile` | `＋ Ajouter un fichier` | `＋ Add a file` |
| `split.removeFile` | `Retirer ce fichier` | `Remove this file` |
| `split.confirmRemoveFile` | `Retirer « {file} » et ses versions ?` | `Remove "{file}" and its versions?` |
| `split.filesLabel` | `Fichiers découpés` | `Split files` |
| `split.summary` | `Versions de la piste : {names}` | `Track versions: {names}` |
| `split.summaryFull` | `fichiers entiers : {names}` | `whole files: {names}` |
| `split.noSource` | `Ajoutez un fichier à découper dans cette piste.` | `Add a file to split into this track.` |
| `split.fileUnreadable` | `Fichier illisible : ses versions sont conservées telles quelles.` | `Unreadable file: its versions are kept as they are.` |
| `split.errorNoNamedIn` | `Nommez au moins un segment de « {file} », ou retirez ce fichier.` | `Name at least one segment of "{file}", or remove this file.` |
| `split.errorDuplicateIn` | `Le nom « {name} » est déjà utilisé dans {file}.` | `The name "{name}" is already used in {file}.` |

`split.noFile` devient « Ajoutez un fichier audio à découper en versions. » / « Add an audio file to split into versions. ».

- [ ] **Step 4: `cutterView.js` — état.**

```js
function emptyTab() {
    return { key: ++tabKeys, sourcePath: null, localPath: null, readPath: null, fileName: '', duration: 0, peaks: null,
        cuts: [], names: [''], view: { start: 0, end: 0 }, playhead: 0, selectedCut: null, loading: true, loadError: false, keptSegments: null };
}
function emptyState() {
    return { tabs: [], active: 0, editingTrack: null, reservedNames: [], dirty: false, message: { key: 'split.noFile' }, error: null };
}
const tab = () => state.tabs[state.active] || null;
```
Toutes les fonctions existantes (rendu, waveform, souris, clavier, coupes, écoute) lisent et écrivent `tab()` au lieu de `state` pour `sourcePath`/`duration`/`peaks`/`cuts`/`names`/`view`/`playhead`/`selectedCut` ; `state.dirty`/`state.error` restent communs. `startAudition` lit `tab().readPath`.

- [ ] **Step 5: chargement d'un onglet** (une session = `loads` existant ; tout chargement vérifie `loads.isCurrent(session) && state.tabs.includes(target)`)

```js
async function loadTab(target, session) {
    try {
        const bytes = await electronAPI.readAudioFile(target.readPath);
        if (!loads.isCurrent(session) || !state.tabs.includes(target)) return;
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const { duration, peaks } = await decodeForWaveform(arrayBuffer); // l'audio décodé n'est pas gardé (#36)
        if (!loads.isCurrent(session) || !state.tabs.includes(target)) return;
        Object.assign(target, { duration, peaks, view: fullView(duration), loading: false });
        if (target.keptSegments) Object.assign(target, stateFromSegments(target.keptSegments, duration), { keptSegments: null });
    } catch (error) {
        if (!loads.isCurrent(session) || !state.tabs.includes(target)) return;
        console.error('❌ Découpage : lecture du fichier impossible', error);
        target.loading = false;
        target.loadError = true;
    }
    refresh();
}
```
`keptSegments` reste renseigné tant que le fichier est illisible : `sourceRequests` les renvoie tels quels.

- [ ] **Step 6: ouvrir une piste / ajouter / retirer un fichier**

```js
function openTrack(track) {
    stopAudition();
    const session = loads.start();
    const segments = track.segments || {};
    state = { ...emptyState(), editingTrack: track, message: null,
        reservedNames: Object.keys(track.localPaths || {}).filter(name => !segments[name]) };
    state.tabs = sourceGroups(track).map(group => ({ ...emptyTab(), localPath: group.localPath, readPath: group.localPath,
        fileName: group.originalPath.split(/[\\/]/).pop(),
        keptSegments: Object.fromEntries(group.names.map(name => [name, segments[name]])) }));
    $('split-title').value = track.title;
    state.tabs.forEach(target => loadTab(target, session));
    refresh();
}

async function addFile() {
    const [sourcePath] = await electronAPI.openFiles();
    if (!sourcePath) return;
    stopAudition();
    if (state.tabs.length === 0 && !state.editingTrack) {
        loads.start();
        state = { ...emptyState(), message: null };
        $('split-title').value = sourcePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
        await renderPlaylists();
    }
    const target = { ...emptyTab(), sourcePath, readPath: sourcePath, fileName: sourcePath.split(/[\\/]/).pop() };
    state.tabs.push(target);
    state.active = state.tabs.length - 1;
    state.dirty = true;
    refresh();
    await loadTab(target, currentSession());
    if (target.loadError) { // nouveau fichier illisible : pas d'onglet, message comme avant
        removeTab(state.tabs.indexOf(target));
        state.message = { key: 'split.loadError' };
        refresh();
    }
}

function removeTab(index) {
    stopAudition();
    state.tabs.splice(index, 1);
    state.active = Math.min(state.active, Math.max(0, state.tabs.length - 1));
    if (state.tabs.length === 0 && !state.editingTrack) { loads.cancel(); state = emptyState(); }
    else state.dirty = true;
    refresh();
}
```
`createLatestOnly` gagne `current: () => current` pour `currentSession()`. Bouton `#split-remove-file` : confirmation `split.confirmRemoveFile` si l'onglet a un nom non vide (`tab().names.some(n => n.trim())` ou `keptSegments`), puis `removeTab(state.active)`.

- [ ] **Step 7: onglets (rendu + clavier)**

```js
function renderTabs() {
    const list = $('split-tabs');
    list.replaceChildren(...state.tabs.map((target, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `split-tab-${target.key}`;
        button.className = 'split-tab';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(i === state.active));
        button.setAttribute('aria-controls', 'split-editor');
        button.tabIndex = i === state.active ? 0 : -1;
        button.textContent = target.fileName; // jamais innerHTML : nom de fichier utilisateur
        button.classList.toggle('has-error', target.loadError);
        button.addEventListener('click', () => selectTab(i));
        return button;
    }));
    const current = tab();
    if (current) $('split-editor').setAttribute('aria-labelledby', `split-tab-${current.key}`);
}

function selectTab(index, { focus = false } = {}) {
    if (index === state.active) return;
    stopAudition();
    state.active = index;
    refresh();
    if (focus) $(`split-tab-${tab().key}`).focus();
}

$('split-tabs').addEventListener('keydown', event => {
    const target = rovingKeyTarget(event.key, state.active, state.tabs.length);
    if (target === null) return;
    event.preventDefault();
    selectTab(target, { focus: true });
});
```

- [ ] **Step 8: `refresh()`**
  - `#split-tabs` / `#split-add-file` : toujours visibles ; `#split-editor` visible si `tab()?.peaks` ; message : `tab()?.loading` → `split.loading`, `tab()?.loadError` → `split.fileUnreadable`, retouche sans onglet → `split.noSource`, sinon `state.message`.
  - `#split-form` visible si `state.tabs.length > 0 || state.editingTrack` ; titre en lecture seule et playlists masquées en retouche (comme avant).
  - `#split-summary` : `t('split.summary', { names })` avec les noms non vides de chaque onglet dans l'ordre (`keptSegments` pour un fichier illisible), suivi de ` · ${t('split.summaryFull', { names: reservedNames.join(', ') })}` dans un `<span class="split-summary-full">` s'il y a des versions entières — via `textContent`/`append`, jamais `innerHTML`.

- [ ] **Step 9: enregistrer**

```js
$('split-submit').addEventListener('click', async () => {
    if (state.tabs.some(target => target.loading)) return;
    const title = $('split-title').value.trim();
    const sources = state.tabs.map(target => target.loadError
        ? { fileName: target.fileName, ranges: null, names: Object.keys(target.keptSegments || {}) }
        : { fileName: target.fileName, ranges: cutsToRanges(target.cuts, target.duration), names: target.names });
    state.error = validateSources({ title, sources, reservedNames: state.reservedNames });
    if (state.error) {
        if (state.error.sourceIndex !== undefined) state.active = state.error.sourceIndex;
        refresh();
        return;
    }
    const requests = sourceRequests(state.tabs);
    try {
        if (state.editingTrack) {
            await electronAPI.updateSources(state.editingTrack.id, requests, planLaunchVersion(state.editingTrack, requests));
        } else {
            const playlists = Array.from(root.querySelectorAll('#split-playlists input:checked')).map(cb => cb.value);
            await electronAPI.addSegmentedTrack({ title, sources: requests }, playlists);
        }
    } catch (error) { /* inchangé : split.errorSave */ }
    /* suite inchangée : message saved/added, état vide, onSaved() */
});
```
`#split-cancel` : `loads.cancel(); stopAudition(); state = emptyState(); refresh();` (inchangé). `canDiscard()` inchangé (`state.dirty`).

- [ ] **Step 10: ✂ sur toute piste** (`renderer.js`, ligne de bibliothèque) : retirer la condition `Object.keys(track.segments || {}).length > 0` autour du bouton `.split-track-btn` ; `openTrack` public : `if (!canDiscard()) return; openTrack(track);`. Vérifier que l'objet `track` passé contient `localPaths`, `originalPaths`, `segments`.

- [ ] **Step 11: CSS** (`frontend/styles/cutter.css`) : `.split-tabs` (flex, wrap, gap), `.split-tab` (fond `--ink-0`, bordure `--ink-3`, texte `--bone-dim`, `transition-property: color, background-color, border-color; transition-duration: var(--duration-base)`), `.split-tab[aria-selected="true"]` (bordure `--gold-2`, texte `--bone`), `.split-tab:focus-visible` (outline `--gold-2`), `.split-tab.has-error` (texte `--danger-text` ou variable danger existante), `.split-summary` (texte `--bone`), `.split-summary-full` (`--bone-dim`). Aucune couleur en dur. Vérifier `tests/theme-contrast.test.js` et `tests/styles-split.test.js`.

- [ ] **Step 12:** `npm test && npm run lint` → PASS.

- [ ] **Step 13: vérification Electron** (profil isolé, CDP) : créer une piste à partir de 2 fichiers (dont deux de même nom dans des dossiers différents), vérifier `data.json` (2 copies distinctes), fondu entre versions de fichiers différents, retouche (ajout d'un 3ᵉ fichier, retrait d'un fichier → sa copie supprimée de `music/`), ✂ sur une piste entière, fichier source supprimé du disque → onglet en erreur et versions conservées à l'enregistrement, clavier sur les onglets.

- [ ] **Step 14: commit** `feat(découpage): plusieurs fichiers découpés dans une même piste (closes #45)`.

---

### Task 5: documentation et suivi

- [ ] CLAUDE.md + AGENTS.md (identiques, `cmp`) : ligne « Versions découpées » de la stack (plusieurs fichiers, `sourceGroups`, `persistSources`, `updateSources`), règle UI « Onglets du Découpage », backlog (#45 → Terminées).
- [ ] README : fonctionnalité Découpage (plusieurs fichiers), compte de tests.
- [ ] Spec : rien à réviser si l'implémentation la suit ; sinon annoter.
- [ ] `gh issue close 45` avec résumé + vérification, Project → Done.
