import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Gestionnaire de fichiers audio
 * Copie et gère les fichiers dans le dossier userData
 */
export class FileManager {
    constructor(userDataPath) {
        this.userDataPath = userDataPath;
        this.musicDir = path.join(userDataPath, 'music');
    }

    /**
     * Initialiser le gestionnaire de fichiers
     * Crée le dossier music s'il n'existe pas
     */
    async init() {
        try {
            await fs.mkdir(this.musicDir, { recursive: true });
            console.log(`✅ Dossier music créé: ${this.musicDir}`);
        } catch (error) {
            console.error('❌ Erreur création dossier music:', error);
            throw error;
        }
    }

    /**
     * Copier un fichier audio dans le dossier local
     * @param {string} sourcePath - Chemin du fichier original
     * @param {string} trackId - ID de la piste
     * @param {string} versionName - Nom de la version (calm, combat, etc.)
     * @returns {Promise<string>} Chemin local du fichier copié
     */
    async copyAudioFile(sourcePath, trackId, versionName) {
        try {
            // Vérifier que le fichier source existe
            await fs.access(sourcePath);

            // Obtenir l'extension
            const ext = path.extname(sourcePath);

            // Créer le nom du fichier de destination
            const filename = `${trackId}_${versionName}${ext}`;
            const destPath = path.join(this.musicDir, filename);

            // Copier le fichier
            await fs.copyFile(sourcePath, destPath);

            console.log(`✅ Fichier copié: ${sourcePath} → ${filename}`);

            return destPath;
        } catch (error) {
            console.error(`❌ Erreur copie fichier ${sourcePath}:`, error);
            throw error;
        }
    }

    /**
     * Supprimer un fichier audio
     * @param {string} filePath - Chemin du fichier à supprimer
     */
    async deleteAudioFile(filePath) {
        try {
            await fs.unlink(filePath);
            console.log(`🗑️ Fichier supprimé: ${filePath}`);
            return true;
        } catch (error) {
            console.warn(`⚠️ Impossible de supprimer ${filePath}:`, error.message);
            return false;
        }
    }

    /**
     * Supprimer tous les fichiers d'une piste
     * @param {Object} track - Objet track avec localPaths
     */
    async deleteTrackFiles(track) {
        const deletedFiles = [];

        if (track.localPaths) {
            for (const [versionName, versionPath] of Object.entries(track.localPaths)) {
                const deleted = await this.deleteAudioFile(versionPath);
                if (deleted) {
                    deletedFiles.push(versionName);
                }
            }
        }

        console.log(`🗑️ ${deletedFiles.length} fichiers supprimés pour "${track.title}"`);
        return deletedFiles;
    }

    /**
     * Vérifier si un fichier existe
     * @param {string} filePath
     * @returns {Promise<boolean>}
     */
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Obtenir la taille d'un fichier en octets
     * @param {string} filePath
     * @returns {Promise<number>}
     */
    async getFileSize(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return stats.size;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Générer un ID unique pour une piste
     * @returns {string}
     */
    generateTrackId() {
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        return `track_${timestamp}_${random}`;
    }

    /**
     * Générer un ID unique pour une playlist
     * @returns {string}
     */
    generatePlaylistId() {
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        return `playlist_${timestamp}_${random}`;
    }

    /**
     * Obtenir l'espace utilisé par tous les fichiers audio
     * @returns {Promise<number>} Taille totale en octets
     */
    async getTotalMusicSize() {
        try {
            const files = await fs.readdir(this.musicDir);
            let totalSize = 0;

            for (const file of files) {
                const filePath = path.join(this.musicDir, file);
                totalSize += await this.getFileSize(filePath);
            }

            return totalSize;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Formater une taille en octets en format lisible
     * @param {number} bytes
     * @returns {string}
     */
    formatSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
}
