import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { resolvePlaybackNeighbors } from '@/utils/playbackNeighbors';

// test/unit/utils/playbackNeighborsShuffle.test.ts
// 随机播放那一档的上一首 / 下一首：它和 off / all 都不一样 —— 走到队尾不是停住，
// 而是把后面的重新打乱再接着播，所以**能跳但目标未知**（canGo 为 true、title 为 null）。

const song = (id: number) => ({ id, name: `s${id}` }) as unknown as SongResult;

const resolve = (loopMode: 'off' | 'all' | 'one' | 'shuffle', queueLength: number, currentIndex: number) => (
    resolvePlaybackNeighbors({
        playQueue: Array.from({ length: queueLength }, (_, index) => song(index + 1)),
        currentSong: song(currentIndex + 1),
        loopMode,
        isFmMode: false,
        isStageActive: false,
    })
);

describe('resolvePlaybackNeighbors（随机播放）', () => {
    it('走到最后一首：还能跳，但目标要给不出来（要等重新打乱）', () => {
        const { next } = resolve('shuffle', 5, 4);
        expect(next.canGo).toBe(true);
        expect(next.title).toBeNull();
    });

    it('不在队尾时和顺序播放一样，下一首就是后一首', () => {
        const { next } = resolve('shuffle', 5, 2);
        expect(next.canGo).toBe(true);
        expect(next.title).toBe('s4');
    });

    it('队首的上一首是关着的（随机不回绕，回绕对随机没意义）', () => {
        expect(resolve('shuffle', 5, 0).prev.canGo).toBe(false);
    });

    it('队列只有一首时没得洗，按列表循环处理', () => {
        const { next } = resolve('shuffle', 1, 0);
        expect(next.canGo).toBe(true);
        expect(next.title).toBe('s1');
    });

    it('顺序播放（off）走到队尾仍然是停住', () => {
        expect(resolve('off', 5, 4).next.canGo).toBe(false);
    });
});
