# Onglet Découpage (#24) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer, depuis un nouvel onglet « Découpage », une musique à plusieurs versions à partir d'un seul fichier audio découpé manuellement (waveform zoomable + marqueurs), et pouvoir retoucher cette découpe.

**Architecture:** Une version découpée = une entrée `segments[version] = { start, end }` (secondes) sur la piste, toutes les versions découpées pointant sur le même fichier copié une fois. À la lecture, chaque version garde son propre Howl, avec un sprite `segment` (approche A de la spec). L'onglet est un contrôleur vanilla JS (`cutterView.js`) appuyé sur deux modules purs testés (`segmentModel.js`, `waveform.js`) ; le backend gagne un module pur `segments.js` partagé par `DatabaseManager` et `electron/main.cjs`.

**Tech Stack:** Electron (main CJS, preload), ESM vanilla JS, Howler.js 2.2.4 (html5 + sprites), Web Audio (`OfflineAudioContext` pour la waveform), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-decoupage-design.md`

## Global Constraints

- ESM partout sauf `electron/*.cjs` ; pas de framework frontend ; aucune nouvelle dépendance npm.
- Schéma DB : ajout additif uniquement (`segments` optionnel, toujours lu via `track.segments || {}`) ; aucune migration.
- Le fichier source n'est jamais modifié ; il est copié une seule fois sous `music/<trackId>_source<ext>`.
- Durée minimale d'un segment / écart minimal entre deux points de coupe : **0,5 s**. Précision des points de coupe : **0,1 s**.
- Zoom maximal : **4 s** visibles. Waveform décodée en **mono 8 kHz**, **100 pics par seconde**.
- Toute chaîne d'UI passe par `backend/i18n.js` (fr + en, parité testée par `tests/i18n.test.js`) ; jamais d'`alert()` dans l'onglet.
- Couleurs de l'onglet et de la waveform : uniquement via les variables CSS du thème (`--ink-*`, `--gold-*`, `--bone*`, `--red-fire`).
- Texte saisi par l'utilisateur (titres, noms de segment) : jamais interpolé brut dans `innerHTML`.
- Howler : **toujours `seek(position, id)` après `play()`**, jamais avant. `stop()` puis `play()` recycle le son via `reset()`, qui remet la position à 0 ; un seek fait avant `play()` est perdu (cf. `node_modules/howler/dist/howler.js`, `_inactiveSound` / `reset`).
- Howler : ne jamais appeler `howl.seek(undefined)` ni `howl.seek(idPérimé)` en lecture (un nombre qui n'est pas un id de son est interprété comme une position) ; getter = `howl.seek()` sans argument.
- `CLAUDE.md` et `AGENTS.md` restent strictement identiques.
- Chaque commit se termine par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests : `npm test` (= `vitest run --root .`). Build : `npx vite build`.

## Review Focus

1. **Fichier d'ambiance très long (≥ 1 h)** — l'onglet doit rester utilisable (décodage 8 kHz mono, pics bornés à 100/s). Test : `decodeForWaveform` demande bien un contexte à 8 000 Hz et mixe les canaux (Task 6).
2. **Durée décodée ≠ bornes stockées** (MP3 VBR, fichier remplacé) — rouvrir une découpe dont un segment dépasse la durée ne doit ni planter ni créer de marqueur hors fichier. Test : `stateFromTrack` borne les coupes à `]0, durée[` (Task 5).
3. **Noms quasi identiques** (« Combat » / « combat  ») — l'utilisateur les voit comme le même nom ; doivent être refusés. Test : `validateSplit` compare après trim, sans casse (Task 5).
4. **Retouche d'une piste qui contient aussi une version « fichier entier »** — renommer un segment avec le nom de cette version doit être refusé, pas écraser la version. Tests : `validateSplit` avec `reservedNames` (Task 5) et `applySegmentUpdate` qui lève une erreur (Task 1).
5. **Suppression (avec annulation) d'une piste découpée ou d'une de ses versions** — le fichier partagé n'est supprimé qu'une fois, et seulement quand plus aucune version ne l'utilise. Tests : `isPathSharedByOtherVersion` / `uniquePaths` (Task 1), `deleteTrackFiles` dédoublonné (Task 4).

---

## File Structure

| Fichier | Statut | Responsabilité |
|---|---|---|
| `backend/segments.js` | Create | Pur : signature de piste, nettoyage des `segments`, construction d'une piste découpée, application d'une retouche, fichier partagé |
| `backend/Track.js` | Modify | Sprites, ids de son, temps relatifs au segment, seek après play |
| `backend/AudioManager.js` | Modify | `segments` dans la config, reconstruction sur signature changée (#32), réordonnancement sans rechargement |
| `backend/DatabaseManager.js` | Modify | Nettoyage `segments` à l'ajout/import, retrait de segment avec la version, `updateSegments` |
| `backend/FileManager.js` | Modify | Suppression et export dédoublonnés par chemin |
| `electron/main.cjs` | Modify | IPC `audio:readFile`, `library:addSegmentedTrack`, `library:updateSegments` ; `removeVersion` respecte le fichier partagé |
| `electron/preload.cjs` | Modify | Expose les 3 nouveaux appels |
| `frontend/segmentModel.js` | Create | Pur : coupes ↔ plages, contraintes, noms, validation, reconstruction, plan de retouche, format `m:ss.d` |
| `frontend/waveform.js` | Create | Pics, décodage 8 kHz, vue (zoom/défilement), conversions temps ↔ x, dessin canvas |
| `frontend/cutterView.js` | Create | Contrôleur DOM de l'onglet |
| `frontend/renderer.js` | Modify | Branchement onglet, bouton ✂, `segments` dans la config, rechargements |
| `frontend/index.html` | Modify | Vue `#decoupage-view` à la place de `#effets-view`, onglet |
| `frontend/styles.css` | Modify | Styles `.split-*` |
| `backend/i18n.js` | Modify | Clés `nav.split`, `split.*`, `library.splitTrack` ; retrait `nav.effects`, `effects.*` |
| `tests/segments.test.js`, `tests/segmentModel.test.js`, `tests/waveform.test.js`, `tests/FileManager.test.js` | Create | Tests des nouveaux modules |
| `tests/Track.test.js`, `tests/AudioManager.test.js`, `tests/DatabaseManager.test.js` | Modify | Tests sprites, #32, DB |

---

### Task 1: Module pur `backend/segments.js`

**Files:**
- Create: `backend/segments.js`
- Test: `tests/segments.test.js`

**Interfaces:**
- Produces:
  - `SOURCE_VERSION_KEY: 'source'`
  - `trackSignature(versions: object, segments?: object): string`
  - `orderedSegmentNames(segments?: object): string[]` (triés par `start`)
  - `sanitizeSegments(segments: any, localPaths?: object): object | undefined`
  - `isPathSharedByOtherVersion(track: object, versionName: string): boolean`
  - `uniquePaths(localPaths?: object): string[]`
  - `buildSegmentedTrack({ trackId, title, sourcePath, localPath, segments, selectedPlaylists?, now? }): object`
  - `applySegmentUpdate(track: object, segments: object, defaultVersion?: string): object` (modifie et renvoie `track`)

- [ ] **Step 1: Write the failing test**

```js
// tests/segments.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root . tests/segments.test.js`
Expected: FAIL — `Failed to load url ../backend/segments.js`

- [ ] **Step 3: Write minimal implementation**

```js
// backend/segments.js
/**
 * Pistes découpées (#24) : `segments = { versionName: { start, end } }` en
 * secondes, toutes les versions découpées pointant sur le même fichier copié
 * une fois (`<trackId>_source<ext>`). Module pur, partagé par DatabaseManager
 * et electron/main.cjs (import dynamique).
 */

export const SOURCE_VERSION_KEY = 'source';

/**
 * Signature insensible à l'ordre des versions : sert à savoir si une piste
 * déjà chargée par AudioManager doit être reconstruite (#32).
 */
export function trackSignature(versions = {}, segments = {}) {
    return JSON.stringify(
        Object.keys(versions || {}).sort().map(name => [name, versions[name], segments?.[name] ?? null]),
    );
}

export function orderedSegmentNames(segments = {}) {
    return Object.keys(segments || {}).sort((a, b) => segments[a].start - segments[b].start);
}

/**
 * Garde uniquement les segments valides (bornes numériques, 0 <= start < end)
 * de versions existantes. Undefined s'il ne reste rien.
 */
export function sanitizeSegments(segments, localPaths = {}) {
    if (!segments || typeof segments !== 'object') return undefined;

    const clean = {};
    for (const [name, segment] of Object.entries(segments)) {
        if (!segment || !Object.hasOwn(localPaths || {}, name)) continue;
        const start = Number(segment.start);
        const end = Number(segment.end);
        if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) {
            clean[name] = { start, end };
        }
    }
    return Object.keys(clean).length > 0 ? clean : undefined;
}

/** Le fichier de cette version est-il encore utilisé par une autre version ? */
export function isPathSharedByOtherVersion(track, versionName) {
    const paths = track?.localPaths || {};
    const target = paths[versionName];
    return Boolean(target) && Object.entries(paths).some(([name, p]) => name !== versionName && p === target);
}

export function uniquePaths(localPaths = {}) {
    return [...new Set(Object.values(localPaths || {}).filter(Boolean))];
}

export function buildSegmentedTrack({
    trackId, title, sourcePath, localPath, segments, selectedPlaylists = [], now = new Date(),
}) {
    const names = orderedSegmentNames(segments);
    if (names.length === 0) throw new Error('Aucun segment nommé');

    const timestamp = now.toISOString();
    return {
        id: trackId,
        title,
        originalPaths: Object.fromEntries(names.map(name => [name, sourcePath])),
        localPaths: Object.fromEntries(names.map(name => [name, localPath])),
        segments: Object.fromEntries(names.map(name => [name, { start: segments[name].start, end: segments[name].end }])),
        defaultVersion: names[0],
        defaultVolume: 0.5,
        metadata: { addedAt: timestamp, modifiedAt: timestamp },
        inPlaylists: selectedPlaylists,
    };
}

/**
 * Retouche d'une découpe : remplace les versions découpées par `segments`
 * (même fichier partagé), garde les versions « fichier entier » après elles.
 */
export function applySegmentUpdate(track, segments, defaultVersion) {
    const oldSegmented = Object.keys(track.segments || {});
    if (oldSegmented.length === 0) throw new Error(`La piste ${track.id} n'est pas découpée`);

    const oldLocal = track.localPaths || {};
    const oldOriginal = track.originalPaths || {};
    const sharedLocal = oldLocal[oldSegmented[0]];
    const sharedOriginal = oldOriginal[oldSegmented[0]] ?? sharedLocal;
    const fullFileNames = Object.keys(oldLocal).filter(name => !oldSegmented.includes(name));

    const names = orderedSegmentNames(segments);
    if (names.length === 0) throw new Error('Aucun segment nommé');
    const clash = names.find(name => fullFileNames.includes(name));
    if (clash) throw new Error(`Nom de version déjà utilisé : ${clash}`);

    track.localPaths = {
        ...Object.fromEntries(names.map(name => [name, sharedLocal])),
        ...Object.fromEntries(fullFileNames.map(name => [name, oldLocal[name]])),
    };
    track.originalPaths = {
        ...Object.fromEntries(names.map(name => [name, sharedOriginal])),
        ...Object.fromEntries(fullFileNames.map(name => [name, oldOriginal[name] ?? oldLocal[name]])),
    };
    track.segments = Object.fromEntries(
        names.map(name => [name, { start: segments[name].start, end: segments[name].end }]),
    );

    const allNames = Object.keys(track.localPaths);
    if (allNames.includes(defaultVersion)) {
        track.defaultVersion = defaultVersion;
    } else if (!allNames.includes(track.defaultVersion)) {
        track.defaultVersion = allNames[0];
    }
    return track;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root . tests/segments.test.js`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/segments.js tests/segments.test.js
git commit -m "feat(segments): module pur des pistes découpées (#24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `Track` — sprites, reprise par id, seek après play

**Files:**
- Modify: `backend/Track.js`
- Test: `tests/Track.test.js`

**Interfaces:**
- Consumes: `trackSignature(versions, segments)` (Task 1)
- Produces:
  - `new Track(id, name, versionPaths, segments = {})` ; propriétés `segments`, `signature`
  - `track.reorderVersions(names: string[]): void`
  - `getCurrentTime()` / `getDuration()` relatifs au segment ; `seek(position)` relatif
  - Constante de module `SPRITE_NAME = 'segment'` (non exportée)

- [ ] **Step 1: Rendre le FakeHowl fidèle à Howler (recyclage des sons, sprites, ids)**

Dans `tests/Track.test.js`, remplacer la classe `FakeHowl` du bloc `vi.hoisted` par :

```js
    class FakeHowl {
        constructor(opts) {
            this.opts = opts;
            this._loop = !!opts.loop;
            this._state = 'loaded';
            this._playing = false;
            this._paused = false;
            this._seek = 0;
            this._volume = opts.volume;
            this._sprite = opts.sprite || {};
            this._nextId = 0;
            this._soundId = null;
            this.listeners = {};
            this.playCount = 0;
            this.lastPlayArg = undefined;
            instances.push(this);
        }
        state() { return this._state; }
        load() { this._state = 'loading'; }
        finishLoading() {
            this._state = 'loaded';
            const listeners = this.listeners.load || [];
            this.listeners.load = [];
            listeners.forEach(fn => fn());
        }
        once(event, fn) { (this.listeners[event] ||= []).push(fn); }
        off(event, fn) {
            this.listeners[event] = (this.listeners[event] || []).filter(l => l !== fn);
        }
        play(arg) {
            this.playCount++;
            this.lastPlayArg = arg;
            if (typeof arg === 'number' && arg === this._soundId && this._paused) {
                this._paused = false;
                this._playing = true;
                return arg;
            }
            // Comme Howler : un nouveau son (ou un son recyclé via reset()) repart
            // du début de son sprite — un seek fait avant play() est perdu.
            this._soundId = ++this._nextId;
            const sprite = typeof arg === 'string' ? this._sprite[arg] : null;
            this._seek = sprite ? sprite[0] / 1000 : 0;
            this._paused = false;
            this._playing = true;
            return this._soundId;
        }
        pause() {
            if (this._playing) { this._playing = false; this._paused = true; }
        }
        stop() { this._playing = false; this._paused = false; this._soundId = null; this._seek = 0; }
        playing() { return this._playing; }
        loop(value) {
            if (value === undefined) return this._loop;
            this._loop = value;
            return this;
        }
        volume(value) {
            if (value === undefined) return this._volume;
            this._volume = value;
            return this;
        }
        fade(from, to) { this._volume = to; }
        seek(value) {
            if (typeof value === 'number') { this._seek = value; return this; }
            return this._seek;
        }
        duration() { return 180; }
    }
```

Mettre aussi à jour le commentaire du test de migration existant (`// FakeHowl : 100 s → 3 % = 3 s`) : avec `duration() = 180`, 3 % = 5,4 s → borné à 5 s. Remplacer ses attentes `toBe(3)` / `toHaveBeenCalledWith(3)` par `toBe(5)` / `toHaveBeenCalledWith(5)` et le commentaire par `// FakeHowl : 180 s → 3 % = 5,4 s, plafonné à 5 s`.

- [ ] **Step 2: Ajouter les tests (fichier entier + sprites)**

À la fin de `tests/Track.test.js` :

```js
function createSplitTrack() {
    const track = new Track('t2', 'Découpée', { calm: 'src.mp3', combat: 'src.mp3' }, {
        calm: { start: 0, end: 90 },
        combat: { start: 90, end: 180 },
    });
    track.loadVersions();
    return track;
}

describe('Track — position lors d\'un changement de version (seek après play)', () => {
    it('fondu entre versions fichier entier : la cible reprend au même timecode', () => {
        const track = createTrack();
        track.play('calm');
        track.versions.calm.seek(40);

        track.crossfade('combat', 1);

        expect(track.versions.combat.seek()).toBe(40);
    });
});

describe('Track — versions découpées (#24)', () => {
    it('déclare un sprite par version découpée', () => {
        const track = createSplitTrack();
        expect(track.versions.combat.opts.sprite).toEqual({ segment: [90000, 90000] });
    });

    it('joue le sprite du segment, temps et durée relatifs au segment', () => {
        const track = createSplitTrack();

        track.play('combat');

        expect(track.versions.combat.lastPlayArg).toBe('segment');
        expect(track.getCurrentTime()).toBe(0);
        expect(track.getDuration()).toBe(90);
    });

    it('fondu vers une version découpée : démarre au début de son segment', () => {
        const track = createSplitTrack();
        track.play('calm');
        track.versions.calm.seek(40);

        track.crossfade('combat', 1);
        vi.runAllTimers();

        expect(track.versions.combat.lastPlayArg).toBe('segment');
        expect(track.versions.combat.seek()).toBe(90);
        expect(track.getCurrentTime()).toBe(0);
    });

    it('reprise après pause : reprend le son en pause, pas le début du segment', () => {
        const track = createSplitTrack();
        track.play('combat');
        track.versions.combat.seek(120);

        track.pause();
        track.resume();

        expect(typeof track.versions.combat.lastPlayArg).toBe('number');
        expect(track.getCurrentTime()).toBe(30);
    });

    it('seek relatif au segment', () => {
        const track = createSplitTrack();
        track.play('combat');

        track.seek(10);

        expect(track.versions.combat.seek()).toBe(100);
        expect(track.getCurrentTime()).toBe(10);
    });

    it('changer de version en pause vers un segment : reprise au début du segment', () => {
        const track = createSplitTrack();
        track.play('calm');
        track.versions.calm.seek(40);
        track.pause();

        track.switchVersionWhilePaused('combat');
        expect(track.getCurrentTime()).toBe(0);

        track.resume();
        expect(track.versions.combat.seek()).toBe(90);
    });

    it('fin du segment actif → piste suivante', () => {
        const track = createSplitTrack();
        track.onEndCallback = vi.fn();
        track.play('combat');

        track.versions.combat.opts.onend();

        expect(track.onEndCallback).toHaveBeenCalledOnce();
    });

    it('migration du fondu : utilise la durée du segment, pas celle du fichier', () => {
        const track = createSplitTrack();
        track.legacyCrossfadePercent = 0.05;

        track.versions.calm.opts.onload(); // 5 % de 90 s = 4,5 s

        expect(track.crossfadeDurationSeconds).toBe(4.5);
    });

    it('réordonne ses versions sans recréer les Howl', () => {
        const track = createSplitTrack();
        const combat = track.versions.combat;

        track.reorderVersions(['combat', 'calm']);

        expect(Object.keys(track.versions)).toEqual(['combat', 'calm']);
        expect(track.versions.combat).toBe(combat);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run --root . tests/Track.test.js`
Expected: FAIL — entre autres « fondu entre versions fichier entier : la cible reprend au même timecode » (`expected 0 to be 40` : le seek fait avant `play()` est perdu, bug réel de Howler reproduit par le FakeHowl), « changer de version en pause : la reprise joue la nouvelle version à la même position » (même cause), et tous les tests `versions découpées` (sprite absent, `reorderVersions is not a function`).

- [ ] **Step 4: Implement**

Dans `backend/Track.js` :

a) Import et constante, en tête de fichier (après l'import de `crossfadeDuration.js`) :

```js
import { trackSignature } from './segments.js';

// Nom du sprite Howler d'une version découpée (#24)
const SPRITE_NAME = 'segment';
```

b) Constructeur : signature et nouveaux champs.

```js
    /**
     * @param {string} id - Identifiant unique de la piste
     * @param {string} name - Nom d'affichage de la piste
     * @param {Object} versionPaths - Chemins des différentes versions { calm: 'path.mp3', combat: 'path.mp3' }
     * @param {Object} [segments] - Versions découpées (#24) : { combat: { start, end } } en secondes
     */
    constructor(id, name, versionPaths, segments = {}) {
        this.id = id;
        this.name = name;
        this.versionPaths = versionPaths;
        this.segments = segments || {};
        // Permet à AudioManager de savoir si la piste doit être reconstruite (#32)
        this.signature = trackSignature(versionPaths, this.segments);
```

et, à la fin du constructeur (après `this._resumeSeek = null;`) :

```js
        // Id du dernier son lancé par version : la reprise se fait par id, jamais par
        // play(sprite) qui repartirait du début du segment
        this._soundIds = {};
        // Version mise en pause (son reprenable par son id)
        this._pausedVersion = null;
```

c) Nouveaux helpers, juste après le getter `isCrossfading` :

```js
    _segmentOf(versionName) {
        return this.segments[versionName] || null;
    }

    /** Durée jouée d'une version : son segment, sinon le fichier entier */
    _versionDuration(versionName) {
        const segment = this._segmentOf(versionName);
        if (segment) return segment.end - segment.start;
        const howl = this.versions[versionName];
        return howl ? howl.duration() || 0 : 0;
    }

    /** Position relative au segment → position absolue dans le fichier */
    _toAbsolute(versionName, position) {
        const segment = this._segmentOf(versionName);
        return segment ? segment.start + position : position;
    }

    /** Lance un nouveau son (le sprite du segment pour une version découpée) */
    _startSound(versionName) {
        const howl = this.versions[versionName];
        const id = howl.play(this._segmentOf(versionName) ? SPRITE_NAME : undefined);
        this._soundIds[versionName] = id;
        return id;
    }

    /**
     * Réordonne les versions sans recréer les Howl (simple réordonnancement
     * dans la modal d'édition : ne doit pas couper la lecture).
     */
    reorderVersions(names) {
        const known = names.filter(name => Object.hasOwn(this.versions, name));
        this.versionPaths = Object.fromEntries(known.map(name => [name, this.versionPaths[name]]));
        this.versions = Object.fromEntries(known.map(name => [name, this.versions[name]]));
    }
```

d) `loadVersions()` : ajouter le sprite et utiliser la durée de la version pour la migration. Remplacer le `new Howl({ ... })` par :

```js
            const segment = this._segmentOf(versionName);

            this.versions[versionName] = new Howl({
                src: [path],
                html5: true, // Use HTML5 Audio for file:// URLs
                loop: this.loop, // false par défaut pour permettre la progression de playlist
                volume: 0,
                preload: false, // Chargement à la première lecture, pas au démarrage
                // Version découpée (#24) : ne lire que son segment du fichier partagé
                ...(segment ? { sprite: { [SPRITE_NAME]: [segment.start * 1000, (segment.end - segment.start) * 1000] } } : {}),
                onload: () => {
                    console.log(`✅ Version "${versionName}" de "${this.name}" chargée`);
                    this._migrateLegacyCrossfade(this._versionDuration(versionName));
                },
```
(le reste des callbacks `onloaderror`, `onplay`, `onend` est inchangé).

e) `getCrossfadeDurationMs()` : dans la branche `legacyCrossfadePercent`, remplacer

```js
            const howl = this.currentVersion && this.versions[this.currentVersion];
            return legacyPercentToSeconds(this.legacyCrossfadePercent, howl ? howl.duration() : undefined) * 1000;
```
par
```js
            const duration = this.currentVersion ? this._versionDuration(this.currentVersion) : undefined;
            return legacyPercentToSeconds(this.legacyCrossfadePercent, duration) * 1000;
```

f) `crossfade()` → dans `startToVersion`, remplacer les étapes 4 et 5 :

```js
            // 4. Configurer la nouvelle version
            toVersionHowl.stop(); // Arrêter complètement si elle jouait
            toVersionHowl.volume(0); // Force le volume à 0
            toVersionHowl.seek(currentSeek);

            // 5. Lancer la nouvelle version
            const playId = toVersionHowl.play();
```
par
```js
            // 4. Configurer puis lancer la nouvelle version
            toVersionHowl.stop(); // Arrêter complètement si elle jouait
            toVersionHowl.volume(0); // Force le volume à 0
            const playId = this._startSound(toVersion);

            // 5. Position : une cible découpée démarre au début de son segment (#24), une
            // cible « fichier entier » au même timecode. Toujours APRÈS play() : stop() puis
            // play() recycle le son (reset) et perd un seek fait avant.
            if (!this._segmentOf(toVersion)) {
                toVersionHowl.seek(currentSeek, playId);
            }
```

et, dans la branche d'échec (la nouvelle version ne joue pas), remplacer

```js
                    if (!fromVersion.playing()) {
                        fromVersion.play();
                    }
```
par
```js
                    if (!fromVersion.playing()) {
                        this._startSound(cf.fromVersion);
                    }
```

g) `_finishCrossfade()` : dans la branche `else` (cible pas encore démarrée), remplacer `this._resumeSeek = cf.currentSeek;` par :

```js
            this._resumeSeek = this._segmentOf(cf.toVersion) ? 0 : cf.currentSeek;
```

h) Remplacer `_playCurrent()` entièrement :

```js
    /**
     * Lance currentVersion à plein volume : reprend le son en pause s'il y en a
     * un (par son id), sinon lance un nouveau son ; puis applique la position
     * mémorisée (toujours après play(), cf. crossfade).
     */
    _playCurrent() {
        const versionName = this.currentVersion;
        const howl = this.versions[versionName];
        howl.volume(this.defaultVolume);

        const resumeSeek = this._resumeSeek;
        this._resumeSeek = null;

        let id;
        if (this._pausedVersion === versionName && this._soundIds[versionName] !== undefined) {
            id = this._soundIds[versionName];
            howl.play(id);
        } else {
            id = this._startSound(versionName);
        }
        this._pausedVersion = null;

        if (resumeSeek !== null) {
            howl.seek(this._toAbsolute(versionName, resumeSeek), id);
        }
    }
```

i) `pause()` : remplacer

```js
        if (!this._cancelPendingStart()) {
            this.versions[this.currentVersion].pause();
        }
```
par
```js
        if (!this._cancelPendingStart()) {
            this.versions[this.currentVersion].pause();
            this._pausedVersion = this.currentVersion;
        }
```

j) `switchVersionWhilePaused()` : remplacer `this._resumeSeek = position;` par

```js
        // Cible découpée : début de son segment (#24) ; sinon même position
        this._resumeSeek = this._segmentOf(toVersion) ? 0 : position;
```

k) `seek()` : remplacer `this.versions[this.currentVersion].seek(position);` par

```js
            this.versions[this.currentVersion].seek(this._toAbsolute(this.currentVersion, position));
```

l) `stopAllVersions()` : ajouter `this._pausedVersion = null;` à la fin de la méthode.

m) Remplacer `getCurrentTime()` et `getDuration()` :

```js
    /**
     * Position de lecture, relative au segment pour une version découpée
     * @returns {number} Position en secondes
     */
    getCurrentTime() {
        if (this._resumeSeek !== null) return this._resumeSeek;
        const howl = this.currentVersion && this.versions[this.currentVersion];
        if (!howl) return 0;
        // Getter sans argument : un id périmé serait pris pour une position.
        // Howler renvoie le Howl lui-même (et non un nombre) tant qu'il n'est pas chargé.
        const seek = howl.seek();
        if (typeof seek !== 'number') return 0;
        const segment = this._segmentOf(this.currentVersion);
        return segment ? Math.max(0, seek - segment.start) : seek;
    }

    /**
     * Durée jouée (celle du segment pour une version découpée)
     * @returns {number} Durée en secondes
     */
    getDuration() {
        return this.currentVersion ? this._versionDuration(this.currentVersion) : 0;
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (tous les fichiers ; `Track.test.js` inclut les 10 nouveaux tests)

- [ ] **Step 6: Commit**

```bash
git add backend/Track.js tests/Track.test.js
git commit -m "feat(track): lecture des versions découpées par sprite (#24)

Reprise par id de son, temps/durée/seek relatifs au segment. Corrige au
passage la position perdue lors d'un changement de version : Howler
recycle le son à stop()+play() (reset → position 0), le seek doit donc
venir après play().

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `AudioManager` — segments et reconstruction sur changement (#32)

**Files:**
- Modify: `backend/AudioManager.js`
- Test: `tests/AudioManager.test.js`

**Interfaces:**
- Consumes: `new Track(id, name, versionPaths, segments)`, `track.signature`, `track.reorderVersions(names)` (Task 2) ; `trackSignature` (Task 1)
- Produces: `loadTrack(trackId, name, versionPaths, segments?)` ; la config de `loadPlaylist` accepte `segments`

- [ ] **Step 1: Write the failing tests**

Ajouter à la fin de `tests/AudioManager.test.js` :

```js
describe('AudioManager — versions modifiées dans la playlist active (#32)', () => {
    const base = [
        { id: 't1', title: 'Track 1', versions: { calm: 'a.mp3', combat: 'b.mp3' } },
        { id: 't2', title: 'Track 2', versions: { calm: 'c.mp3' } },
    ];

    it('transmet les segments à la piste', () => {
        const manager = new AudioManager();
        manager.loadPlaylist([{ id: 't1', title: 'T', versions: { calm: 's.mp3' }, segments: { calm: { start: 0, end: 10 } } }]);

        expect(manager.getTrack('t1').segments).toEqual({ calm: { start: 0, end: 10 } });
    });

    it('simple réordonnancement des versions : même instance, nouvel ordre', () => {
        const manager = new AudioManager();
        manager.loadPlaylist(base);
        const track = manager.getTrack('t1');

        manager.loadPlaylist([{ ...base[0], versions: { combat: 'b.mp3', calm: 'a.mp3' } }, base[1]]);

        expect(manager.getTrack('t1')).toBe(track);
        expect(track.getState().availableVersions).toEqual(['combat', 'calm']);
    });

    it('version ajoutée : la piste est reconstruite', () => {
        const manager = new AudioManager();
        manager.loadPlaylist(base);
        const track = manager.getTrack('t1');

        manager.loadPlaylist([{ ...base[0], versions: { ...base[0].versions, boss: 'd.mp3' } }, base[1]]);

        expect(manager.getTrack('t1')).not.toBe(track);
        expect(manager.getTrack('t1').getState().availableVersions).toEqual(['calm', 'combat', 'boss']);
    });

    it('segments modifiés sur la piste en cours : arrêtée, reconstruite, UI notifiée, index conservé', () => {
        const manager = new AudioManager();
        const onTrackChange = vi.fn();
        manager.on('trackChange', onTrackChange);
        const split = { id: 't1', title: 'T', versions: { calm: 's.mp3' }, segments: { calm: { start: 0, end: 10 } } };
        manager.loadPlaylist([base[1], split]);
        manager.playTrackAtIndex(1);
        const oldTrack = manager.getTrack('t1');
        const stopSpy = vi.spyOn(oldTrack, 'stop');
        onTrackChange.mockClear();

        manager.loadPlaylist([base[1], { ...split, segments: { calm: { start: 0, end: 12 } } }]);

        expect(stopSpy).toHaveBeenCalled();
        expect(manager.currentTrack).toBeNull();
        expect(manager.getTrack('t1')).not.toBe(oldTrack);
        expect(manager.currentTrackIndex).toBe(1);
        expect(onTrackChange).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --root . tests/AudioManager.test.js`
Expected: FAIL — `transmet les segments` (`expected {} ...` / `undefined`), `simple réordonnancement` (ordre inchangé), `version ajoutée` (même instance), `segments modifiés` (piste non arrêtée).

- [ ] **Step 3: Implement**

Dans `backend/AudioManager.js` :

a) Import :

```js
import { trackSignature } from './segments.js';
```

b) `loadTrack` :

```js
    /**
     * Charger une piste avec ses différentes versions
     * @param {string} trackId - Identifiant unique de la piste
     * @param {string} name - Nom d'affichage
     * @param {Object} versionPaths - Chemins des versions { calm: 'path.mp3', combat: 'path.mp3' }
     * @param {Object} [segments] - Versions découpées (#24)
     */
    loadTrack(trackId, name, versionPaths, segments = {}) {
        console.log(`📥 Chargement de la piste "${name}" (${trackId})`);

        const track = new Track(trackId, name, versionPaths, segments);
        track.loadVersions();
```
(le reste est inchangé). Dans `loadTracks`, déstructurer aussi `segments` et appeler `this.loadTrack(trackId, name, versions, segments);`.

c) `loadPlaylist` : au tout début de la méthode, juste après le `console.log` initial, insérer :

```js
        // Pistes déjà chargées dont les versions, fichiers ou segments ont changé
        // (modal d'édition #15, retouche de découpe #24) : à reconstruire, sinon le
        // lecteur garde les anciens Howl (#32). Un simple réordonnancement ne compte pas.
        let rebuiltCurrentId = null;
        for (const { id, versions, segments } of playlistConfig) {
            const existing = this.tracks.get(id);
            if (existing && existing.signature !== trackSignature(versions, segments)) {
                existing.stop();
                this.tracks.delete(id);
                if (this.currentTrack === existing) {
                    this.currentTrack = null;
                    rebuiltCurrentId = id;
                }
            }
        }
```

Dans la boucle `playlistConfig.forEach`, déstructurer `segments` et remplacer

```js
            if (!this.tracks.has(id)) {
                this.loadTrack(id, title, versions);
            }
```
par
```js
            if (!this.tracks.has(id)) {
                this.loadTrack(id, title, versions, segments);
            } else {
                this.tracks.get(id).reorderVersions(Object.keys(versions || {}));
            }
```

Remplacer le calcul final de l'index :

```js
        this.currentTrackIndex = keepPlaying
            ? this.playlist.findIndex(t => t.id === currentTrackId)
            : 0;
```
par
```js
        const indexId = keepPlaying ? currentTrackId : rebuiltCurrentId;
        this.currentTrackIndex = indexId ? Math.max(0, this.playlist.findIndex(t => t.id === indexId)) : 0;

        if (rebuiltCurrentId) this._notifyTrackChange(); // la piste en cours a été arrêtée
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (dont le test #13 existant « ne coupe pas la lecture en cours… »)

- [ ] **Step 5: Commit**

```bash
git add backend/AudioManager.js tests/AudioManager.test.js
git commit -m "fix(audio): recharger une piste dont les versions ont changé (closes #32)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Données, fichiers et IPC

**Files:**
- Modify: `backend/DatabaseManager.js`, `backend/FileManager.js`, `electron/main.cjs`, `electron/preload.cjs`
- Test: `tests/DatabaseManager.test.js`, `tests/FileManager.test.js` (create)

**Interfaces:**
- Consumes: `sanitizeSegments`, `applySegmentUpdate`, `uniquePaths`, `isPathSharedByOtherVersion`, `buildSegmentedTrack`, `SOURCE_VERSION_KEY` (Task 1)
- Produces:
  - `dbManager.updateSegments(trackId, segments, defaultVersion): Promise<object>`
  - `window.electronAPI.readAudioFile(path): Promise<Uint8Array>`
  - `window.electronAPI.addSegmentedTrack({ title, sourcePath, segments }, selectedPlaylists): Promise<object>`
  - `window.electronAPI.updateSegments(trackId, segments, defaultVersion): Promise<object>`

- [ ] **Step 1: Write the failing tests**

Ajouter à `tests/DatabaseManager.test.js` (le helper `createDatabaseManager` existe déjà) :

```js
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

    it('updateSegments applique la retouche et persiste', async () => {
        const manager = createDatabaseManager(splitLibrary());

        await manager.updateSegments('t1', { calme: { start: 0, end: 80 }, assaut: { start: 80, end: 180 } }, 'assaut');

        const track = manager.db.data.library[0];
        expect(Object.keys(track.localPaths)).toEqual(['calme', 'assaut', 'boss']);
        expect(track.defaultVersion).toBe('assaut');
        expect(manager.db.write).toHaveBeenCalledOnce();
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
```

Créer `tests/FileManager.test.js` :

```js
import { describe, expect, it, vi } from 'vitest';
import { FileManager } from '../backend/FileManager.js';

describe('FileManager.deleteTrackFiles', () => {
    it('ne supprime qu\'une fois un fichier partagé par plusieurs versions (#24)', async () => {
        const manager = new FileManager('/tmp/jukebox-test');
        manager.deleteAudioFile = vi.fn().mockResolvedValue(true);

        await manager.deleteTrackFiles({
            title: 'Forêt',
            localPaths: { calm: '/m/t1_source.mp3', combat: '/m/t1_source.mp3', boss: '/m/t1_boss.mp3' },
        });

        expect(manager.deleteAudioFile).toHaveBeenCalledTimes(2);
        expect(manager.deleteAudioFile).toHaveBeenCalledWith('/m/t1_source.mp3');
        expect(manager.deleteAudioFile).toHaveBeenCalledWith('/m/t1_boss.mp3');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --root . tests/DatabaseManager.test.js tests/FileManager.test.js`
Expected: FAIL — segments non nettoyés, segment non retiré, `updateSegments is not a function`, `deleteAudioFile` appelé 3 fois.

- [ ] **Step 3: Implement `DatabaseManager`**

a) Import :

```js
import { applySegmentUpdate, sanitizeSegments } from './segments.js';
```

b) Sous `normalizeIncomingCrossfade`, ajouter :

```js
/**
 * Piste entrante (ajout / import) : durée de fondu normalisée (#28) et
 * segments nettoyés (#24) — un segment invalide est retiré, la version
 * redevient « fichier entier ».
 */
function normalizeIncomingTrack(track) {
    const normalized = normalizeIncomingCrossfade(track);
    const segments = sanitizeSegments(normalized.segments, normalized.localPaths);
    if (segments) {
        normalized.segments = segments;
    } else {
        delete normalized.segments;
    }
    return normalized;
}
```

et remplacer les deux appels `normalizeIncomingCrossfade(track)` (dans `addTrackToLibrary` et `mergeImportedLibrary`) par `normalizeIncomingTrack(track)`.

c) `removeVersionFromTrack` : après `if (track.localPaths) delete track.localPaths[versionName];`, ajouter

```js
        if (track.segments) {
            delete track.segments[versionName];
            if (Object.keys(track.segments).length === 0) delete track.segments;
        }
```

d) Après `reorderTrackVersions`, ajouter :

```js
    /**
     * Retouche d'une découpe (#24) : remplace les versions découpées, garde les
     * versions « fichier entier ». Voir applySegmentUpdate (backend/segments.js).
     * @param {string} trackId
     * @param {Object} segments - { versionName: { start, end } }
     * @param {string} [defaultVersion]
     */
    async updateSegments(trackId, segments, defaultVersion) {
        const track = this.db.data.library.find(t => t.id === trackId);
        if (!track) {
            throw new Error(`Track ${trackId} introuvable`);
        }

        applySegmentUpdate(track, segments, defaultVersion);
        if (track.metadata) {
            track.metadata.modifiedAt = new Date().toISOString();
        }

        this.updateMetadata();
        await this.db.write();

        console.log(`✂️ Découpe de "${track.title}" mise à jour`);
        return track;
    }
```

- [ ] **Step 4: Implement `FileManager`**

a) Import en tête : `import { uniquePaths } from './segments.js';`

b) `deleteTrackFiles` : remplacer le corps de la boucle par une itération sur les chemins uniques :

```js
    async deleteTrackFiles(track) {
        const deletedFiles = [];

        // Un fichier partagé par plusieurs versions découpées (#24) n'est supprimé qu'une fois
        for (const filePath of uniquePaths(track.localPaths)) {
            if (await this.deleteAudioFile(filePath)) {
                deletedFiles.push(filePath);
            }
        }

        console.log(`🗑️ ${deletedFiles.length} fichiers supprimés pour "${track.title}"`);
        return deletedFiles;
    }
```

c) `exportTrackFiles` : ne copier qu'une fois un fichier partagé. Remplacer la boucle par :

```js
        const exported = new Map(); // localPath → filename, pour les fichiers partagés (#24)
        if (track.localPaths) {
            for (const [versionName, localPath] of Object.entries(track.localPaths)) {
                if (exported.has(localPath)) {
                    relativePaths[versionName] = exported.get(localPath);
                    continue;
                }
                const filename = path.basename(localPath);
                const destPath = path.join(exportMusicDir, filename);
                try {
                    await fs.copyFile(localPath, destPath);
                    relativePaths[versionName] = filename;
                    exported.set(localPath, filename);
                } catch (error) {
                    console.warn(`⚠️ Impossible d'exporter ${localPath}:`, error.message);
                }
            }
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Implement IPC (`electron/main.cjs`)**

a) Variables de module, sous `let normalizeLanguage;` :

```js
let segmentsModule; // backend/segments.js (#24), lié dans initManagers()
```

b) Dans `initManagers()`, avec les autres chemins/imports :

```js
    const segmentsPath = pathToFileURL(path.join(__dirname, '..', 'backend', 'segments.js')).href;
```
```js
    segmentsModule = await import(segmentsPath);
```

c) Après le handler `dialog:openFolder`, ajouter (handler brut : pas besoin des managers) :

```js
// Lecture brute d'un fichier audio pour dessiner sa waveform (onglet Découpage, #24).
// Limité aux extensions audio proposées par dialog:openFiles.
const AUDIO_FILE_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
ipcMain.handle('audio:readFile', async (event, filePath) => {
    if (typeof filePath !== 'string' || !AUDIO_FILE_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) {
        throw new Error('Fichier audio non pris en charge');
    }
    return fs.readFile(filePath); // Buffer → Uint8Array côté renderer
});
```

d) Après `library:addTrack`, ajouter :

```js
// Musique découpée (#24) : le fichier source est copié UNE fois, toutes les
// versions découpées pointent dessus ; le fichier source n'est jamais modifié.
ipcHandle('library:addSegmentedTrack', async (event, trackData, selectedPlaylists = []) => {
    try {
        const trackId = fileManager.generateTrackId();
        const localPath = await fileManager.copyAudioFile(trackData.sourcePath, trackId, segmentsModule.SOURCE_VERSION_KEY);
        const track = segmentsModule.buildSegmentedTrack({
            trackId,
            title: trackData.title,
            sourcePath: trackData.sourcePath,
            localPath,
            segments: trackData.segments,
            selectedPlaylists,
        });

        const saved = await dbManager.addTrackToLibrary(track);
        await Promise.all(
            selectedPlaylists.map(playlistId => dbManager.addTrackIdToPlaylist(playlistId, trackId))
        );

        console.log(`✂️ Piste découpée "${track.title}" ajoutée`);
        return saved;
    } catch (error) {
        console.error('❌ Erreur addSegmentedTrack:', error);
        throw error;
    }
});

ipcHandle('library:updateSegments', async (event, trackId, segments, defaultVersion) => {
    try {
        return await dbManager.updateSegments(trackId, segments, defaultVersion);
    } catch (error) {
        console.error('❌ Erreur updateSegments:', error);
        throw error;
    }
});
```

e) `library:removeVersion` : remplacer

```js
        const track = await dbManager.getTrack(trackId);
        const localPath = track?.localPaths?.[versionName];
        const removed = await dbManager.removeVersionFromTrack(trackId, versionName);
        if (removed && localPath) {
```
par
```js
        const track = await dbManager.getTrack(trackId);
        const localPath = track?.localPaths?.[versionName];
        // Fichier partagé par d'autres versions découpées (#24) : on le garde
        const shared = segmentsModule.isPathSharedByOtherVersion(track, versionName);
        const removed = await dbManager.removeVersionFromTrack(trackId, versionName);
        if (removed && localPath && !shared) {
```

- [ ] **Step 7: Expose in `electron/preload.cjs`**

Dans la section LIBRARY, après `reorderVersions` :

```js
    /**
     * Onglet Découpage (#24) : lecture brute d'un fichier audio (waveform),
     * ajout d'une musique découpée, retouche d'une découpe.
     */
    readAudioFile: (filePath) => ipcRenderer.invoke('audio:readFile', filePath),
    addSegmentedTrack: (trackData, selectedPlaylists) =>
        ipcRenderer.invoke('library:addSegmentedTrack', trackData, selectedPlaylists),
    updateSegments: (trackId, segments, defaultVersion) =>
        ipcRenderer.invoke('library:updateSegments', trackId, segments, defaultVersion),
```

- [ ] **Step 8: Verify**

Run: `npm test && node --check electron/main.cjs && node --check electron/preload.cjs && npx vite build`
Expected: tests PASS, pas d'erreur de syntaxe, build OK.

- [ ] **Step 9: Commit**

```bash
git add backend/DatabaseManager.js backend/FileManager.js electron/main.cjs electron/preload.cjs tests/DatabaseManager.test.js tests/FileManager.test.js
git commit -m "feat(library): stockage et IPC des pistes découpées (#24)

Fichier source copié une fois et partagé ; il n'est supprimé que quand
plus aucune version ne l'utilise. Segments nettoyés à l'ajout et à
l'import.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Module pur `frontend/segmentModel.js`

**Files:**
- Create: `frontend/segmentModel.js`
- Test: `tests/segmentModel.test.js`

**Interfaces:**
- Consumes: `orderedSegmentNames` (Task 1)
- Produces:
  - `MIN_SEGMENT_SECONDS = 0.5`
  - `cutsToRanges(cuts: number[], duration: number): { start, end }[]`
  - `addCut(cuts, time, duration): { cuts: number[], index: number } | null`
  - `moveCut(cuts, index, time, duration): number[]`
  - `removeCut(cuts, index): number[]`
  - `splitNames(names: string[], cutIndex: number): string[]` (après `addCut`)
  - `mergeNames(names: string[], cutIndex: number): string[]` (avant/avec `removeCut`)
  - `formatTime(seconds): string` (`m:ss.d`) ; `parseTime(text): number | null`
  - `validateSplit({ title, ranges, names, reservedNames? }): { key: string, vars?: object } | null`
  - `rangesToSegments(ranges, names): { [name]: { start, end } }`
  - `stateFromTrack(track, duration): { cuts: number[], names: string[] }`
  - `planSegmentUpdate(track, segments): { segments, defaultVersion }`

- [ ] **Step 1: Write the failing test**

```js
// tests/segmentModel.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root . tests/segmentModel.test.js`
Expected: FAIL — `Failed to load url ../frontend/segmentModel.js`

- [ ] **Step 3: Write implementation**

```js
// frontend/segmentModel.js
import { orderedSegmentNames } from '../backend/segments.js';

/**
 * Logique pure de l'onglet Découpage (#24) : points de coupe (secondes, au
 * dixième), plages consécutives entre ces coupes, noms des plages (vide =
 * plage ignorée), validation et passage vers/depuis `track.segments`.
 */

export const MIN_SEGMENT_SECONDS = 0.5;
const EPSILON = 1e-9;

const roundTenth = value => Math.round(value * 10) / 10;

export function cutsToRanges(cuts, duration) {
    const bounds = [0, ...cuts, duration];
    return bounds.slice(0, -1).map((start, i) => ({ start, end: bounds[i + 1] }));
}

export function addCut(cuts, time, duration) {
    const value = roundTenth(time);
    if (value < MIN_SEGMENT_SECONDS - EPSILON || value > duration - MIN_SEGMENT_SECONDS + EPSILON) return null;
    if (cuts.some(cut => Math.abs(cut - value) < MIN_SEGMENT_SECONDS - EPSILON)) return null;

    const next = [...cuts, value].sort((a, b) => a - b);
    return { cuts: next, index: next.indexOf(value) };
}

export function moveCut(cuts, index, time, duration) {
    const lower = (index === 0 ? 0 : cuts[index - 1]) + MIN_SEGMENT_SECONDS;
    const upper = (index === cuts.length - 1 ? duration : cuts[index + 1]) - MIN_SEGMENT_SECONDS;
    if (lower > upper) return cuts;

    const next = [...cuts];
    next[index] = roundTenth(Math.min(Math.max(time, lower), upper));
    return next;
}

export function removeCut(cuts, index) {
    return cuts.filter((_, i) => i !== index);
}

/** Après addCut(…).index : la plage coupée garde son nom, la nouvelle est vide */
export function splitNames(names, cutIndex) {
    const next = [...names];
    next.splice(cutIndex + 1, 0, '');
    return next;
}

/** Suppression de la coupe cutIndex : ses deux plages fusionnent */
export function mergeNames(names, cutIndex) {
    const next = [...names];
    const merged = (next[cutIndex] || '').trim() ? next[cutIndex] : (next[cutIndex + 1] || '');
    next.splice(cutIndex, 2, merged);
    return next;
}

export function formatTime(seconds) {
    const tenths = Math.max(0, Math.round(seconds * 10));
    const minutes = Math.floor(tenths / 600);
    const rest = (tenths % 600) / 10;
    return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

export function parseTime(text) {
    const match = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(String(text).trim());
    if (!match) return null;
    const seconds = Number(match[2].replace(',', '.'));
    if (match[1] !== undefined && seconds >= 60) return null;
    return roundTenth(Number(match[1] || 0) * 60 + seconds);
}

/**
 * @returns {{ key: string, vars?: object } | null} première erreur (clé i18n), ou null
 */
export function validateSplit({ title, ranges, names, reservedNames = [] }) {
    if (!title || !title.trim()) return { key: 'split.errorTitle' };

    const named = ranges
        .map((range, i) => ({ ...range, name: (names[i] || '').trim() }))
        .filter(range => range.name);
    if (named.length === 0) return { key: 'split.errorNoNamed' };

    const seen = new Set(reservedNames.map(name => name.trim().toLowerCase()));
    for (const range of named) {
        const key = range.name.toLowerCase();
        if (seen.has(key)) return { key: 'split.errorDuplicate', vars: { name: range.name } };
        seen.add(key);
    }

    if (named.some(range => range.end - range.start < MIN_SEGMENT_SECONDS - EPSILON)) {
        return { key: 'split.errorTooShort' };
    }
    return null;
}

export function rangesToSegments(ranges, names) {
    const segments = {};
    ranges.forEach((range, i) => {
        const name = (names[i] || '').trim();
        if (name) segments[name] = { start: range.start, end: range.end };
    });
    return segments;
}

/**
 * Rouvre une découpe : coupes = bornes des segments (hors 0 et durée,
 * bornées au fichier réellement décodé), noms = segment couvrant chaque plage.
 */
export function stateFromTrack(track, duration) {
    const segments = track.segments || {};
    const bounds = new Set();
    for (const { start, end } of Object.values(segments)) {
        bounds.add(roundTenth(Math.min(Math.max(start, 0), duration)));
        bounds.add(roundTenth(Math.min(Math.max(end, 0), duration)));
    }
    const cuts = [...bounds]
        .filter(value => value >= MIN_SEGMENT_SECONDS && value <= duration - MIN_SEGMENT_SECONDS)
        .sort((a, b) => a - b);

    const names = cutsToRanges(cuts, duration).map(range => {
        const middle = (range.start + range.end) / 2;
        return Object.keys(segments).find(name => segments[name].start <= middle && middle < segments[name].end) || '';
    });
    return { cuts, names };
}

/** Retouche : la version de lancement suit son segment (position), sinon inchangée */
export function planSegmentUpdate(track, segments) {
    const old = track.segments || {};
    let defaultVersion = track.defaultVersion;

    if (old[defaultVersion]) {
        const middle = (old[defaultVersion].start + old[defaultVersion].end) / 2;
        defaultVersion = Object.keys(segments).find(name => segments[name].start <= middle && middle < segments[name].end)
            ?? orderedSegmentNames(segments)[0];
    }
    return { segments, defaultVersion };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root . tests/segmentModel.test.js`
Expected: PASS (17 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/segmentModel.js tests/segmentModel.test.js
git commit -m "feat(split): logique pure de la découpe (#24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Module `frontend/waveform.js`

**Files:**
- Create: `frontend/waveform.js`
- Test: `tests/waveform.test.js`

**Interfaces:**
- Produces:
  - `PEAKS_PER_SECOND = 100`, `WAVEFORM_SAMPLE_RATE = 8000`, `MIN_VISIBLE_SECONDS = 4`
  - `computePeaks(samples: Float32Array, bucketCount: number): { min: Float32Array, max: Float32Array }`
  - `mixToMono(channels: Float32Array[]): Float32Array`
  - `decodeForWaveform(arrayBuffer, { createContext? }): Promise<{ duration: number, peaks }>`
  - `timeToX(time, view, width)`, `xToTime(x, view, width)` ; `view = { start, end }` en secondes
  - `zoomView(view, factor, anchorTime, duration, minSpan?)`, `scrollView(view, deltaSeconds, duration)`, `fullView(duration)`
  - `drawWaveform(ctx, { peaks, view, width, height, cuts, playhead, selectedCut, colors })`

- [ ] **Step 1: Write the failing test**

```js
// tests/waveform.test.js
import { describe, expect, it, vi } from 'vitest';
import {
    computePeaks,
    decodeForWaveform,
    fullView,
    mixToMono,
    scrollView,
    timeToX,
    xToTime,
    zoomView,
} from '../frontend/waveform.js';

describe('computePeaks', () => {
    it('calcule min/max par tranche, y compris taille non multiple', () => {
        const peaks = computePeaks(new Float32Array([0.1, -0.5, 0.3, 0.9, -0.2]), 2);
        expect(Array.from(peaks.min)).toEqual([-0.5, -0.2].map(Math.fround));
        expect(Array.from(peaks.max)).toEqual([0.1, 0.9].map(Math.fround));
    });

    it('silence → zéros', () => {
        const peaks = computePeaks(new Float32Array(10), 5);
        expect(Array.from(peaks.max)).toEqual([0, 0, 0, 0, 0]);
    });
});

describe('decodeForWaveform', () => {
    it('décode à 8 kHz et mixe en mono (fichiers longs)', async () => {
        const buffer = {
            duration: 2,
            numberOfChannels: 2,
            getChannelData: i => new Float32Array(16000).fill(i === 0 ? 1 : 0),
        };
        const createContext = vi.fn(() => ({ decodeAudioData: vi.fn().mockResolvedValue(buffer) }));

        const result = await decodeForWaveform(new ArrayBuffer(8), { createContext });

        expect(createContext).toHaveBeenCalledWith(8000);
        expect(result.duration).toBe(2);
        expect(result.peaks.max.length).toBe(200); // 100 pics / s
        expect(result.peaks.max[0]).toBeCloseTo(0.5); // moyenne des 2 canaux
    });

    it('mixToMono laisse un canal unique tel quel', () => {
        const mono = new Float32Array([1, 2]);
        expect(mixToMono([mono])).toBe(mono);
    });
});

describe('vue (zoom et défilement)', () => {
    it('convertit temps ↔ x', () => {
        const view = { start: 10, end: 20 };
        expect(timeToX(15, view, 200)).toBe(100);
        expect(xToTime(50, view, 200)).toBe(12.5);
    });

    it('zoome autour du point visé, sans descendre sous 4 s visibles', () => {
        expect(zoomView({ start: 0, end: 100 }, 2, 50, 100)).toEqual({ start: 25, end: 75 });
        expect(zoomView({ start: 0, end: 8 }, 10, 0, 100)).toEqual({ start: 0, end: 4 });
    });

    it('dézoome sans dépasser le fichier', () => {
        expect(zoomView({ start: 90, end: 100 }, 0.1, 95, 100)).toEqual({ start: 0, end: 100 });
    });

    it('défile en restant dans le fichier', () => {
        expect(scrollView({ start: 10, end: 20 }, 100, 50)).toEqual({ start: 40, end: 50 });
        expect(scrollView({ start: 10, end: 20 }, -100, 50)).toEqual({ start: 0, end: 10 });
    });

    it('vue complète', () => {
        expect(fullView(42)).toEqual({ start: 0, end: 42 });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root . tests/waveform.test.js`
Expected: FAIL — `Failed to load url ../frontend/waveform.js`

- [ ] **Step 3: Write implementation**

```js
// frontend/waveform.js
/**
 * Waveform de l'onglet Découpage (#24). Décodage mono à 8 kHz uniquement pour
 * le dessin : un fichier d'ambiance d'une heure tient en ~100 Mo au lieu de
 * >1 Go en pleine qualité (machine cible : 8 Go). Pics précalculés
 * (100 / s), seule la fenêtre visible est redessinée.
 */

export const PEAKS_PER_SECOND = 100;
export const WAVEFORM_SAMPLE_RATE = 8000;
export const MIN_VISIBLE_SECONDS = 4;

export function computePeaks(samples, bucketCount) {
    const min = new Float32Array(bucketCount);
    const max = new Float32Array(bucketCount);
    const size = samples.length / bucketCount;

    for (let bucket = 0; bucket < bucketCount; bucket++) {
        const from = Math.floor(bucket * size);
        const to = Math.min(samples.length, Math.max(from + 1, Math.floor((bucket + 1) * size)));
        let low = 0;
        let high = 0;
        for (let i = from; i < to; i++) {
            const value = samples[i];
            if (value < low) low = value;
            if (value > high) high = value;
        }
        min[bucket] = low;
        max[bucket] = high;
    }
    return { min, max };
}

export function mixToMono(channels) {
    if (channels.length === 1) return channels[0];
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) {
        for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    }
    return mono;
}

export async function decodeForWaveform(arrayBuffer, {
    createContext = sampleRate => new OfflineAudioContext(1, 1, sampleRate),
} = {}) {
    const context = createContext(WAVEFORM_SAMPLE_RATE);
    const buffer = await context.decodeAudioData(arrayBuffer);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const bucketCount = Math.max(1, Math.ceil(buffer.duration * PEAKS_PER_SECOND));
    return { duration: buffer.duration, peaks: computePeaks(mixToMono(channels), bucketCount) };
}

export function timeToX(time, view, width) {
    return ((time - view.start) / (view.end - view.start)) * width;
}

export function xToTime(x, view, width) {
    return view.start + (x / width) * (view.end - view.start);
}

export function fullView(duration) {
    return { start: 0, end: duration };
}

function clampView(start, span, duration) {
    const clampedStart = Math.min(Math.max(0, start), Math.max(0, duration - span));
    return { start: clampedStart, end: clampedStart + span };
}

export function zoomView(view, factor, anchorTime, duration, minSpan = MIN_VISIBLE_SECONDS) {
    const span = view.end - view.start;
    const newSpan = Math.min(duration, Math.max(Math.min(minSpan, duration), span / factor));
    const ratio = span > 0 ? (anchorTime - view.start) / span : 0.5;
    return clampView(anchorTime - ratio * newSpan, newSpan, duration);
}

export function scrollView(view, deltaSeconds, duration) {
    return clampView(view.start + deltaSeconds, view.end - view.start, duration);
}

/**
 * Dessine la fenêtre visible : waveform, points de coupe (◆ en haut) et tête
 * de lecture. `colors` vient des variables CSS du thème actif.
 */
export function drawWaveform(ctx, { peaks, view, width, height, cuts, playhead, selectedCut, colors }) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);

    const middle = height / 2;
    ctx.fillStyle = colors.wave;
    for (let x = 0; x < width; x++) {
        const from = Math.max(0, Math.floor(xToTime(x, view, width) * PEAKS_PER_SECOND));
        const to = Math.min(peaks.max.length, Math.max(from + 1, Math.ceil(xToTime(x + 1, view, width) * PEAKS_PER_SECOND)));
        let low = 0;
        let high = 0;
        for (let i = from; i < to; i++) {
            if (peaks.min[i] < low) low = peaks.min[i];
            if (peaks.max[i] > high) high = peaks.max[i];
        }
        const top = middle - high * middle * 0.9;
        const bottom = middle - low * middle * 0.9;
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }

    cuts.forEach((cut, i) => {
        const x = Math.round(timeToX(cut, view, width)) + 0.5;
        if (x < -6 || x > width + 6) return;
        ctx.strokeStyle = ctx.fillStyle = i === selectedCut ? colors.cutSelected : colors.cut;
        ctx.lineWidth = i === selectedCut ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.beginPath(); // ◆ poignée
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 6, 6);
        ctx.lineTo(x, 12);
        ctx.lineTo(x - 6, 6);
        ctx.closePath();
        ctx.fill();
    });

    const playheadX = Math.round(timeToX(playhead, view, width)) + 0.5;
    if (playheadX >= 0 && playheadX <= width) {
        ctx.strokeStyle = colors.playhead;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root . tests/waveform.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/waveform.js tests/waveform.test.js
git commit -m "feat(split): waveform décodée à 8 kHz, zoom et défilement (#24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Onglet Découpage (DOM, i18n, CSS, branchement)

**Files:**
- Create: `frontend/cutterView.js`
- Modify: `frontend/index.html:37` (onglet), `frontend/index.html:154-163` (vue), `backend/i18n.js`, `frontend/styles.css`, `frontend/renderer.js`

**Interfaces:**
- Consumes: tout `segmentModel.js` (Task 5), tout `waveform.js` (Task 6), `window.electronAPI.readAudioFile/addSegmentedTrack/updateSegments/openFiles/getAllPlaylists` (Task 4)
- Produces: `createCutterView({ root, electronAPI, t, createHowl, stopLibraryPreview, onSaved }) → { openTrack(track), onShow(), refresh() }`

- [ ] **Step 1: i18n**

Dans `backend/i18n.js`, dictionnaire `fr` : remplacer `'nav.effects': 'Effets',` par `'nav.split': 'Découpage',` ; supprimer `'effects.title'` et `'effects.comingSoon'` ; ajouter `'library.splitTrack': 'Modifier la découpe',` à côté de `library.editTrack` ; puis ajouter le bloc :

```js
    'split.chooseFile': '📂 Choisir un fichier',
    'split.noFile': 'Choisissez un fichier audio à découper en versions.',
    'split.loading': 'Analyse du fichier…',
    'split.loadError': 'Impossible de lire ce fichier audio.',
    'split.zoomIn': 'Zoom avant (Ctrl + molette)',
    'split.zoomOut': 'Zoom arrière (Ctrl + molette)',
    'split.scroll': 'Défilement',
    'split.listen': '▶ Écouter',
    'split.stopListening': '⏸ Arrêter',
    'split.cutHere': '✂ Couper ici',
    'split.segmentsTitle': 'Segments',
    'split.segmentEnd': 'Fin du segment (m:ss.d)',
    'split.segmentNamePlaceholder': 'vide = ignoré',
    'split.playSegment': 'Écouter ce segment',
    'split.removeCut': 'Fusionner avec le segment précédent',
    'split.titleLabel': 'Titre',
    'split.playlistsLabel': 'Playlists',
    'split.cancel': 'Annuler',
    'split.add': 'Ajouter à la bibliothèque',
    'split.save': 'Enregistrer',
    'split.added': '« {title} » a été ajoutée à la bibliothèque.',
    'split.saved': 'Découpe de « {title} » enregistrée.',
    'split.errorTitle': 'Donnez un titre à la musique.',
    'split.errorNoNamed': 'Nommez au moins un segment.',
    'split.errorDuplicate': 'Le nom « {name} » est déjà utilisé.',
    'split.errorTooShort': 'Un segment nommé doit durer au moins 0,5 s.',
    'split.errorCutTooClose': 'Trop près d\'un autre point de coupe (0,5 s minimum).',
    'split.errorSave': 'Erreur lors de l\'enregistrement.',
```

Dictionnaire `en` : `'nav.split': 'Split',`, supprimer `effects.*`, `'library.splitTrack': 'Edit split',` et :

```js
    'split.chooseFile': '📂 Choose a file',
    'split.noFile': 'Choose an audio file to split into versions.',
    'split.loading': 'Analysing file…',
    'split.loadError': 'Could not read this audio file.',
    'split.zoomIn': 'Zoom in (Ctrl + wheel)',
    'split.zoomOut': 'Zoom out (Ctrl + wheel)',
    'split.scroll': 'Scroll',
    'split.listen': '▶ Listen',
    'split.stopListening': '⏸ Stop',
    'split.cutHere': '✂ Cut here',
    'split.segmentsTitle': 'Segments',
    'split.segmentEnd': 'Segment end (m:ss.d)',
    'split.segmentNamePlaceholder': 'empty = skipped',
    'split.playSegment': 'Listen to this segment',
    'split.removeCut': 'Merge with the previous segment',
    'split.titleLabel': 'Title',
    'split.playlistsLabel': 'Playlists',
    'split.cancel': 'Cancel',
    'split.add': 'Add to library',
    'split.save': 'Save',
    'split.added': '"{title}" was added to the library.',
    'split.saved': 'Split of "{title}" saved.',
    'split.errorTitle': 'Give the track a title.',
    'split.errorNoNamed': 'Name at least one segment.',
    'split.errorDuplicate': 'The name "{name}" is already used.',
    'split.errorTooShort': 'A named segment must last at least 0.5 s.',
    'split.errorCutTooClose': 'Too close to another cut (0.5 s minimum).',
    'split.errorSave': 'Error while saving.',
```

Run: `npx vitest run --root . tests/i18n.test.js`
Expected: PASS (parité fr/en)

- [ ] **Step 2: HTML**

`frontend/index.html` ligne 37 : remplacer l'onglet Effets par

```html
                    <button class="tab-btn" data-view="decoupage" data-i18n="nav.split">Découpage</button>
```

Remplacer tout le bloc `<!-- VUE EFFETS -->` … `</div>` de `#effets-view` par :

```html
                <!-- ======================== -->
                <!-- VUE DÉCOUPAGE (#24)      -->
                <!-- ======================== -->
                <div id="decoupage-view" class="view hidden">
                    <div class="split-panel">
                        <div class="split-header">
                            <button type="button" id="split-choose-file" class="secondary-btn" data-i18n="split.chooseFile">📂 Choisir un fichier</button>
                            <span id="split-file-name" class="split-file-name"></span>
                        </div>
                        <p id="split-message" class="split-message" aria-live="polite"></p>
                        <div id="split-editor" class="split-editor hidden">
                            <div class="split-wave-wrap">
                                <canvas id="split-canvas" class="split-canvas" tabindex="0"></canvas>
                            </div>
                            <input type="range" id="split-scroll" class="split-scroll" min="0" max="0" step="0.1" value="0" data-i18n-title="split.scroll" title="Défilement" />
                            <div class="split-toolbar">
                                <button type="button" id="split-zoom-out" class="secondary-btn" data-i18n-title="split.zoomOut" title="Zoom arrière">－</button>
                                <button type="button" id="split-zoom-in" class="secondary-btn" data-i18n-title="split.zoomIn" title="Zoom avant">＋</button>
                                <button type="button" id="split-listen" class="secondary-btn"></button>
                                <button type="button" id="split-cut" class="secondary-btn" data-i18n="split.cutHere">✂ Couper ici</button>
                                <span id="split-time" class="split-time">0:00.0 / 0:00.0</span>
                            </div>
                            <h3 class="settings-title" data-i18n="split.segmentsTitle">Segments</h3>
                            <div id="split-segments" class="split-segments"></div>
                            <div class="split-footer">
                                <div class="split-field">
                                    <label for="split-title" data-i18n="split.titleLabel">Titre</label>
                                    <input type="text" id="split-title" />
                                </div>
                                <div id="split-playlists-field" class="split-field">
                                    <span class="split-label" data-i18n="split.playlistsLabel">Playlists</span>
                                    <div id="split-playlists" class="split-playlists"></div>
                                </div>
                            </div>
                            <p id="split-error" class="split-error hidden" role="alert"></p>
                            <div class="split-actions">
                                <button type="button" id="split-cancel" class="secondary-btn" data-i18n="split.cancel">Annuler</button>
                                <button type="button" id="split-submit" class="primary-btn"></button>
                            </div>
                        </div>
                    </div>
                </div>
```

(`#split-message`, `#split-listen` et `#split-submit` n'ont pas de `data-i18n` : leur texte dépend de l'état et est rendu par `cutterView.refresh()`.)

- [ ] **Step 3: CSS**

Dans `frontend/styles.css`, remplacer le commentaire `/* ── Stub views (Effets / Réglages) ── */` par `/* ── Stub views ── */`, puis ajouter à la fin du fichier :

```css
/* ── Onglet Découpage (#24) ── */
.split-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.25rem;
    background: var(--ink-2);
    border: 1px solid var(--ink-4);
    border-radius: 6px;
}

.split-header,
.split-toolbar,
.split-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.split-actions { justify-content: flex-end; }

.split-file-name,
.split-time {
    color: var(--bone-dim);
    font-size: 0.85rem;
}

.split-time {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
}

.split-message {
    color: var(--bone-dim);
    margin: 0;
}

.split-editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.split-editor.hidden,
.split-field.hidden,
.split-error.hidden { display: none; }

.split-wave-wrap {
    height: 140px;
    border: 1px solid var(--ink-4);
    border-radius: 4px;
    overflow: hidden;
}

.split-canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
}

.split-canvas:focus-visible { outline: 2px solid var(--gold-2); }

.split-scroll { width: 100%; }

.split-segments {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.split-segment {
    display: grid;
    grid-template-columns: 2rem 5rem 1rem 6rem 1fr auto auto;
    align-items: center;
    gap: 0.5rem;
    color: var(--bone);
    font-variant-numeric: tabular-nums;
}

.split-index,
.split-arrow { color: var(--bone-dim); }

.split-segment input { width: 100%; }

.split-footer {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
}

.split-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    flex: 1 1 220px;
}

.split-label,
.split-field label {
    color: var(--bone-dim);
    font-size: 0.85rem;
}

.split-playlists {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    color: var(--bone);
}

.split-error {
    color: var(--red-fire);
    margin: 0;
}
```

- [ ] **Step 4: `frontend/cutterView.js`**

```js
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
} from './segmentModel.js';
import {
    decodeForWaveform,
    drawWaveform,
    fullView,
    scrollView,
    timeToX,
    xToTime,
    zoomView,
} from './waveform.js';

const CUT_HIT_PX = 6;
const NUDGE_SECONDS = 0.1;
const ZOOM_STEP = 1.5;

const toFileUrl = path => (path.startsWith('http') || path.startsWith('file://') ? path : `file://${path}`);

/**
 * Contrôleur de l'onglet Découpage (#24). Toute la logique de découpe est
 * dans segmentModel.js / waveform.js ; ici uniquement DOM, souris, clavier et
 * écoute (Howl dédié, indépendant du lecteur principal).
 */
export function createCutterView({ root, electronAPI, t, createHowl, stopLibraryPreview, onSaved }) {
    const $ = id => root.querySelector(`#${id}`);
    const canvas = $('split-canvas');

    let state = emptyState();
    let audition = null; // { howl, timer }
    let drag = null; // { index } pendant le déplacement d'un point de coupe

    function emptyState() {
        return {
            sourcePath: null,
            fileName: '',
            duration: 0,
            peaks: null,
            cuts: [],
            names: [''],
            view: { start: 0, end: 0 },
            playhead: 0,
            selectedCut: null,
            editingTrack: null, // piste en retouche, sinon création
            reservedNames: [], // versions « fichier entier » de la piste en retouche
            message: { key: 'split.noFile' },
            error: null,
        };
    }

    // ── Rendu ────────────────────────────────────────────────

    function refresh() {
        const loaded = Boolean(state.peaks);
        $('split-file-name').textContent = state.fileName;
        $('split-message').textContent = state.message ? t(state.message.key, state.message.vars) : '';
        $('split-editor').classList.toggle('hidden', !loaded);
        $('split-choose-file').disabled = Boolean(state.editingTrack);
        $('split-submit').textContent = t(state.editingTrack ? 'split.save' : 'split.add');
        $('split-title').readOnly = Boolean(state.editingTrack);
        $('split-playlists-field').classList.toggle('hidden', Boolean(state.editingTrack));
        const errorEl = $('split-error');
        errorEl.textContent = state.error ? t(state.error.key, state.error.vars) : '';
        errorEl.classList.toggle('hidden', !state.error);
        renderListenButton();
        if (!loaded) return;
        renderScroll();
        renderTime();
        renderSegments();
        draw();
    }

    function renderListenButton() {
        $('split-listen').textContent = t(audition ? 'split.stopListening' : 'split.listen');
    }

    function renderTime() {
        $('split-time').textContent = `${formatTime(state.playhead)} / ${formatTime(state.duration)}`;
    }

    function renderScroll() {
        const scroll = $('split-scroll');
        const span = state.view.end - state.view.start;
        scroll.max = String(Math.max(0, state.duration - span));
        scroll.value = String(state.view.start);
        scroll.disabled = span >= state.duration;
    }

    function colors() {
        const css = getComputedStyle(document.documentElement);
        const read = name => css.getPropertyValue(name).trim();
        return {
            background: read('--ink-1'),
            wave: read('--gold-2'),
            cut: read('--bone'),
            cutSelected: read('--gold-1'),
            playhead: read('--red-fire'),
        };
    }

    function draw() {
        if (!state.peaks) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return; // onglet masqué : redessiné par onShow()
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(rect.width * ratio);
        canvas.height = Math.round(rect.height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawWaveform(ctx, {
            peaks: state.peaks,
            view: state.view,
            width: rect.width,
            height: rect.height,
            cuts: state.cuts,
            playhead: state.playhead,
            selectedCut: state.selectedCut,
            colors: colors(),
        });
    }

    function renderSegments() {
        const container = $('split-segments');
        container.innerHTML = '';
        const ranges = cutsToRanges(state.cuts, state.duration);

        ranges.forEach((range, i) => {
            const row = document.createElement('div');
            row.className = 'split-segment';

            const index = document.createElement('span');
            index.className = 'split-index';
            index.textContent = String(i + 1);

            const start = document.createElement('span');
            start.textContent = formatTime(range.start);

            const arrow = document.createElement('span');
            arrow.className = 'split-arrow';
            arrow.textContent = '→';

            const end = document.createElement('input');
            end.type = 'text';
            end.className = 'split-end';
            end.value = formatTime(range.end);
            end.title = t('split.segmentEnd');
            end.disabled = i === ranges.length - 1; // la fin du dernier segment = fin du fichier
            end.addEventListener('change', () => {
                const value = parseTime(end.value);
                if (value !== null) state.cuts = moveCut(state.cuts, i, value, state.duration);
                refresh(); // valeur invalide → revient à la précédente
            });

            const name = document.createElement('input');
            name.type = 'text';
            name.className = 'split-name';
            name.placeholder = t('split.segmentNamePlaceholder');
            name.value = state.names[i] || ''; // propriété value : jamais d'innerHTML pour du texte utilisateur
            name.addEventListener('input', () => {
                state.names[i] = name.value;
            });

            const play = document.createElement('button');
            play.type = 'button';
            play.className = 'secondary-btn';
            play.textContent = '▶';
            play.title = t('split.playSegment');
            play.addEventListener('click', () => startAudition(range.start, range.end));

            row.append(index, start, arrow, end, name, play);

            if (i > 0) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'danger-btn-small';
                remove.textContent = '✕';
                remove.title = t('split.removeCut');
                remove.addEventListener('click', () => {
                    state.names = mergeNames(state.names, i - 1);
                    state.cuts = removeCut(state.cuts, i - 1);
                    state.selectedCut = null;
                    refresh();
                });
                row.append(remove);
            }
            container.append(row);
        });
    }

    // ── Chargement ───────────────────────────────────────────

    async function loadSource(sourcePath, track) {
        stopAudition();
        state = { ...emptyState(), message: { key: 'split.loading' }, fileName: sourcePath.split(/[\\/]/).pop() };
        refresh();

        try {
            const bytes = await electronAPI.readAudioFile(sourcePath);
            const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const { duration, peaks } = await decodeForWaveform(arrayBuffer);

            state.sourcePath = sourcePath;
            state.duration = duration;
            state.peaks = peaks;
            state.view = fullView(duration);
            state.message = null;

            if (track) {
                const { cuts, names } = stateFromTrack(track, duration);
                state.cuts = cuts;
                state.names = names;
                state.editingTrack = track;
                state.reservedNames = Object.keys(track.localPaths || {}).filter(v => !(track.segments || {})[v]);
                $('split-title').value = track.title;
            } else {
                $('split-title').value = state.fileName.replace(/\.[^.]+$/, '');
                await renderPlaylists();
            }
        } catch (error) {
            console.error('❌ Découpage : lecture du fichier impossible', error);
            state = { ...emptyState(), message: { key: 'split.loadError' } };
        }
        refresh();
    }

    async function renderPlaylists() {
        const container = $('split-playlists');
        container.innerHTML = '';
        const playlists = await electronAPI.getAllPlaylists();
        playlists.forEach(playlist => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = playlist.id;
            label.append(checkbox, ` ${playlist.name}`);
            container.append(label);
        });
    }

    // ── Écoute ───────────────────────────────────────────────

    function stopAudition() {
        if (audition) {
            clearInterval(audition.timer);
            audition.howl.unload();
            audition = null;
        }
        renderListenButton();
    }

    function startAudition(start, end) {
        stopAudition();
        stopLibraryPreview();
        if (!state.sourcePath || end - start < 0.05) return;

        const howl = createHowl({
            src: [toFileUrl(state.sourcePath)],
            html5: true,
            sprite: { part: [start * 1000, (end - start) * 1000] },
            onend: stopAudition,
            onloaderror: stopAudition,
            onplayerror: stopAudition,
        });
        howl.play('part');
        audition = {
            howl,
            timer: setInterval(() => {
                const position = howl.seek();
                if (typeof position === 'number') {
                    state.playhead = position;
                    renderTime();
                    draw();
                }
            }, 50),
        };
        renderListenButton();
    }

    // ── Interactions waveform ────────────────────────────────

    function eventTime(event) {
        const rect = canvas.getBoundingClientRect();
        return xToTime(event.clientX - rect.left, state.view, rect.width);
    }

    function cutAt(event) {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const index = state.cuts.findIndex(cut => Math.abs(timeToX(cut, state.view, rect.width) - x) <= CUT_HIT_PX);
        return index === -1 ? null : index;
    }

    canvas.addEventListener('mousedown', event => {
        if (!state.peaks) return;
        canvas.focus();
        const index = cutAt(event);
        if (index !== null) {
            state.selectedCut = index;
            drag = { index };
        } else {
            state.selectedCut = null;
            state.playhead = Math.min(Math.max(0, eventTime(event)), state.duration);
            if (audition) startAudition(state.playhead, state.duration);
        }
        refresh();
    });

    window.addEventListener('mousemove', event => {
        if (!drag) return;
        state.cuts = moveCut(state.cuts, drag.index, eventTime(event), state.duration);
        renderSegments();
        draw();
    });

    window.addEventListener('mouseup', () => {
        drag = null;
    });

    canvas.addEventListener('wheel', event => {
        if (!state.peaks) return;
        event.preventDefault();
        if (event.ctrlKey) {
            const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
            state.view = zoomView(state.view, factor, eventTime(event), state.duration);
        } else {
            const span = state.view.end - state.view.start;
            const delta = (event.deltaX || event.deltaY) / canvas.getBoundingClientRect().width * span;
            state.view = scrollView(state.view, delta, state.duration);
        }
        renderScroll();
        draw();
    }, { passive: false });

    canvas.addEventListener('keydown', event => {
        if (state.selectedCut === null || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -NUDGE_SECONDS : NUDGE_SECONDS;
        state.cuts = moveCut(state.cuts, state.selectedCut, state.cuts[state.selectedCut] + delta, state.duration);
        refresh();
    });

    // ── Barre d'outils et actions ────────────────────────────

    $('split-scroll').addEventListener('input', event => {
        const span = state.view.end - state.view.start;
        state.view = scrollView({ start: Number(event.target.value), end: Number(event.target.value) + span }, 0, state.duration);
        draw();
    });

    const zoomAroundCenter = factor => {
        const center = (state.view.start + state.view.end) / 2;
        state.view = zoomView(state.view, factor, center, state.duration);
        renderScroll();
        draw();
    };
    $('split-zoom-in').addEventListener('click', () => zoomAroundCenter(ZOOM_STEP));
    $('split-zoom-out').addEventListener('click', () => zoomAroundCenter(1 / ZOOM_STEP));

    $('split-listen').addEventListener('click', () => {
        if (audition) stopAudition();
        else startAudition(state.playhead, state.duration);
    });

    $('split-cut').addEventListener('click', () => {
        const result = addCut(state.cuts, state.playhead, state.duration);
        if (!result) {
            state.error = { key: 'split.errorCutTooClose' };
        } else {
            state.names = splitNames(state.names, result.index);
            state.cuts = result.cuts;
            state.selectedCut = result.index;
            state.error = null;
        }
        refresh();
    });

    $('split-choose-file').addEventListener('click', async () => {
        const [sourcePath] = await electronAPI.openFiles();
        if (sourcePath) await loadSource(sourcePath, null);
    });

    $('split-cancel').addEventListener('click', () => {
        stopAudition();
        state = emptyState();
        refresh();
    });

    $('split-submit').addEventListener('click', async () => {
        const title = $('split-title').value.trim();
        const ranges = cutsToRanges(state.cuts, state.duration);
        state.error = validateSplit({ title, ranges, names: state.names, reservedNames: state.reservedNames });
        if (state.error) {
            refresh();
            return;
        }

        const segments = rangesToSegments(ranges, state.names);
        try {
            if (state.editingTrack) {
                const plan = planSegmentUpdate(state.editingTrack, segments);
                await electronAPI.updateSegments(state.editingTrack.id, plan.segments, plan.defaultVersion);
            } else {
                const playlists = Array.from(root.querySelectorAll('#split-playlists input:checked')).map(cb => cb.value);
                await electronAPI.addSegmentedTrack({ title, sourcePath: state.sourcePath, segments }, playlists);
            }
        } catch (error) {
            console.error('❌ Découpage : enregistrement impossible', error);
            state.error = { key: 'split.errorSave' };
            refresh();
            return;
        }

        const messageKey = state.editingTrack ? 'split.saved' : 'split.added';
        stopAudition();
        state = { ...emptyState(), message: { key: messageKey, vars: { title } } };
        refresh();
        await onSaved();
    });

    new ResizeObserver(() => draw()).observe(canvas);
    refresh();

    return {
        /** Retouche d'une piste découpée (bouton ✂ de la bibliothèque) */
        openTrack(track) {
            const segmentedName = Object.keys(track.segments || {})[0];
            const sourcePath = segmentedName && track.localPaths?.[segmentedName];
            if (sourcePath) loadSource(sourcePath, track);
        },
        /** L'onglet devient visible : le canvas a enfin une taille */
        onShow: draw,
        /** Changement de langue */
        refresh,
    };
}
```

- [ ] **Step 5: Branchement dans `frontend/renderer.js`**

a) Import, avec les autres imports `./` :

```js
import { createCutterView } from './cutterView.js';
```

b) Sous `let editingVersions = [];`, ajouter :

```js
let cutterView = null; // onglet Découpage (#24), créé au DOMContentLoaded
```

c) Déplacer `switchView` hors du `DOMContentLoaded` (au niveau module, juste avant `document.addEventListener('DOMContentLoaded', …)`), en notifiant l'onglet Découpage :

```js
function switchView(viewName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const tab = document.querySelector(`.tab-btn[data-view="${viewName}"]`);
    if (tab) tab.classList.add('active');
    const view = document.getElementById(`${viewName}-view`);
    if (view) view.classList.remove('hidden');
    if (viewName === 'decoupage' && cutterView) cutterView.onShow();
}
```
et supprimer l'ancienne définition locale dans le `DOMContentLoaded`.

d) Dans le `DOMContentLoaded`, juste après `init();` :

```js
    cutterView = createCutterView({
        root: document.getElementById('decoupage-view'),
        electronAPI: window.electronAPI,
        t,
        createHowl: options => new Howl(options),
        stopLibraryPreview: () => previewState.cancel(),
        onSaved: async () => {
            await loadLibrary();
            await loadPlaylists();
            if (currentPlaylistId) await loadPlaylist(currentPlaylistId); // reconstruit la piste retouchée (#32)
        },
    });
```

e) `loadPlaylist()` : dans le `tracksConfig`, ajouter `segments: t.segments,` après `versions: …`.

f) `renderLibraryList()` : dans le gabarit de `.track-actions`, avant le bouton d'édition, ajouter

```js
                ${Object.keys(track.segments || {}).length > 0 ? `<button class="split-track-btn secondary-btn" data-id="${track.id}" title="${t('library.splitTrack')}">✂</button>` : ''}
```
et, après l'écouteur de `.edit-track-btn` :

```js
        // Retouche de la découpe (#24)
        const splitBtn = div.querySelector('.split-track-btn');
        if (splitBtn) {
            splitBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                switchView('decoupage');
                cutterView.openTrack(track);
            });
        }
```

g) Dans l'écouteur de clic `#language-grid .theme-card`, après `updateUI();`, ajouter `cutterView?.refresh();`.

- [ ] **Step 6: Tests et build**

Run: `npm test && npx vite build`
Expected: PASS, build OK.

- [ ] **Step 7: Vérification navigateur (mock)**

1. Générer un fichier de test : `mkdir -p frontend/__t24 && python3 -c "import wave,struct,math; w=wave.open('frontend/__t24/test.wav','w'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050); w.writeframes(b''.join(struct.pack('<h', int((8000 if (i//22050)%4<2 else 2000)*math.sin(2*math.pi*220*i/22050))) for i in range(22050*20))); w.close()"`.
2. Injecter avant `<script src="./renderer.js" type="module">` de `frontend/index.html` un `<script>/*MOCK24*/ … </script>` définissant `window.electronAPI` : `getSettings` → `{}`, `getAllPlaylists` → `[{ id: 'p1', name: 'Donjon', trackIds: [] }]`, `getLibrary` → `[]`, `openFiles` → `['http://localhost:3000/__t24/test.wav']`, `readAudioFile` → `fetch(path).then(r => r.arrayBuffer()).then(b => new Uint8Array(b))`, `addSegmentedTrack` → `console.log('ADD', JSON.stringify(arguments))`, `onShortcut` → no-op, le reste → `async () => ({ success: true })` (Proxy).
3. `npx vite --port 3000`, ouvrir `http://localhost:3000`, onglet Découpage :
   - « Choisir un fichier » → waveform visible (volume alterné toutes les 2 s), `0:00.0 / 0:20.0` ;
   - clic à ~5 s puis « Couper ici » → 2 segments ; déplacer le ◆ à la souris ; ←/→ après sélection → ±0,1 s ;
   - Ctrl+molette → zoom jusqu'à 4 s visibles, barre de défilement active ;
   - « Couper ici » à < 0,5 s d'un marqueur → message d'erreur dans l'onglet ;
   - nommer « Calm » / « calm » → erreur « déjà utilisé » ; corriger, cocher Donjon, Ajouter → log `ADD` avec `segments` attendus et message de confirmation ;
   - passer en anglais dans Réglages → libellés de l'onglet traduits ;
   - thème « parchemin » → waveform lisible (couleurs du thème).
4. Nettoyer : retirer le bloc `MOCK24`, `rm -rf frontend/__t24`, arrêter Vite ; `git status --short` ne doit lister que les fichiers de la tâche.

L'écoute (Howl `file://`) n'est pas vérifiable dans Chrome depuis `http://localhost` : à confirmer dans l'app.

- [ ] **Step 8: Commit**

```bash
git add frontend/cutterView.js frontend/index.html frontend/styles.css frontend/renderer.js backend/i18n.js
git commit -m "feat(split): onglet Découpage à la place d'Effets (closes #24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Documentation et suivi

**Files:**
- Modify: `CLAUDE.md`, `AGENTS.md`

- [ ] **Step 1: CLAUDE.md et AGENTS.md (identiques)**

- Section « Stack technique actuelle » : sous la ligne `Durée de fondu d'un track (depuis #28)…`, ajouter :
  `- Versions découpées (depuis #24) : \`segments: { version: { start, end } }\` (secondes), toujours lu via \`track.segments || {}\`. Toutes les versions découpées pointent sur le même fichier (\`music/<id>_source<ext>\`) : ne supprimer un fichier que si \`isPathSharedByOtherVersion\` (\`backend/segments.js\`) est faux. Lecture par sprite Howler \`segment\` ; temps/durée/seek de \`Track\` relatifs au segment ; un fondu vers une version découpée démarre au début de son segment`
- Section « Fonctionnalités à implémenter » → « Prioritaire — Découpe de piste en versions » : remplacer le paragraphe par `Fait (#24) : onglet Découpage — voir \`docs/superpowers/specs/2026-09-28-decoupage-design.md\`.` et retirer les puces obsolètes (le stockage est un objet indexé par version, pas un tableau).
- « Notes importantes » : ajouter `- **Howler — seek après play** : \`stop()\` puis \`play()\` recycle le son (\`reset()\`, position 0) ; un \`seek()\` fait avant \`play()\` est perdu. Toujours \`const id = howl.play(…); howl.seek(position, id)\`. Getter : \`howl.seek()\` sans argument (un id périmé serait pris pour une position)`.
- Suivi GitHub : déplacer #24 dans « Terminées », ajouter #32 dans « Terminées » (`— \`loadPlaylist\` reconstruit une piste dont les versions/fichiers/segments ont changé`).

Run: `cmp CLAUDE.md AGENTS.md && echo identiques`
Expected: `identiques`

- [ ] **Step 2: Commit et push**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: pistes découpées et seek Howler (#24, #32)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 3: Issues et Project**

- `gh issue comment 24` puis vérifier `gh issue view 24 --json state` = `CLOSED` (fermée par le commit de la Task 7) ; idem #32 (Task 3).
- Project : #24 et #32 → Done (`gh project item-edit --project-id PVT_kwHOB4sxV84BkLXF --id <item> --field-id PVTSSF_lAHOB4sxV84BkLXFzhi830k --single-select-option-id 98236657`).
