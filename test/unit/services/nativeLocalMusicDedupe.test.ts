import { describe, expect, it } from 'vitest';
import { dedupePickedTracks } from '@/services/nativeLocalMusic';

// test/unit/services/nativeLocalMusicDedupe.test.ts
// 「挑单个音频文件」在部分系统上会把同一个文件给两遍，而原生那边的 ref 是按
// 「文件名 + 大小」算的（大小读不出来时算不出同一个 ref）—— 不去重就是库里两份一模一样的歌。

const track = (id: string, fileName: string, fileSize?: number) => ({
    id,
    fileName,
    fileSize,
    url: `http://127.0.0.1:1/audio/${id}`,
});

describe('dedupePickedTracks', () => {
    it('collapses the same file handed over twice with the same ref', () => {
        const kept = dedupePickedTracks([
            track('imported-a', 'song.mp3', 1234),
            track('imported-a', 'song.mp3', 1234),
        ]);
        expect(kept.map(entry => entry.id)).toEqual(['imported-a']);
    });

    it('collapses the same content even when the native side minted two refs', () => {
        const kept = dedupePickedTracks([
            track('imported-a', 'song.mp3', 1234),
            // 同一首歌，大小那趟没读出来 → 原生算了另一个 ref。
            track('imported-song.mp3-0', 'song.mp3', 1234),
        ]);
        expect(kept.map(entry => entry.id)).toEqual(['imported-a']);
    });

    it('keeps different files with the same name when the size is unknown', () => {
        const kept = dedupePickedTracks([
            track('imported-a', 'song.mp3'),
            track('imported-b', 'song.mp3'),
        ]);
        expect(kept).toHaveLength(2);
    });

    it('keeps genuinely different tracks', () => {
        const kept = dedupePickedTracks([
            track('imported-a', 'one.mp3', 1000),
            track('imported-b', 'two.mp3', 2000),
            track('imported-c', 'one.mp3', 9999),
        ]);
        expect(kept.map(entry => entry.id)).toEqual(['imported-a', 'imported-b', 'imported-c']);
    });
});
