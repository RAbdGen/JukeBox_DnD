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
