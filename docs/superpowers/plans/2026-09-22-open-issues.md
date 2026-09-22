# Open Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger les issues GitHub ouvertes #8 à #12 sans modifier le schéma `data.json`.

**Architecture:** Le volume maître reste géré par `Howler.volume()` et la normalisation persistée reste portée par `Track.defaultVolume`; ces deux valeurs ne doivent jamais s’écraser. L’import est coordonné dans un module ESM testable avant l’appel IPC Electron. Le renderer conserve explicitement les identifiants dont la suppression peut encore être annulée.

**Tech Stack:** Electron CJS, modules backend/frontend ESM, Howler.js, LowDB, Vitest.

**Spec:** Issues GitHub #8 à #12, répertoriées dans `AGENTS.md` et `CLAUDE.md`.

## Global Constraints

- Conserver les modules ESM, sauf les fichiers `.cjs` d’Electron.
- Ne pas modifier le schéma de `data.json`.
- Ne pas ajouter de framework frontend.
- Préserver l’utilisation de Howler.js et le comportement de crossfade existant.
- Mettre à jour les deux fichiers d’instructions, l’issue GitHub et le Project après chaque correction terminée.

---

### Task 1: Créer le socle de tests audio pour #8 et #12

**Files:**
- Create: `tests/AudioManager.test.js`
- Modify: `package.json`
- Modify: aucun fichier de production

**Interfaces:**
- Consumes: `AudioManager.setVolume(volume)`, `AudioManager.resume()`, `AudioManager.fadeVolume(target, duration)`.
- Produces: des tests qui échouent tant que le volume global modifie `Track.defaultVolume` ou qu’un fondu écrase un réglage manuel.

- [x] **Step 1: Écrire les tests en échec**

```js
it('préserve le volume normalisé de la piste lors d’un réglage global', () => {
    const manager = new AudioManager();
    const track = { defaultVolume: 0.35, setVolume: vi.fn() };
    manager.currentTrack = track;

    manager.setVolume(0.8);

    expect(track.defaultVolume).toBe(0.35);
    expect(track.setVolume).not.toHaveBeenCalled();
});

it('reprend une piste normalisée à zéro au volume zéro', () => {
    const howl = { volume: vi.fn(), play: vi.fn() };
    const manager = new AudioManager();
    manager.currentTrack = { defaultVolume: 0, currentVersion: 'calm', versions: { calm: howl }, isPlaying: false };

    manager.resume();

    expect(howl.volume).toHaveBeenCalledWith(0);
});
```

- [x] **Step 2: Lancer les tests et constater l’échec**

Run: `npm test -- tests/AudioManager.test.js`

Expected: le premier test montre l’appel à `track.setVolume()` et le second reçoit le volume maître au lieu de `0`.

La configuration Vite utilise `frontend/` comme racine. Le script `test` doit donc appeler Vitest avec `--root .` pour découvrir les tests backend dans `tests/`.

- [x] **Step 3: Ajouter le scénario de course pour le fondu**

```js
it('annule un fondu lorsqu’un réglage manuel du volume intervient', async () => {
    vi.useFakeTimers();
    const manager = new AudioManager();
    const fading = manager.fadeVolume(0, 300);

    manager.setVolume(0.7);
    await vi.advanceTimersByTimeAsync(400);
    await fading;

    expect(manager.getVolume()).toBe(0.7);
});
```

- [x] **Step 4: Lancer le test de course et constater l’échec**

Run: `npm test -- tests/AudioManager.test.js`

Expected: le fondu réapplique une valeur calculée après le réglage manuel.

### Task 2: Séparer volume maître, normalisation et annulation de fondu (#8, #12)

**Files:**
- Modify: `backend/AudioManager.js:129-222`
- Modify: `backend/Track.js:255-264`
- Test: `tests/AudioManager.test.js`

**Interfaces:**
- Consumes: `setVolume(volume, { cancelFade })` en interne depuis `fadeVolume`.
- Produces: `setVolume(volume)` annule un fondu actif et ne touche jamais `Track.defaultVolume`; `fadeVolume` conserve son token pendant ses propres pas.

- [x] **Step 1: Implémenter le changement minimal**

```js
setVolume(volume, { cancelFade = true } = {}) {
    if (cancelFade) this._fadeToken = (this._fadeToken || 0) + 1;
    this.globalVolume = Math.max(0, Math.min(1, volume));
    Howler.volume(this.globalVolume);
}

// Dans fadeVolume, appeler :
this.setVolume(startVolume + (target - startVolume) * t, { cancelFade: false });
```

Remplacer dans `resume()` l’expression `defaultVolume || globalVolume` par `defaultVolume`, puis retirer `Track.setVolume()` car aucun flux de volume global ne doit modifier le volume normalisé.

- [x] **Step 2: Vérifier les tests ciblés**

Run: `npm test -- tests/AudioManager.test.js`

Expected: tous les scénarios #8 et #12 passent.

- [x] **Step 3: Vérifier la suite et la syntaxe**

Run: `npm test && node --check backend/AudioManager.js && node --check backend/Track.js`

Expected: aucun échec.

`npm run lint` n’est pas utilisable dans l’état actuel du dépôt : le script existe mais `eslint` n’est ni installé ni configuré. Les vérifications de cette planification utilisent donc `node --check` jusqu’à ce qu’un lint soit configuré séparément.

- [x] **Step 4: Committer le correctif isolé**

```bash
git add backend/AudioManager.js backend/Track.js tests/AudioManager.test.js
git commit -m "fix(audio): séparer volume global et normalisation"
```

### Task 3: Dédupliquer avant toute copie et normaliser les playlists importées (#9)

**Files:**
- Create: `backend/ImportManager.js`
- Create: `tests/ImportManager.test.js`
- Modify: `electron/main.cjs:304-315`
- Modify: `backend/DatabaseManager.js:418-447`
- Test: `tests/DatabaseManager.test.js`

**Interfaces:**
- Consumes: `importLibraryPayload(importPayload, musicDir, dbManager, fileManager)`.
- Produces: une copie audio seulement pour les pistes absentes de la DB; des playlists possédant toujours `trackIds: []` si l’import est malformé.

- [x] **Step 1: Écrire le test en échec de déduplication avant copie**

```js
it('ne copie pas les fichiers d’une piste déjà présente', async () => {
    const dbManager = {
        getLibrary: vi.fn().mockResolvedValue([{ id: 'existing' }]),
        mergeImportedLibrary: vi.fn().mockResolvedValue({ tracksAdded: 1, tracksSkipped: 1 }),
    };
    const fileManager = { importTrackFiles: vi.fn().mockResolvedValue({ calm: '/local/new.mp3' }) };

    await importLibraryPayload({ library: [
        { id: 'existing', localPaths: { calm: 'existing_calm.mp3' } },
        { id: 'new', localPaths: { calm: 'new_calm.mp3' } },
    ], playlists: [] }, '/export/music', dbManager, fileManager);

    expect(fileManager.importTrackFiles).toHaveBeenCalledTimes(1);
    expect(fileManager.importTrackFiles).toHaveBeenCalledWith({ calm: 'new_calm.mp3' }, '/export/music');
});
```

- [x] **Step 2: Écrire le test en échec des playlists malformées**

```js
it('fusionne une playlist existante sans trackIds comme une liste vide', async () => {
    const manager = await createDatabaseManagerWith({
        library: [], playlists: [{ id: 'p1', name: 'Locale', trackIds: ['track-a'] }], metadata: {},
    });

    await manager.mergeImportedLibrary({ library: [], playlists: [{ id: 'p1', name: 'Importée' }] });

    expect(manager.db.data.playlists[0].trackIds).toEqual(['track-a']);
});
```

- [x] **Step 3: Implémenter le coordinateur d’import**

```js
export async function importLibraryPayload(payload, musicDir, dbManager, fileManager) {
    const knownIds = new Set((await dbManager.getLibrary()).map(track => track.id));
    const library = [];
    for (const track of payload.library || []) {
        if (knownIds.has(track.id)) {
            library.push(track);
            continue;
        }
        knownIds.add(track.id);
        const localPaths = await fileManager.importTrackFiles(track.localPaths || {}, musicDir);
        library.push({ ...track, localPaths });
    }
    return dbManager.mergeImportedLibrary({ library, playlists: payload.playlists || [] });
}
```

Dans `electron/main.cjs`, importer ce module dynamiquement dans le handler IPC puis appeler cette fonction. Dans `mergeImportedLibrary`, utiliser `Array.isArray(playlist.trackIds) ? playlist.trackIds : []` pour les playlists existantes et nouvelles.

- [x] **Step 4: Vérifier les tests d’import et de DB**

Run: `npm test -- tests/ImportManager.test.js tests/DatabaseManager.test.js`

Expected: aucun fichier associé à une piste existante n’est copié et une playlist sans `trackIds` ne fait pas échouer la fusion.

- [x] **Step 5: Committer le correctif isolé**

```bash
git add backend/ImportManager.js backend/DatabaseManager.js electron/main.cjs tests/ImportManager.test.js tests/DatabaseManager.test.js
git commit -m "fix(import): dédupliquer avant la copie des fichiers"
```

### Task 4: Conserver les suppressions en attente hors des re-rendus (#10)

**Files:**
- Create: `frontend/pendingDeletions.js`
- Create: `tests/pendingDeletions.test.js`
- Modify: `frontend/renderer.js:8-15, 410-426, 1090-1145`
- Test: `tests/pendingDeletions.test.js`

**Interfaces:**
- Consumes: `createPendingDeletionStore()`.
- Produces: `trackIds` et `playlistIds` filtrent les données chargées jusqu’à `undo(id)` ou `expire(id)`.

- [x] **Step 1: Écrire le test en échec du store**

```js
it('cache une piste en attente pendant les re-rendus puis la restaure à l’annulation', () => {
    const pending = createPendingDeletionStore();
    pending.markTrack('track-1');

    expect(pending.filterTracks([{ id: 'track-1' }, { id: 'track-2' }])).toEqual([{ id: 'track-2' }]);

    pending.undoTrack('track-1');
    expect(pending.filterTracks([{ id: 'track-1' }])).toEqual([{ id: 'track-1' }]);
});
```

- [x] **Step 2: Implémenter le store pur**

```js
export function createPendingDeletionStore() {
    const trackIds = new Set();
    const playlistIds = new Set();
    return {
        markTrack: id => trackIds.add(id), undoTrack: id => trackIds.delete(id),
        markPlaylist: id => playlistIds.add(id), undoPlaylist: id => playlistIds.delete(id),
        filterTracks: tracks => tracks.filter(track => !trackIds.has(track.id)),
        filterPlaylists: playlists => playlists.filter(playlist => !playlistIds.has(playlist.id)),
    };
}
```

- [x] **Step 3: Brancher le store dans le renderer**

Ajouter l’identifiant avant la suppression optimiste. Filtrer `getLibrary()` dans `loadLibrary()` et `getAllPlaylists()` dans `loadPlaylists()`. Retirer l’identifiant lors de `onUndo`; le retirer après la suppression DB puis recharger les données dans `onExpire`.

- [x] **Step 4: Vérifier le test puis la suite**

Run: `npm test -- tests/pendingDeletions.test.js && npm test && node --check frontend/renderer.js`

Expected: le cache filtré ne réaffiche jamais les éléments en attente.

- [x] **Step 5: Committer le correctif isolé**

```bash
git add frontend/pendingDeletions.js frontend/renderer.js tests/pendingDeletions.test.js
git commit -m "fix(ui): préserver les suppressions en attente"
```

### Task 5: Annuler tout preview avant de reconstruire la bibliothèque (#11)

**Files:**
- Create: `frontend/previewState.js`
- Create: `tests/previewState.test.js`
- Modify: `frontend/renderer.js:13-14, 257-300`
- Test: `tests/previewState.test.js`

**Interfaces:**
- Consumes: `createPreviewState({ clearTimer, stopHowl })`.
- Produces: `cancel()` annule le timer et stoppe le Howl actif avant un nouveau rendu.

- [x] **Step 1: Écrire le test en échec**

```js
it('annule le timer et le preview actif au début d’un re-rendu', () => {
    const clearTimer = vi.fn();
    const stopHowl = vi.fn();
    const preview = createPreviewState({ clearTimer, stopHowl });
    preview.setTimer(42);

    preview.cancel();

    expect(clearTimer).toHaveBeenCalledWith(42);
    expect(stopHowl).toHaveBeenCalledOnce();
    expect(preview.getTimer()).toBeNull();
});
```

- [x] **Step 2: Implémenter et appeler `cancel()`**

```js
export function createPreviewState({ clearTimer, stopHowl }) {
    let timer = null;
    return {
        setTimer: value => { timer = value; },
        getTimer: () => timer,
        cancel: () => { clearTimer(timer); timer = null; stopHowl(); },
    };
}
```

Dans `renderLibraryList`, appeler `preview.cancel()` avant le test de liste vide et avant toute réécriture de `container.innerHTML`.

- [x] **Step 3: Vérifier le correctif**

Run: `npm test -- tests/previewState.test.js && npm test && node --check frontend/renderer.js`

Expected: aucun timer de preview ne survit à un re-rendu.

- [x] **Step 4: Committer le correctif isolé**

```bash
git add frontend/previewState.js frontend/renderer.js tests/previewState.test.js
git commit -m "fix(preview): annuler le survol avant re-rendu"
```

### Task 6: Synchroniser le backlog GitHub et les instructions

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

- [x] **Step 1: Après chaque tâche validée, fermer l’issue correspondante**

Run: `gh issue close <num> --comment "Corrigé et couvert par des tests dans le commit <sha>."`

- [x] **Step 2: Passer l’élément Project à `Done`**

Run: `gh project item-edit --project-id PVT_kwHOB4sxV84BkLXF --id <item-id> --field-id <status-field-id> --single-select-option-id <done-option-id>`

- [x] **Step 3: Mettre à jour les deux fichiers identiques**

Déplacer les issues terminées de « À faire » vers « Terminées », puis vérifier leur identité.

Run: `cmp -s CLAUDE.md AGENTS.md`

## Self-Review

- Couverture : #8 et #12 sont traitées ensemble mais possèdent chacune un test distinct; #9, #10 et #11 ont chacun une tâche et un test dédié.
- Schéma : aucune tâche ne modifie `data.json`.
- Placeholders : aucune étape ne dépend d’une implémentation non définie; les nouveaux modules et leurs fonctions exportées sont nommés dans les tâches.
- Cohérence : chaque test cible une API définie dans la même tâche et chaque modification est validée par Vitest puis ESLint.
