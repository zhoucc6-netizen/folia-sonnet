import { describe, expect, it, vi } from 'vitest';
import { normalizeQqCollection } from '@/services/onlineMusic/qq/qqNormalize';
import { createOnlineCollectionResource, type OnlineCollectionResourceDeps } from '@/library/core/collection/resource/onlineCollectionResource.service';
import { createCollectionTrackSnapshot } from '@/library/core/collection/resource/collectionTrackSnapshot.service';
import type { OnlineTracksCacheEntry } from '@/library/core/collection/resource/onlineCollectionCache.service';
import type { OnlineGridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';

// test/unit/qq/playlistCache.test.ts
// 来自上游 #879。盯的是「账号缓存往返之后，磁盘快照的版本还是不是同一个」：
// QQ 的 updateTime 是秒，账号缓存那一趟把它变成毫秒之后，如果归一化没有认回来，
// 每次重进歌单都会当成新版本重新拉一遍 —— 缓存等于白存。

const descriptor = (updateTime: number): OnlineGridViewCollectionDescriptor => ({
    ...normalizeQqCollection({ tid: 7, dirId: 1, dirName: 'Playlist', songNum: 1, updateTime }),
    source: 'online',
});
const settle = async () => {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
};

describe('QQ 歌单的快照缓存', () => {
    it('账号缓存往返后复用已存的快照，上游版本变了才重新读', async () => {
        let cache: OnlineTracksCacheEntry = { tracks: [], snapshotTime: 0, schemaVersion: 0 };
        const deps: OnlineCollectionResourceDeps = {
            getCollectionTracks: vi.fn(async () => ({ items: [], nextOffset: 0, hasMore: false, total: 0 })),
            getCollectionDetail: vi.fn(async () => null),
            getPersonalFm: vi.fn(async () => []),
            getDailySongs: vi.fn(async () => []),
            readCache: vi.fn(async () => cache),
            writeCache: vi.fn(async (_key, tracks, snapshotTime, progress) => {
                cache = createCollectionTrackSnapshot({ items: tracks, nextOffset: progress?.nextOffset ?? tracks.length, hasMore: progress?.hasMore ?? false }, snapshotTime);
            }),
        };
        const collection = descriptor(1792948025);
        // 用一页真的非空数据：空页按设计不会落盘。
        const track = { id: 'song', name: 'Song', artists: [], album: { id: '', name: '' }, durationMs: 1 };
        vi.mocked(deps.getCollectionTracks).mockResolvedValue({ items: [track], nextOffset: 1, hasMore: false, total: 1 });
        const first = createOnlineCollectionResource('k', deps);
        first.ensure(collection, {});
        await settle();
        first.dispose();
        expect(cache.snapshotTime).toBe(1792948025000);

        const hydrated = { ...normalizeQqCollection(collection), source: 'online' as const };
        const reopened = createOnlineCollectionResource('k', deps);
        reopened.ensure(hydrated, {});
        await settle();
        expect(deps.getCollectionTracks).toHaveBeenCalledTimes(1);
        expect(reopened.getSnapshot().tracks).toEqual([track]);

        reopened.ensure(descriptor(1792948026), {});
        await settle();
        expect(deps.getCollectionTracks).toHaveBeenCalledTimes(2);
        expect(cache.snapshotTime).toBe(1792948026000);
        reopened.dispose();
    });
});
