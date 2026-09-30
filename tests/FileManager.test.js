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

describe('FileManager.copyAudioFile', () => {
    it('n\'écrase jamais un fichier encore utilisé par une autre version (#24)', async () => {
        const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const dir = await mkdtemp(join(tmpdir(), 'jukebox-fm-'));
        const manager = new FileManager(dir);
        await manager.init();
        const split = join(dir, 'source-a.mp3');
        const other = join(dir, 'source-b.mp3');
        await writeFile(split, 'AAA');
        await writeFile(other, 'BBB');

        const shared = await manager.copyAudioFile(split, 't1', 'source');
        const added = await manager.copyAudioFile(other, 't1', 'source', [shared]);

        expect(added).not.toBe(shared);
        expect(await readFile(shared, 'utf8')).toBe('AAA');
        expect(await readFile(added, 'utf8')).toBe('BBB');
        await rm(dir, { recursive: true, force: true });
    });
});

describe('FileManager.importTrackFiles (#34)', () => {
    it('ne copie qu\'une fois le fichier partagé par plusieurs versions découpées', async () => {
        const fsp = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const src = await fsp.mkdtemp(join(tmpdir(), 'jukebox-imp-src-'));
        const dst = await fsp.mkdtemp(join(tmpdir(), 'jukebox-imp-dst-'));
        await fsp.writeFile(join(src, 't1_source.mp3'), 'AUDIO');
        const manager = new FileManager(dst);
        await manager.init();
        const copySpy = vi.spyOn(manager, '_copyFile');

        const localPaths = await manager.importTrackFiles({ calm: 't1_source.mp3', combat: 't1_source.mp3' }, src);

        expect(localPaths.calm).toBe(localPaths.combat);
        expect(copySpy).toHaveBeenCalledTimes(1);
        await fsp.rm(src, { recursive: true, force: true });
        await fsp.rm(dst, { recursive: true, force: true });
    });
});
