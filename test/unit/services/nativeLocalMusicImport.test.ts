import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong } from '@/types';
import { importExternalAudioTracks } from '@/services/nativeLocalMusic';

// test/unit/services/nativeLocalMusicImport.test.ts
// 「用 Folia 打开」第二次打开同一个文件时，曲库里已经有这首歌了 —— 那时新增的是 0 首，
// 但「加到歌单」这件事还得照做。以前这一步只返回「新写进去的」，0 首就意味着歌单一首
// 都没加，表现是「提示说已经在库里了，歌单里却一首都没有」。这里钉住 fresh / resolved 的语义。

const state = vi.hoisted(() => ({ songs: [] as LocalSong[] }));

vi.mock('@/services/db', () => ({
    getLocalSongs: vi.fn(async () => state.songs.slice()),
    saveLocalSongs: vi.fn(async (songs: LocalSong[]) => {
        state.songs.push(...songs);
    }),
}));

vi.mock('@/utils/localMetadataWorkerClient', () => ({
    parseEmbeddedMetadataAsync: vi.fn(async () => null),
}));

vi.mock('@/nativeBridge/api/libraryTrace.js', () => ({
    noteLibraryStep: vi.fn(),
}));

const existingSong = (overrides: Partial<LocalSong> = {}): LocalSong => ({
    id: 'android-imported-imported-a',
    fileName: 'song.mp3',
    filePath: 'Android/Imported/imported-a',
    nativeAudioRef: 'imported-a',
    duration: 100,
    fileSize: 1234,
    fileLastModified: 1_700_000_000_000,
    mimeType: 'audio/mpeg',
    addedAt: 1_700_000_000_000,
    title: 'Song',
    titleOrigin: 'import',
    importedMetadata: {
        title: 'Song',
        titleSource: 'embedded',
        artistNames: [],
        albumName: '',
    },
    folderName: 'Android 文件导入',
    hasManualLyricSelection: false,
    noAutoMatch: false,
    ...overrides,
});

const track = (id: string, fileName: string, fileSize?: number) => ({
    id,
    fileName,
    fileSize,
    url: `http://127.0.0.1:1/audio/${id}`,
});

describe('importExternalAudioTracks', () => {
    beforeEach(() => {
        state.songs = [];
        vi.stubGlobal('fetch', vi.fn(async () => ({
            blob: async () => new Blob([new Uint8Array(16)]),
        })));
    });

    it('returns the new records in both fresh and resolved on a first import', async () => {
        const result = await importExternalAudioTracks([track('imported-a', 'song.mp3', 1234)]);

        expect(result.fresh).toHaveLength(1);
        expect(result.resolved).toHaveLength(1);
        expect(result.fresh[0].id).toBe(result.resolved[0].id);
        expect(result.fresh[0].nativeAudioRef).toBe('imported-a');
    });

    it('still resolves the record already sitting in the library, so the playlist gets it', async () => {
        state.songs = [existingSong()];

        const result = await importExternalAudioTracks([track('imported-a', 'song.mp3', 1234)]);

        // 已经在库里：一首都不该再写进去。
        expect(result.fresh).toHaveLength(0);
        // 但「加到歌单」要用的那份必须还在，而且是库里那条（id 一致），不是新造的。
        expect(result.resolved).toHaveLength(1);
        expect(result.resolved[0].id).toBe('android-imported-imported-a');
    });

    it('matches an already-imported copy by file name and size when the ref differs', async () => {
        state.songs = [existingSong({ nativeAudioRef: 'imported-other' })];

        // 同一个文件被原生算成了另一个 ref（大小那趟没读出来时就会这样）。
        const result = await importExternalAudioTracks([track('imported-a', 'song.mp3', 1234)]);

        expect(result.fresh).toHaveLength(0);
        expect(result.resolved[0].nativeAudioRef).toBe('imported-other');
    });

    it('keeps genuinely new files in fresh', async () => {
        state.songs = [existingSong()];

        const result = await importExternalAudioTracks([
            track('imported-a', 'song.mp3', 1234),
            track('imported-b', 'other.mp3', 4321),
        ]);

        expect(result.fresh.map(song => song.nativeAudioRef)).toEqual(['imported-b']);
        expect(result.resolved).toHaveLength(2);
    });
});
