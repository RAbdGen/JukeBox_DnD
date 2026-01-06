import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Gestionnaire de base de données avec lowdb
 * NOUVELLE ARCHITECTURE v2.0 : library + playlists séparées
 */
export class DatabaseManager {
    constructor(userDataPath = null) {
        this.db = null;
        this.dbPath = userDataPath
            ? path.join(userDataPath, 'data.json')
            : path.join(__dirname, '..', 'data.json');
    }

    async init() {
        try {
            console.log(`📀 Initialisation de la DB: ${this.dbPath}`);

            const adapter = new JSONFile(this.dbPath);
            this.db = new Low(adapter, this.getDefaultData());

            await this.db.read();

            if (!this.db.data || Object.keys(this.db.data).length === 0) {
                this.db.data = this.getDefaultData();
                await this.db.write();
                console.log('✅ DB initialisée (v2.0)');
            } else {
                // Migration de v1 à v2 si nécessaire
                if (!this.db.data.library) {
                    await this.migrateToV2();
                }
                console.log('✅ DB chargée avec succès');
            }
        } catch (error) {
            console.error('❌ Erreur initialisation DB:', error);
            throw error;
        }
    }

    getDefaultData() {
        return {
            library: [],      // Bibliothèque de toutes les pistes
            playlists: [      // Playlists avec IDs de tracks
                {
                    id: 'default',
                    name: 'Ma Playlist D&D',
                    trackIds: [],
                    createdAt: new Date().toISOString()
                }
            ],
            settings: {
                volume: 0.5,
                playMode: 'noLoop',
                lastPlaylistId: 'default',
                lastTrackIndex: 0,
                lastVersion: 'calm'
            },
            metadata: {
                version: '2.0',
                lastModified: new Date().toISOString()
            }
        };
    }

    /**
     * Migration de la structure v1 (tracks dans playlists) vers v2 (library séparée)
     */
    async migrateToV2() {
        console.log('🔄 Migration vers v2.0...');

        const library = [];
        const newPlaylists = [];

        // Convertir les anciennes playlists
        for (const oldPlaylist of this.db.data.playlists || []) {
            const trackIds = [];

            // Extraire les tracks et les mettre dans library
            for (const track of oldPlaylist.tracks || []) {
                library.push(track);
                trackIds.push(track.id);
            }

            newPlaylists.push({
                id: oldPlaylist.id,
                name: oldPlaylist.name,
                trackIds: trackIds,
                createdAt: new Date().toISOString()
            });
        }

        this.db.data.library = library;
        this.db.data.playlists = newPlaylists;
        this.db.data.metadata.version = '2.0';

        await this.db.write();
        console.log(`✅ Migration terminée: ${library.length} pistes en bibliothèque`);
    }

    updateMetadata() {
        if (this.db.data.metadata) {
            this.db.data.metadata.lastModified = new Date().toISOString();
        }
    }

    // ============================================
    // GESTION DE LA BIBLIOTHÈQUE
    // ============================================

    async getLibrary() {
        await this.db.read();
        return this.db.data.library || [];
    }

    async getTrack(trackId) {
        await this.db.read();
        return this.db.data.library.find(t => t.id === trackId);
    }

    async addTrackToLibrary(track) {
        await this.db.read();

        // Ajouter metadata si manquante
        if (!track.metadata) {
            track.metadata = {
                addedAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            };
        }

        this.db.data.library.push(track);

        this.updateMetadata();
        await this.db.write();

        console.log(`➕ Piste "${track.title}" ajoutée à la bibliothèque`);

        return track;
    }

    async updateTrack(trackId, updates) {
        await this.db.read();

        const track = this.db.data.library.find(t => t.id === trackId);

        if (!track) {
            throw new Error(`Track ${trackId} introuvable`);
        }

        // Appliquer les mises à jour
        Object.assign(track, updates);

        // Mettre à jour les métadonnées
        if (track.metadata) {
            track.metadata.modifiedAt = new Date().toISOString();
        }

        this.updateMetadata();
        await this.db.write();

        console.log(`✏️ Piste "${track.title}" mise à jour`);

        return track;
    }

    async deleteTrack(trackId) {
        await this.db.read();

        // Supprimer de la bibliothèque
        const initialLength = this.db.data.library.length;
        this.db.data.library = this.db.data.library.filter(t => t.id !== trackId);

        // Supprimer des playlists
        for (const playlist of this.db.data.playlists) {
            playlist.trackIds = playlist.trackIds.filter(id => id !== trackId);
        }

        if (this.db.data.library.length < initialLength) {
            this.updateMetadata();
            await this.db.write();
            console.log(`🗑️ Piste ${trackId} supprimée de la bibliothèque et des playlists`);
            return true;
        }

        return false;
    }

    async addVersionToTrack(trackId, versionName, originalPath, localPath) {
        await this.db.read();

        const track = this.db.data.library.find(t => t.id === trackId);

        if (!track) {
            throw new Error(`Track ${trackId} introuvable`);
        }

        // Ajouter la version
        if (!track.originalPaths) track.originalPaths = {};
        if (!track.localPaths) track.localPaths = {};

        track.originalPaths[versionName] = originalPath;
        track.localPaths[versionName] = localPath;

        // Mettre à jour metadata
        if (track.metadata) {
            track.metadata.modifiedAt = new Date().toISOString();
        }

        this.updateMetadata();
        await this.db.write();

        console.log(`➕ Version "${versionName}" ajoutée à "${track.title}"`);

        return track;
    }

    // ============================================
    // GESTION DES PLAYLISTS
    // ============================================

    async getPlaylists() {
        await this.db.read();
        return this.db.data.playlists || [];
    }

    async getPlaylist(id) {
        await this.db.read();
        return this.db.data.playlists.find(p => p.id === id);
    }

    async getPlaylistWithTracks(playlistId) {
        await this.db.read();

        const playlist = this.db.data.playlists.find(p => p.id === playlistId);

        if (!playlist) {
            return null;
        }

        // Résoudre les IDs en tracks complètes
        const tracks = playlist.trackIds
            .map(id => this.db.data.library.find(t => t.id === id))
            .filter(t => t !== undefined);

        return {
            ...playlist,
            tracks
        };
    }

    async savePlaylist(playlist) {
        await this.db.read();

        const index = this.db.data.playlists.findIndex(p => p.id === playlist.id);

        // Assurer que trackIds existe
        if (!playlist.trackIds) {
            playlist.trackIds = [];
        }

        // Ajouter createdAt si nouveau
        if (index < 0 && !playlist.createdAt) {
            playlist.createdAt = new Date().toISOString();
        }

        if (index >= 0) {
            this.db.data.playlists[index] = playlist;
            console.log(`✏️ Playlist "${playlist.name}" mise à jour`);
        } else {
            this.db.data.playlists.push(playlist);
            console.log(`➕ Playlist "${playlist.name}" créée`);
        }

        this.updateMetadata();
        await this.db.write();

        return playlist;
    }

    async deletePlaylist(id) {
        await this.db.read();

        const initialLength = this.db.data.playlists.length;
        this.db.data.playlists = this.db.data.playlists.filter(p => p.id !== id);

        // Mise à jour inPlaylists des tracks
        for (const track of this.db.data.library) {
            if (track.inPlaylists) {
                track.inPlaylists = track.inPlaylists.filter(pId => pId !== id);
            }
        }

        if (this.db.data.playlists.length < initialLength) {
            this.updateMetadata();
            await this.db.write();
            console.log(`🗑️ Playlist ${id} supprimée`);
            return true;
        }

        return false;
    }

    async addTrackIdToPlaylist(playlistId, trackId) {
        await this.db.read();

        const playlist = this.db.data.playlists.find(p => p.id === playlistId);
        const track = this.db.data.library.find(t => t.id === trackId);

        if (!playlist) {
            throw new Error(`Playlist ${playlistId} introuvable`);
        }

        if (!track) {
            throw new Error(`Track ${trackId} introuvable`);
        }

        // Ajouter l'ID si pas déjà présent
        if (!playlist.trackIds.includes(trackId)) {
            playlist.trackIds.push(trackId);

            // Mettre à jour inPlaylists du track
            if (!track.inPlaylists) {
                track.inPlaylists = [];
            }
            if (!track.inPlaylists.includes(playlistId)) {
                track.inPlaylists.push(playlistId);
            }

            this.updateMetadata();
            await this.db.write();

            console.log(`➕ Track ${trackId} ajouté à playlist ${playlistId}`);
            return true;
        }

        return false;
    }

    async removeTrackIdFromPlaylist(playlistId, trackId) {
        await this.db.read();

        const playlist = this.db.data.playlists.find(p => p.id === playlistId);
        const track = this.db.data.library.find(t => t.id === trackId);

        if (!playlist) {
            throw new Error(`Playlist ${playlistId} introuvable`);
        }

        const initialLength = playlist.trackIds.length;
        playlist.trackIds = playlist.trackIds.filter(id => id !== trackId);

        // Mettre à jour inPlaylists du track
        if (track && track.inPlaylists) {
            track.inPlaylists = track.inPlaylists.filter(pId => pId !== playlistId);
        }

        if (playlist.trackIds.length < initialLength) {
            this.updateMetadata();
            await this.db.write();
            console.log(`🗑️ Track ${trackId} retiré de playlist ${playlistId}`);
            return true;
        }

        return false;
    }

    // ============================================
    // SETTINGS
    // ============================================

    async saveSettings(settings) {
        await this.db.read();

        this.db.data.settings = {
            ...this.db.data.settings,
            ...settings
        };

        this.updateMetadata();
        await this.db.write();

        console.log('💾 Settings sauvegardés');

        return this.db.data.settings;
    }

    async getSettings() {
        await this.db.read();
        return this.db.data.settings || this.getDefaultData().settings;
    }

    // ============================================
    // UTILITAIRES
    // ============================================

    async exportData() {
        await this.db.read();
        return JSON.stringify(this.db.data, null, 2);
    }

    async importData(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            this.db.data = data;
            await this.db.write();
            console.log('✅ Données importées');
            return true;
        } catch (error) {
            console.error('❌ Erreur import:', error);
            return false;
        }
    }

    async reset() {
        this.db.data = this.getDefaultData();
        await this.db.write();
        console.log('🔄 DB réinitialisée');
    }
}
