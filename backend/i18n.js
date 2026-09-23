/**
 * Dictionnaires de traduction fr/en (#22) et fonctions de lookup partagées
 * entre le renderer et le processus main. Fichiers maison, pas de lib
 * externe (règle CLAUDE.md : rester vanilla JS).
 *
 * Convention de clés : zone.sousClé, en camelCase. Une clé absente d'une
 * langue retombe sur le français, puis sur la clé elle-même (jamais un
 * écran vide).
 */

export const SUPPORTED_LANGUAGES = ['fr', 'en'];
export const DEFAULT_LANGUAGE = 'fr';

const fr = {
    'app.name': 'Jukebox JDR',
    'app.tagline': 'Maître · du · Jeu',
    'app.loading': 'Ouverture du grimoire…',
    'app.footerTagline': 'Par votre Maître du Jeu',

    'nav.player': 'Lecture',
    'nav.library': 'Grimoire',
    'nav.effects': 'Effets',
    'nav.settings': 'Réglages',

    'player.nowCasting': "En cours d'incantation",
    'player.noTrack': 'Aucune piste',
    'player.trackCounter': 'Piste {current}/{total}',
    'player.versionLabel': 'Version :',
    'player.breadcrumbLibrary': '← Grimoire Sonore',
    'player.playlistMeta': 'Liste de lecture · {count} piste(s)',

    'controls.changePlaylist': 'Changer de playlist',
    'controls.createPlaylist': 'Créer une playlist',
    'controls.deletePlaylist': 'Supprimer la playlist',
    'controls.prevTrack': 'Piste précédente',
    'controls.stop': 'Arrêter',
    'controls.playPause': 'Lecture / Pause',
    'controls.nextTrack': 'Piste suivante',
    'controls.volumeLabel': 'Vol',
    'controls.modeNormal': 'Normal',
    'controls.modeLoopOne': 'Boucle une piste',
    'controls.modeLoopAll': 'Tout répéter',

    'tracklist.header': 'Pistes du Grimoire',
    'tracklist.emptyMain': 'Aucune piste. Chargez une playlist.',
    'tracklist.emptyPlaylist': 'Aucune piste dans cette playlist.',
    'tracklist.emptyNoPlaylist': 'Aucune playlist.',
    'tracklist.playlistNotFound': 'Playlist vide ou introuvable.',
    'tracklist.noVersionAvailable': 'Aucune version disponible',
    'tracklist.moveUp': 'Monter',
    'tracklist.moveDown': 'Descendre',
    'tracklist.removeFromPlaylist': 'Retirer de la playlist',

    'status.playing': 'En lecture',
    'status.paused': 'En pause',
    'status.stopped': 'Arrêté',

    'version.calm': 'Calme',
    'version.combat': 'Combat',
    'version.tension': 'Tension',

    'preview.play': 'Préécouter',
    'preview.stop': 'Arrêter le preview',

    'library.header': 'Grimoire Sonore',
    'library.addTrack': '＋ Ajouter une piste',
    'library.searchPlaceholder': 'Rechercher par titre ou tag…',
    'library.empty': 'Bibliothèque vide. Cliquez sur "Ajouter une piste" pour commencer.',
    'library.noSearchResults': 'Aucune piste ne correspond à la recherche.',
    'library.addToPlaylist': 'Ajouter à la playlist active',
    'library.editTrack': 'Modifier le volume',
    'library.versionsCount': '{versions} version(s) • {playlists} playlist(s)',

    'effects.title': 'Effets Sonores',
    'effects.comingSoon': 'Fonctionnalité à venir...',

    'settings.appearanceTitle': 'Apparence',
    'settings.themeLabel': "Thème de l'interface",
    'settings.libraryTitle': 'Bibliothèque',
    'settings.libraryDescription': 'Sauvegarder ou restaurer la bibliothèque (pistes + playlists + fichiers audio), pour synchroniser entre le dual-boot ou partager avec un autre joueur.',
    'settings.exportBtn': 'Exporter la bibliothèque',
    'settings.importBtn': 'Importer une bibliothèque',
    'settings.languageTitle': 'Langue',
    'settings.languageFr': 'Français',
    'settings.languageEn': 'English',

    'themes.nuit': 'Nuit',
    'themes.grimoire': 'Grimoire',
    'themes.taverne': 'Taverne',
    'themes.arcane': 'Arcane',
    'themes.foret': 'Forêt',
    'themes.sang': 'Sang',
    'themes.glace': 'Givre',
    'themes.parchemin': 'Parchemin',

    'modal.addTrack.title': 'Ajouter une musique',
    'modal.addTrack.titleLabel': 'Titre de la piste *',
    'modal.addTrack.titlePlaceholder': 'Ex: Taverne Médiévale',
    'modal.addTrack.versionsLabel': 'Versions audio',
    'modal.addTrack.versionNamePlaceholder': 'Nom (calm, combat...)',
    'modal.addTrack.versionNamePlaceholderShort': 'Nom',
    'modal.addTrack.selectFile': 'Fichier',
    'modal.addTrack.noFile': 'Aucun fichier',
    'modal.addTrack.changeFile': 'Modifier',
    'modal.addTrack.addVersionBtn': '+ Ajouter une version',
    'modal.addTrack.volumeLabel': 'Volume par défaut',
    'modal.addTrack.addToPlaylists': 'Ajouter aux playlists',
    'modal.addTrack.newPlaylistPlaceholder': 'Nouvelle playlist...',
    'modal.addTrack.createBtn': 'Créer',
    'modal.addTrack.cancelBtn': 'Annuler',
    'modal.addTrack.submitBtn': 'Ajouter la piste',
    'modal.addTrack.submitting': 'Ajout...',
    'modal.addTrack.errorAdding': "Erreur lors de l'ajout",
    'modal.addTrack.titleRequired': 'Le titre est requis',
    'modal.addTrack.needOneVersion': 'Ajoutez au moins une version avec un fichier',

    'modal.createPlaylist.title': 'Nouvelle Playlist',
    'modal.createPlaylist.nameLabel': 'Nom de la playlist',
    'modal.createPlaylist.namePlaceholder': 'Ex: Ambiance Donjon',

    'modal.editTrack.title': 'Modifier la piste',
    'modal.editTrack.titleLabel': 'Titre',
    'modal.editTrack.versionsLabel': 'Versions',
    'modal.editTrack.versionNamePlaceholder': 'Nom (combat...)',
    'modal.editTrack.newVersionSuffix': ' (nouvelle)',
    'modal.editTrack.removeVersion': 'Retirer cette version',
    'modal.editTrack.addVersionBtn': '+ Ajouter une version',
    'modal.editTrack.volumeLabel': 'Volume par défaut',
    'modal.editTrack.crossfadeLabel': 'Durée du fondu entre versions',
    'modal.editTrack.tagsLabel': 'Tags',
    'modal.editTrack.tagsPlaceholder': 'forêt, ambiance, jour',
    'modal.editTrack.deleteBtn': 'Supprimer',
    'modal.editTrack.saveBtn': 'Sauvegarder',
    'modal.editTrack.confirm': 'Confirmer',
    'modal.editTrack.cancel': 'Annuler',
    'modal.editTrack.versionNameRequired': 'Le nom de la version est requis',
    'modal.editTrack.duplicateVersionName': 'Une version porte déjà ce nom',
    'modal.editTrack.selectAudioFile': 'Sélectionnez un fichier audio',
    'modal.editTrack.saveVersionsError': 'Erreur lors de la sauvegarde des versions',

    'toast.undoBtn': 'Annuler',
    'toast.trackDeleted': 'Piste "{title}" supprimée.',
    'toast.playlistDeleted': 'Playlist "{name}" supprimée.',

    'playlist.defaultOption': '-- Choisir une playlist --',
    'playlist.optionLabel': '{name} ({count} pistes)',
    'playlist.fallbackName': 'la playlist',

    'export.inProgress': 'Export en cours…',
    'export.success': '✅ {trackCount} piste(s), {playlistCount} playlist(s) exportées vers {path}',
    'export.error': "❌ Erreur lors de l'export",
    'import.inProgress': 'Import en cours…',
    'import.success': '✅ {tracksAdded} piste(s) ajoutée(s) ({tracksSkipped} déjà présente(s)), {playlistsAdded} playlist(s) ajoutée(s), {playlistsMerged} fusionnée(s)',
    'import.error': "❌ Erreur lors de l'import",

    'dialog.selectAudioFiles': 'Sélectionner des fichiers audio',
    'dialog.selectMusicFolder': 'Sélectionner un dossier de musique',
    'dialog.selectExportDestination': "Choisir le dossier de destination de l'export",
    'dialog.selectImportFolder': 'Choisir le dossier exporté à importer',
};

const en = {
    'app.name': 'Jukebox RPG',
    'app.tagline': 'Game · Master',
    'app.loading': 'Opening the grimoire…',
    'app.footerTagline': 'By your Game Master',

    'nav.player': 'Playback',
    'nav.library': 'Grimoire',
    'nav.effects': 'Effects',
    'nav.settings': 'Settings',

    'player.nowCasting': 'Now Casting',
    'player.noTrack': 'No track',
    'player.trackCounter': 'Track {current}/{total}',
    'player.versionLabel': 'Version:',
    'player.breadcrumbLibrary': '← Sound Grimoire',
    'player.playlistMeta': 'Playlist · {count} track(s)',

    'controls.changePlaylist': 'Change playlist',
    'controls.createPlaylist': 'Create a playlist',
    'controls.deletePlaylist': 'Delete playlist',
    'controls.prevTrack': 'Previous track',
    'controls.stop': 'Stop',
    'controls.playPause': 'Play / Pause',
    'controls.nextTrack': 'Next track',
    'controls.volumeLabel': 'Vol',
    'controls.modeNormal': 'Normal',
    'controls.modeLoopOne': 'Loop one track',
    'controls.modeLoopAll': 'Repeat all',

    'tracklist.header': 'Grimoire Tracks',
    'tracklist.emptyMain': 'No tracks. Load a playlist.',
    'tracklist.emptyPlaylist': 'No tracks in this playlist.',
    'tracklist.emptyNoPlaylist': 'No playlist.',
    'tracklist.playlistNotFound': 'Playlist empty or not found.',
    'tracklist.noVersionAvailable': 'No version available',
    'tracklist.moveUp': 'Move up',
    'tracklist.moveDown': 'Move down',
    'tracklist.removeFromPlaylist': 'Remove from playlist',

    'status.playing': 'Playing',
    'status.paused': 'Paused',
    'status.stopped': 'Stopped',

    'version.calm': 'Calm',
    'version.combat': 'Combat',
    'version.tension': 'Tension',

    'preview.play': 'Preview',
    'preview.stop': 'Stop preview',

    'library.header': 'Sound Grimoire',
    'library.addTrack': '＋ Add a track',
    'library.searchPlaceholder': 'Search by title or tag…',
    'library.empty': 'Empty library. Click "Add a track" to get started.',
    'library.noSearchResults': 'No track matches your search.',
    'library.addToPlaylist': 'Add to the active playlist',
    'library.editTrack': 'Edit volume',
    'library.versionsCount': '{versions} version(s) • {playlists} playlist(s)',

    'effects.title': 'Sound Effects',
    'effects.comingSoon': 'Coming soon...',

    'settings.appearanceTitle': 'Appearance',
    'settings.themeLabel': 'Interface theme',
    'settings.libraryTitle': 'Library',
    'settings.libraryDescription': 'Back up or restore your library (tracks + playlists + audio files), to sync across your dual-boot or share with another player.',
    'settings.exportBtn': 'Export library',
    'settings.importBtn': 'Import a library',
    'settings.languageTitle': 'Language',
    'settings.languageFr': 'Français',
    'settings.languageEn': 'English',

    'themes.nuit': 'Night',
    'themes.grimoire': 'Grimoire',
    'themes.taverne': 'Tavern',
    'themes.arcane': 'Arcane',
    'themes.foret': 'Forest',
    'themes.sang': 'Blood',
    'themes.glace': 'Frost',
    'themes.parchemin': 'Parchment',

    'modal.addTrack.title': 'Add a track',
    'modal.addTrack.titleLabel': 'Track title *',
    'modal.addTrack.titlePlaceholder': 'E.g. Medieval Tavern',
    'modal.addTrack.versionsLabel': 'Audio versions',
    'modal.addTrack.versionNamePlaceholder': 'Name (calm, combat...)',
    'modal.addTrack.versionNamePlaceholderShort': 'Name',
    'modal.addTrack.selectFile': 'File',
    'modal.addTrack.noFile': 'No file',
    'modal.addTrack.changeFile': 'Change',
    'modal.addTrack.addVersionBtn': '+ Add a version',
    'modal.addTrack.volumeLabel': 'Default volume',
    'modal.addTrack.addToPlaylists': 'Add to playlists',
    'modal.addTrack.newPlaylistPlaceholder': 'New playlist...',
    'modal.addTrack.createBtn': 'Create',
    'modal.addTrack.cancelBtn': 'Cancel',
    'modal.addTrack.submitBtn': 'Add track',
    'modal.addTrack.submitting': 'Adding...',
    'modal.addTrack.errorAdding': 'Error while adding',
    'modal.addTrack.titleRequired': 'Title is required',
    'modal.addTrack.needOneVersion': 'Add at least one version with a file',

    'modal.createPlaylist.title': 'New Playlist',
    'modal.createPlaylist.nameLabel': 'Playlist name',
    'modal.createPlaylist.namePlaceholder': 'E.g. Dungeon Ambiance',

    'modal.editTrack.title': 'Edit Track',
    'modal.editTrack.titleLabel': 'Title',
    'modal.editTrack.versionsLabel': 'Versions',
    'modal.editTrack.versionNamePlaceholder': 'Name (combat...)',
    'modal.editTrack.newVersionSuffix': ' (new)',
    'modal.editTrack.removeVersion': 'Remove this version',
    'modal.editTrack.addVersionBtn': '+ Add a version',
    'modal.editTrack.volumeLabel': 'Default volume',
    'modal.editTrack.crossfadeLabel': 'Crossfade duration between versions',
    'modal.editTrack.tagsLabel': 'Tags',
    'modal.editTrack.tagsPlaceholder': 'forest, ambiance, day',
    'modal.editTrack.deleteBtn': 'Delete',
    'modal.editTrack.saveBtn': 'Save',
    'modal.editTrack.confirm': 'Confirm',
    'modal.editTrack.cancel': 'Cancel',
    'modal.editTrack.versionNameRequired': 'Version name is required',
    'modal.editTrack.duplicateVersionName': 'A version already has this name',
    'modal.editTrack.selectAudioFile': 'Select an audio file',
    'modal.editTrack.saveVersionsError': 'Error saving versions',

    'toast.undoBtn': 'Undo',
    'toast.trackDeleted': 'Track "{title}" deleted.',
    'toast.playlistDeleted': 'Playlist "{name}" deleted.',

    'playlist.defaultOption': '-- Choose a playlist --',
    'playlist.optionLabel': '{name} ({count} tracks)',
    'playlist.fallbackName': 'the playlist',

    'export.inProgress': 'Exporting…',
    'export.success': '✅ {trackCount} track(s), {playlistCount} playlist(s) exported to {path}',
    'export.error': '❌ Export error',
    'import.inProgress': 'Importing…',
    'import.success': '✅ {tracksAdded} track(s) added ({tracksSkipped} already present), {playlistsAdded} playlist(s) added, {playlistsMerged} merged',
    'import.error': '❌ Import error',

    'dialog.selectAudioFiles': 'Select audio files',
    'dialog.selectMusicFolder': 'Select a music folder',
    'dialog.selectExportDestination': 'Choose the export destination folder',
    'dialog.selectImportFolder': 'Choose the exported folder to import',
};

const dictionaries = { fr, en };

// Exporté pour les tests de parité entre dictionnaires (voir tests/i18n.test.js)
export const _dictionaries = dictionaries;

export function normalizeLanguage(lang) {
    return SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
}

/**
 * Traduit une clé pour une langue donnée. Retombe sur le français puis sur
 * la clé brute si absente — jamais d'écran vide même si une traduction
 * manque. `vars` remplace les `{placeholder}` dans la chaîne.
 */
export function t(lang, key, vars = {}) {
    const dict = dictionaries[normalizeLanguage(lang)];
    let str = dict[key] ?? dictionaries[DEFAULT_LANGUAGE][key] ?? key;
    for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{${k}}`, v);
    }
    return str;
}

export function getAppName(lang) {
    return t(lang, 'app.name');
}
