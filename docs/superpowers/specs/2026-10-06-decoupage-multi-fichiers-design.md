# Découpage multi-fichiers — design (#45)

Date : 2026-10-06 · Issue : [#45](https://github.com/RAbdGen/JukeBox_DnD/issues/45) · Prolonge : `2026-09-28-decoupage-design.md` (#24)

## Objectif

Découper **plusieurs fichiers sources** dans une même piste. Exemple : `exploration.mp3` → `calm` + `tension`, `boss.mp3` → `combat` + `victoire` : une seule piste à 4 versions, avec fondu entre elles comme toute piste.

Critères de succès :
- créer une telle piste depuis l'onglet Découpage, et la retoucher (✂) : ajouter, redécouper ou retirer un fichier ;
- ✂ disponible sur **toute** piste, y compris une piste « fichiers entiers » (on peut lui ajouter un fichier découpé) ;
- aucune migration de `data.json`, aucune régression sur les pistes existantes.

Hors périmètre : découper un fichier déjà présent comme version entière (il reste entier), mettre des fichiers bout à bout.

## 1. Données

Inchangées. `localPaths[v]` et `segments[v]` sont déjà par version, et `Track` crée déjà un Howl par version : la lecture d'une piste à plusieurs sources fonctionne sans modification.

**Source** : notion dérivée, jamais stockée. Les versions découpées qui pointent sur le même `localPath` forment une source.

```js
// backend/segments.js
sourceGroups(track) → [{ localPath, originalPath, names: [...] }]
```
- ordre : première apparition dans `localPaths` (= ordre des onglets enregistré) ;
- `names` triés par début de segment ;
- les versions sans segment (fichiers entiers) n'appartiennent à aucune source.

## 2. IPC et backend

### Création
`library:addSegmentedTrack({ title, sources: [{ sourcePath, segments }] }, playlists)`
- chaque fichier copié une fois : `copyAudioFile(sourcePath, id, 'source', déjàCopiés)` → `<id>_source.mp3`, `<id>_source_2.ogg`… ;
- `buildSegmentedTrack` accepte `sources: [{ sourcePath, localPath, segments }]` ;
- échec avant enregistrement : **toutes** les copies supprimées (comme #34).

### Retouche
`library:updateSources(trackId, sources)` remplace `library:updateSegments`.
- une source existante : `{ localPath, segments }` (le `localPath` doit appartenir à la piste, sinon rejet) ;
- une nouvelle source : `{ sourcePath, segments }`, copiée par le main process avant l'appel à la base ;
- `DatabaseManager.updateSources` valide **tout** avant de modifier quoi que ce soit (#34) : bornes (`sanitizeSegments`), noms uniques sur toute la piste (sans casse, versions entières comprises), au moins une version restante. Sinon : exception, rien de modifié, et le main process supprime les fichiers qu'il vient de copier ;
- `applySourcesUpdate(track, sources)` (pur, remplace `applySegmentUpdate`) reconstruit `localPaths`, `originalPaths`, `segments` des versions découpées ; les versions entières sont gardées telles quelles ;
- fichiers devenus inutilisés (source retirée) : renvoyés par `updateSources`, supprimés par le main process via `FileManager.deleteAudioFile`, seulement s'ils ne servent plus à aucune version.

### Ordre des versions
Sources dans l'ordre des onglets, versions par début de segment, puis versions entières (règle de #24 étendue).

### Version de lancement
- renommée dans sa source (même position) : elle suit son segment — `planSegmentUpdate` travaille désormais sur `launchVersion` (il mettait à jour `defaultVersion`, plus lu depuis #25) ;
- disparue : supprimée, `resolveLaunchVersion` reprend la première version ;
- `tempo` des versions renommées/retirées nettoyé comme aujourd'hui (`setTempo`).

## 3. Interface (onglet Découpage)

### Onglets de fichiers
Modèle Tabs shadcn/Radix, en vanilla :
- `role="tablist"` / `tab` / `tabpanel`, `aria-selected`, `aria-controls`, tabindex itinérant (un seul onglet atteignable par Tab) ;
- ←/→ (en boucle), Début/Fin ; activation au focus ;
- logique pure `tabsKeyTarget(key, index, count)` dans `frontend/tabs.js` ;
- libellé = nom du fichier ; **« + Ajouter un fichier »** après la liste (dialogue existant) ;
- **« Retirer ce fichier »** dans la barre d'outils de l'onglet (pas de ✕ dans un `tab`), confirmation si le fichier a des versions nommées ; retirer le dernier onglet d'une création revient à l'état vide.

### État
- par onglet : `sourcePath` ou `localPath`, `fileName`, `duration`, `peaks`, `cuts`, `names`, `view`, `playhead`, `selectedCut` ;
- commun : titre, playlists, piste en retouche, versions entières réservées, `dirty`, erreur, écoute (une seule, arrêtée au changement d'onglet) ;
- mémoire (#36) : l'audio décodé n'est gardé que le temps de calculer les pics ; seuls les pics restent par onglet (quelques Ko) ;
- `createLatestOnly` : un chargement par onglet, le dernier gagne.

### Récapitulatif
Sous les onglets : « Versions de la piste : calm · tension · combat · victoire », puis versions entières en `--bone-dim`.

### Validation
`validateSplit` étendu à plusieurs sources :
- nom en double : `split.errorDuplicateIn` (« "combat" est déjà utilisé dans boss.mp3 ») et l'onglet fautif est affiché ;
- au moins une version sur la piste (versions entières comprises) ;
- segment trop court, titre vide : inchangés.

### ✂ sur toute piste
- bouton présent sur toutes les lignes de la bibliothèque ;
- piste sans découpe : retouche sans onglet, récapitulatif de ses versions entières, « + Ajouter un fichier » ;
- piste découpée : un onglet par source ; un fichier manquant/illisible donne un onglet en erreur (`split.loadError`), sans bloquer les autres.

### Règles du projet
`setTooltip` / `data-i18n*` (clés fr+en, parité), jetons de durée, couleurs par variables (test de contraste), styles dans `frontend/styles/cutter.css` (< 40 Ko), aucun `title` natif.

## 4. Tests

- `segments.js` : `sourceGroups`, `buildSegmentedTrack` multi-sources, `applySourcesUpdate` (ajout, retrait, renommage, versions entières conservées, conflit de nom) ;
- `segmentModel.js` : validation multi-sources, `planSegmentUpdate` sur `launchVersion` ;
- `tabs.js` : `tabsKeyTarget` ;
- `DatabaseManager.updateSources` : rejet atomique, `localPath` étranger refusé, fichiers inutilisés renvoyés, partagés conservés ;
- HTML : rôles ARIA de la liste d'onglets ;
- vérification manuelle dans Electron : piste à deux fichiers, fondu entre versions de fichiers différents, retouche, retrait d'un fichier.
