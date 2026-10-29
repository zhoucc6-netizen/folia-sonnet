import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { buildShuffledQueue } from '@/utils/playbackShuffle';

// test/unit/utils/playbackShuffle.test.ts
// 随机播放的排序：当前这首留首位，其余打乱；走到队尾再调一次就是「后面重新打乱一遍」。

const song = (id: number) => ({ id, name: `s${id}` }) as unknown as SongResult;
const keys = (queue: SongResult[]) => queue.map(item => getPlaybackSongKey(item));

describe('buildShuffledQueue', () => {
    it('当前这首留在第一位，其余全部还在（一个不丢、一个不重复）', () => {
        const queue = [song(1), song(2), song(3), song(4), song(5)];
        const current = getPlaybackSongKey(queue[2]);

        const shuffled = buildShuffledQueue(queue, current);

        expect(getPlaybackSongKey(shuffled[0])).toBe(current);
        expect(shuffled).toHaveLength(queue.length);
        expect([...keys(shuffled)].sort()).toEqual([...keys(queue)].sort());
    });

    it('队列里同一首出现两次时两首都还在（按 key 过滤会把两首一起滤掉）', () => {
        const duplicate = song(7);
        const queue = [song(1), duplicate, duplicate, song(2)];
        const current = getPlaybackSongKey(duplicate);

        const shuffled = buildShuffledQueue(queue, current);

        expect(shuffled).toHaveLength(4);
        expect(keys(shuffled).filter(key => key === current)).toHaveLength(2);
        expect(getPlaybackSongKey(shuffled[0])).toBe(current);
    });

    it('当前不在队列里（key 为 null）时整队打乱，长度不变', () => {
        const queue = [song(1), song(2), song(3)];
        const shuffled = buildShuffledQueue(queue, null);
        expect([...keys(shuffled)].sort()).toEqual([...keys(queue)].sort());
    });

    it('一两首的队列原样返回，不做无意义的重排', () => {
        const single = [song(1)];
        expect(keys(buildShuffledQueue(single, getPlaybackSongKey(single[0])))).toEqual(keys(single));
        expect(buildShuffledQueue([], null)).toEqual([]);
    });

    it('确实会打乱：多洗几次不会每次都得出同一个顺序', () => {
        const queue = Array.from({ length: 12 }, (_, index) => song(index + 1));
        const current = getPlaybackSongKey(queue[0]);
        const orders = new Set<string>();
        for (let attempt = 0; attempt < 30; attempt += 1) {
            // 队首固定，比较它后面那一段
            orders.add(keys(buildShuffledQueue(queue, current)).slice(1).join(','));
        }
        // 全随机下 30 次都撞成同一个排列的概率可以忽略；这里只要求「不是永远一样」。
        expect(orders.size).toBeGreaterThan(1);
    });
});
