import { describe, expect, it } from 'vitest';
import type { SongResult, UnifiedSong } from '@/types';
import { patchLocalSongCover, patchQueueWithLocalCover } from '@/hooks/useLocalCoverQueueSync';

// test/unit/hooks/useLocalCoverQueueSync.test.ts
// 磁贴墙按队列条目上的 album.coverUrl 画封面，而队列是建队那一刻烤的快照 ——
// 这个补丁负责把「后来才抽出来的封面」补回去：只补同一首、只补空着的。

const localSong = (songId: string, coverUrl?: string): UnifiedSong => ({
    id: songId as unknown as SongResult['id'],
    name: 'Song',
    artists: [],
    album: { id: 0, name: 'Album', ...(coverUrl ? { coverUrl } : {}) },
    durationMs: 1000,
    isLocal: true,
    localRef: { songId },
    sourceRef: { kind: 'local', mediaId: songId },
});

describe('local cover queue sync', () => {
    it('fills the cover of the matching local entry', () => {
        const patched = patchLocalSongCover(localSong('local-1'), 'local-1', 'folia-cover://asset/a');
        expect(patched?.album?.coverUrl).toBe('folia-cover://asset/a');
        // 标题、歌手这些不能被动到。
        expect(patched?.name).toBe('Song');
    });

    it('leaves other songs alone', () => {
        expect(patchLocalSongCover(localSong('local-1'), 'local-2', 'cover://a')).toBeNull();
    });

    it('never overwrites a cover that is already there (it is usually the online match)', () => {
        expect(patchLocalSongCover(localSong('local-1', 'https://online/cover.jpg'), 'local-1', 'cover://a')).toBeNull();
    });

    it('recognises a restored entry by its source ref when localRef is missing', () => {
        const song = {
            ...localSong('local-9'),
            localRef: undefined,
            sourceRef: { kind: 'local', mediaId: 'local-9' } as UnifiedSong['sourceRef'],
        };
        expect(patchLocalSongCover(song, 'local-9', 'cover://a')?.album?.coverUrl).toBe('cover://a');
    });

    it('reports whether the queue actually changed', () => {
        const queue = [localSong('local-1'), localSong('local-2', 'https://online/x.jpg'), localSong('local-3')];
        const next = patchQueueWithLocalCover(queue, 'local-1', 'cover://a');
        expect(next.changed).toBe(true);
        expect(next.queue[0]?.album?.coverUrl).toBe('cover://a');
        // 没匹配上的条目必须是**同一个对象**，别让整条队列跟着重渲染。
        expect(next.queue[1]).toBe(queue[1]);
        expect(next.queue[2]).toBe(queue[2]);

        const untouched = patchQueueWithLocalCover(queue, 'local-nope', 'cover://a');
        expect(untouched.changed).toBe(false);
        expect(untouched.queue).toBe(queue);
    });
});
