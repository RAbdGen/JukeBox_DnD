# Onglet « Découpage » : découper une musique en versions (#24)

Statut : design validé en conversation le 2026-09-28, spec à relire.
Issues : [#24](https://github.com/RAbdGen/JukeBox_DnD/issues/24) (feature), [#32](https://github.com/RAbdGen/JukeBox_DnD/issues/32) (bug corrigé au passage).

## 1. Objectif

Pouvoir créer une musique à plusieurs versions à partir d'**un seul fichier audio** qui contient déjà ses ambiances (ex. 0:00–1:30 calme, 1:30–3:00 combat), sans passer par un éditeur audio externe. Une version découpée se comporte comme une version classique : fondu, boucle unique, piste suivante, volume, pause/reprise.

Critères de succès :
- L'onglet « Effets » (placeholder) est remplacé par « Découpage » / « Split ».
- Choisir un fichier, poser des marqueurs à la souris sur une waveform zoomable, nommer les segments, ajouter à la bibliothèque (+ playlists) → une piste jouable immédiatement.
- Une piste découpée peut être rouverte dans l'onglet pour déplacer un marqueur ou renommer un segment.
- Le fichier source n'est **jamais** modifié sur le disque ; il est copié **une seule fois** dans `music/`.
- Les pistes existantes (versions = fichiers entiers) ne changent pas de comportement.

Hors scope : détection automatique des sections, time-stretching, édition du fichier audio, tags depuis l'onglet (ils se règlent ensuite dans la modal d'édition).

## 2. Décisions (validées)

| Sujet | Décision |
|---|---|
| Point de départ au changement de version pendant la lecture | La version cible **découpée** démarre au **début de son segment** (en fondu). Une cible « fichier entier » garde le comportement actuel (même timecode). |
| Modèle de découpe | **Points de coupe** : le fichier est coupé en tronçons consécutifs ; un tronçon **nommé** devient une version, un tronçon **vide** est ignoré. Pas de chevauchement ni de plages libres. |
| Retouche | Oui dès cette version : bouton ✂ sur une piste découpée → rouverte dans l'onglet, bouton « Enregistrer ». |
| Outils de précision | Waveform + **zoom** (＋/－, Ctrl+molette centré souris, jusqu'à ~4 s visibles) + défilement, écoute depuis un point, marqueurs déplaçables, nudge ±0,1 s au clavier, fin de segment éditable au dixième de seconde, écoute d'un segment. |
| Lecture d'un segment | **Un Howl par version avec un sprite** `[débutMs, duréeMs]` sur le fichier partagé (approche A). Pas de Howl partagé entre versions (refonte du moteur de #23 non rentable), pas de seek + minuteur maison (CLAUDE.md impose les sprites). |

## 3. Données (ajout additif, pas de migration)

```js
{
  id, title, defaultVersion, defaultVolume, crossfadeDurationSeconds, tags, metadata, inPlaylists,
  localPaths: { calm: '…/music/<id>_source.mp3', combat: '…/music/<id>_source.mp3' }, // même fichier
  segments:   { calm: { start: 0, end: 90 }, combat: { start: 90, end: 180 } },         // secondes
}
```

- `segments` est **optionnel**, toujours lu via `track.segments || {}`. Une version absente de `segments` est une version « fichier entier » : une piste peut mélanger les deux (ex. vrai fichier « boss » ajouté ensuite via la modal d'édition #15).
- Objet indexé par nom de version (et non tableau `[{ version, start, end }]` comme l'esquissait CLAUDE.md) : cohérent avec `localPaths`, compatible tel quel avec `reorderVersions` (#15) et l'export/import.
- Les **points de coupe ne sont pas stockés** : ils se déduisent des bornes des segments (toutes les valeurs `start`/`end` sauf 0 et la durée du fichier). Les tronçons ignorés sont les trous entre segments.
- Copie du fichier : `<trackId>_source<ext>` dans `music/`.
- Ordre des versions d'une piste découpée : segments dans l'ordre de la timeline, puis les versions « fichier entier » dans leur ordre existant.

### Fichier partagé — règles de suppression
- `library:removeVersion` ne supprime le fichier que si **aucune autre version** de la piste ne pointe dessus.
- `FileManager.deleteTrackFiles` **déduplique** les chemins avant suppression.
- Export : un fichier partagé est copié une fois (déjà idempotent, dédupliqué pour éviter les copies inutiles). Import : chaque version réécrit le même chemin local, déjà idempotent. `segments` est transporté tel quel ; à l'import il est validé (bornes numériques, `0 <= start < end`), un segment invalide est retiré (la version redevient « fichier entier »).

## 4. Lecture (moteur)

### Track
- Constructeur : `new Track(id, name, versionPaths, segments = {})`.
- `loadVersions()` : pour une version découpée, `new Howl({ src, html5: true, sprite: { segment: [startMs, durationMs] }, … })`. Les autres versions ne changent pas.
- Toute lecture d'une version découpée passe par le **nom du sprite** (`play('segment')`) : un `play()` sans nom jouerait le fichier entier.
- **Reprise après pause** : via l'**id du son** mémorisé (`play(soundId)`), jamais `play('segment')` qui repartirait du début du segment. Vaut aussi pour les versions « fichier entier » (remplace le `play()` sans argument).
- **Fondu** (`crossfade`) : cible découpée → démarre au début du segment, sans seek ; cible « fichier entier » → même timecode que la source (relatif au segment si la source est découpée). Toutes les règles de #23 (terminer / annuler un fondu, boucle sur toutes les versions, pas de double instance) restent inchangées.
- **Temps et durée** : `getCurrentTime()` et `getDuration()` sont **relatifs au segment** (0 → longueur du segment). `seek(position)` prend une position relative et ajoute `start`.
- **Changement de version en pause** : la position mémorisée pour la reprise suit la même règle que le fondu (cible découpée → début du segment).
- **Boucle unique** : `howl.loop(true)` s'applique au son du sprite ; Howler rejoue le segment (html5 : `stop(id).play(id)` conserve le sprite). En « Une fois » / « Boucle playlist », la fin du segment déclenche `onend` → piste suivante (on ne continue jamais dans le segment d'après).

### AudioManager (corrige aussi #32)
- La config de playlist transmet `segments`.
- `loadPlaylist` calcule pour chaque piste une **signature** insensible à l'ordre : ensemble des `(nomVersion, chemin, segment)`. Piste déjà chargée avec la même signature → instance conservée (garantie de #13), seul l'ordre des versions est remis à jour. Signature différente → la piste est **reconstruite** ; si c'était la piste en cours, elle est arrêtée proprement (fondu annulé, UI notifiée).

## 5. Onglet Découpage (UI)

```
┌ DÉCOUPAGE ─────────────────────────────────────────────────┐
│ [📂 Choisir un fichier]   theme_foret.mp3 · 3:12.0          │
│ ▁▃▅▇▅▃▂▁┃▂▄▆█▆▄▂▁▃▅▇▅▃▁┃▂▃▅▇▆▄▂▁   ← waveform (canvas)      │
│         ◆ 1:30.0       ◆ 2:45.5      │ tête de lecture      │
│ [━━━━━━━━━░░░░░░░░░░░░░░░░░░░]      ← défilement si zoomé   │
│ [－][＋] zoom   [▶ Écouter] [✂ Couper ici]   0:42.3 / 3:12.0 │
│ Segments                                                    │
│ 1  0:00.0 → [1:30.0]  [calm             ]  ▶                │
│ 2  1:30.0 → [2:45.5]  [combat           ]  ▶             ✕  │
│ 3  2:45.5 →  3:12.0   [ (vide = ignoré) ]  ▶             ✕  │
│ Titre [Thème de la forêt    ]   Playlists ☐ Donjon ☐ Forêt  │
│                              [Annuler] [Ajouter à la biblio]│
└─────────────────────────────────────────────────────────────┘
```

### Interactions
- **Choisir un fichier** : dialogue natif existant (`dialog:openFiles`), premier fichier retenu.
- **Waveform** : clic = place la tête de lecture (et la position d'écoute). Marqueurs ◆ déplaçables à la souris ; un marqueur cliqué est sélectionné, ←/→ le décale de 0,1 s. Un marqueur ne peut pas approcher un voisin (ou 0 / la fin) à moins de 0,5 s.
- **Zoom** : ＋/－ et Ctrl+molette (centré sur la souris), de « fichier entier » jusqu'à ~4 s visibles ; molette seule / barre = défilement horizontal.
- **✂ Couper ici** : pose un marqueur à la tête de lecture (refusé à moins de 0,5 s d'un marqueur existant ou d'une extrémité).
- **Segments** : fin éditable (champ texte `m:ss.d`, valeur invalide → revient à la précédente) = déplace le marqueur correspondant ; nom (placeholder « vide = ignoré ») ; ▶ écoute le segment ; ✕ supprime le marqueur de début du segment (fusion avec le précédent). Le dernier segment n'a pas de fin éditable, le premier pas de ✕.
- **Écoute** : Howl dédié (html5) sur le fichier source, qui coupe le preview bibliothèque (#16) ; n'interrompt pas le lecteur principal.
- **Validation** (au clic sur Ajouter / Enregistrer), messages dans l'onglet (pas d'`alert()`) : titre non vide ; au moins un segment nommé ; noms uniques (après trim) ; chaque segment nommé ≥ 0,5 s (garanti par les contraintes de marqueurs, revérifié).
- **Ajouter** : `library:addSegmentedTrack` ; succès → toast, bibliothèque et playlist active rechargées, onglet vidé.
- **Retouche** : bouton ✂ sur une ligne de bibliothèque dont `segments` n'est pas vide → bascule vers l'onglet, charge le fichier partagé, reconstruit marqueurs et noms (titre en lecture seule, pas de choix de playlists) ; bouton « Enregistrer » → `library:updateSegments`. Un segment renommé = version retirée + version ajoutée (même fichier) ; si `defaultVersion` est renommée elle suit, si elle disparaît elle devient la première version.
- **Changer d'onglet** conserve l'état de la découpe en cours ; « Annuler » le vide.
- Fichier illisible / non décodable → message dans l'onglet, rien d'autre ne change.

### Waveform
- Lecture du fichier par le processus main (`audio:readFile`, extensions audio uniquement) → `ArrayBuffer`.
- Décodage **mono à 8 kHz** via `OfflineAudioContext` (uniquement pour le dessin) : un fichier d'ambiance d'une heure tient en ~100 Mo au lieu de >1 Go en pleine qualité (machine de l'ami : 8 Go).
- Pics (min/max par tranche) calculés une fois à haute résolution ; seul l'intervalle visible est redessiné sur le canvas (redimensionné au conteneur, `devicePixelRatio`).
- Couleurs issues des variables CSS du thème actif (8 thèmes, dont « parchemin » clair).

## 6. Code

| Unité | Rôle | Dépend de |
|---|---|---|
| `frontend/segmentModel.js` | Pur : coupes ↔ segments, contraintes de marqueurs, validation, reconstruction depuis une piste, calcul des changements à la retouche (renommages, `defaultVersion`), format/parse `m:ss.d` | rien |
| `frontend/waveform.js` | `computePeaks()` (pur), `drawWaveform(canvas, peaks, view, colors)`, `decodeForWaveform(arrayBuffer)` | Web Audio (navigateur) |
| `frontend/cutterView.js` | Contrôleur de l'onglet, fabrique `createCutterView({ electronAPI, t, createHowl, stopLibraryPreview, onTrackSaved })` | les deux ci-dessus |
| `frontend/renderer.js` | Branche l'onglet, le bouton ✂ de la bibliothèque, rechargements après ajout/retouche | cutterView |
| `backend/Track.js` | Sprites, ids de son, temps relatifs | Howler |
| `backend/AudioManager.js` | `segments` dans la config, signature + reconstruction (#32) | Track |
| `backend/DatabaseManager.js` | `addSegmentedTrack`, `updateSegments`, validation `segments` à l'import | — |
| `backend/FileManager.js` | Dédoublonnage des chemins (suppression, export) | — |
| `electron/main.cjs` + `preload.cjs` | IPC `audio:readFile`, `library:addSegmentedTrack`, `library:updateSegments` ; `removeVersion` respecte le fichier partagé | — |
| `backend/i18n.js`, `index.html`, `styles.css` | Onglet, libellés fr/en (parité), styles thémés | — |

`index.html` : la vue `#effets-view` devient `#decoupage-view` (clé `nav.split`), les clés `effects.*` sont retirées des deux dictionnaires.

## 7. Tests

Écrits avant le code correspondant (TDD, comme #23) :
- `tests/segmentModel.test.js` : coupes ↔ segments, tronçons ignorés, contraintes 0,5 s, validation (titre, aucun nom, doublons), reconstruction depuis une piste (y compris trous), renommage + `defaultVersion`, parse/format `m:ss.d`.
- `tests/waveform.test.js` : `computePeaks` (min/max, silence, taille non multiple).
- `tests/Track.test.js` (FakeHowl étendu : sprites, ids) : lecture du sprite, fondu vers début de segment, cible « fichier entier » au même timecode, reprise par id (pas depuis le début), temps/durée/seek relatifs, boucle du segment, fin de segment → `onEndCallback`.
- `tests/AudioManager.test.js` : signature identique → même instance (#13) ; versions ou segments changés → reconstruction et arrêt si en cours (#32) ; simple réordonnancement → pas de reconstruction.
- `tests/DatabaseManager.test.js` : `addSegmentedTrack`, `updateSegments` (renommage, suppression, `defaultVersion`, versions « fichier entier » intactes), segments invalides à l'import.
- `tests/i18n.test.js` : parité fr/en (existant).
- Vérification navigateur (mock `electronAPI`, fichier de test servi par Vite) : chargement, waveform, zoom, marqueurs, validation, ajout. Écoute à confirmer à l'oreille dans l'app (Chrome ne charge pas l'audio dans un onglet masqué).

## 8. Livraison

Commits intermédiaires, chacun testable seul :
1. Moteur : `Track` sprites + `AudioManager` signature (ferme #32).
2. Données et IPC : `DatabaseManager`, `FileManager`, `main.cjs`, `preload.cjs`.
3. Onglet Découpage : `segmentModel`, `waveform`, `cutterView`, HTML/CSS/i18n, branchement renderer (ferme #24).

Puis CLAUDE.md/AGENTS.md (schéma `segments`, règles fichier partagé, section « Découpe de piste » mise à jour), issues et Project.
