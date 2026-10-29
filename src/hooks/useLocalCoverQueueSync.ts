import { useEffect, useMemo } from 'react';
import type React from 'react';
import type { LocalSong, SongResult, UnifiedSong } from '../types';
import { getLocalCoverAssetUrl, getPreferredLocalSongCoverUrl } from '../services/localCoverAssetUrl';
import { LOCAL_COVER_READY_EVENT, type LocalCoverReadyDetail } from '../services/localCoverReadyEvent';
import { LOCAL_MUSIC_UPDATED_EVENT } from '../services/localMusicService';

// src/hooks/useLocalCoverQueueSync.ts
// 把「后来才抽出来的本地封面」同步进播放队列。
//
// 磁贴墙（Lattice / PosterWall）不读歌曲记录，它铺的是**播放队列**：`buildLatticeTiles` 取
// 每个条目的 `album.coverUrl`，而这个字段是建队列那一刻由 `buildLocalQueue` 按当时的
// `localCoverAssetId` 烤进去的。内嵌封面却常常在那之后才有 —— 播到这一首时、预热相邻几首时、
// 列表回填时 —— 于是队列里的其它条目永远停在「没有封面」那一份快照上：播放页有封面，磁贴墙空白。
//
// 这里就补这一件事：`localMusicService` 抽到新封面会广播 `LOCAL_COVER_READY_EVENT`，
// 收到后把队列里**同一首**且**当前没有封面**的条目补上封面 URL（已经有封面的一律不动 ——
// 那多半是在线匹配来的，不该被内嵌图盖掉）。

/** 这一条是不是「这一首本地歌」：本地条目带 localRef，兜一条 sourceRef（还原播放那份也有）。 */
const localSongIdOf = (song: SongResult): string | undefined => {
    const unified = song as UnifiedSong;
    if (unified.localRef?.songId) return unified.localRef.songId;
    return unified.sourceRef?.kind === 'local' ? unified.sourceRef.mediaId : undefined;
};

/** 给这一条补封面；不需要补（不是同一首 / 已经有封面）时返回 null。 */
export const patchLocalSongCover = (
    song: SongResult,
    songId: string,
    coverUrl: string,
): SongResult | null => {
    if (localSongIdOf(song) !== songId) return null;
    if (song.album?.coverUrl) return null;
    return {
        ...song,
        album: {
            id: song.album?.id ?? 0,
            name: song.album?.name ?? '',
            coverUrl,
        },
    };
};

/** 整条队列里同一首歌的记录一起补；`changed` 为 false 时调用方不必写状态。 */
export const patchQueueWithLocalCover = (
    queue: SongResult[],
    songId: string,
    coverUrl: string,
): { queue: SongResult[]; changed: boolean } => {
    let changed = false;
    const nextQueue = queue.map(song => {
        const patched = patchLocalSongCover(song, songId, coverUrl);
        if (!patched) return song;
        changed = true;
        return patched;
    });
    // 一首都没补上就把原数组还回去：调用方不写状态，整条队列不必重渲染。
    return changed ? { queue: nextQueue, changed: true } : { queue, changed: false };
};

export const useLocalCoverQueueSync = ({
    playQueue,
    setPlayQueue,
    currentSong,
    setCurrentSong,
    localSongs,
}: {
    playQueue: SongResult[];
    setPlayQueue: React.Dispatch<React.SetStateAction<SongResult[]>>;
    currentSong: SongResult | null;
    setCurrentSong: React.Dispatch<React.SetStateAction<SongResult | null>>;
    /** 曲库记录：封面到了之后按它现算一次（见下面 handleLibraryUpdated）。 */
    localSongs: LocalSong[];
}): void => {
    /** 每首本地歌此刻该用哪张封面；只在曲库变化时重算。 */
    const coverBySongId = useMemo(() => {
        const covers = new Map<string, string>();
        localSongs.forEach(song => {
            const coverUrl = getPreferredLocalSongCoverUrl(song, 1024);
            if (coverUrl) covers.set(song.id, coverUrl);
        });
        return covers;
    }, [localSongs]);

    useEffect(() => {
        const patch = (songId: string, coverUrl: string) => {
            const next = patchQueueWithLocalCover(playQueue, songId, coverUrl);
            if (next.changed) setPlayQueue(next.queue);

            if (currentSong) {
                const patchedCurrent = patchLocalSongCover(currentSong, songId, coverUrl);
                if (patchedCurrent) setCurrentSong(patchedCurrent);
            }
        };

        const handleCoverReady = (event: Event) => {
            const detail = (event as CustomEvent<LocalCoverReadyDetail>).detail;
            const songId = detail?.songId;
            /*
             * 在线封面那一侧直接给 URL；内嵌封面那一侧只给资源 id，按队列要的尺寸现算。
             * 两条路原来只有后者会广播，所以自动匹配来的在线封面一直进不了磁贴墙。
             * 两者都拿不到时（例如事件里只带了 songId）退回按记录现算。
             */
            const coverUrl = detail?.coverUrl
                || getLocalCoverAssetUrl(detail?.assetId, 1024)
                || (songId ? coverBySongId.get(songId) : undefined);
            if (!songId || !coverUrl) return;
            patch(songId, coverUrl);
        };

        /*
         * 曲库变了，把队列里还空着的本地条目按**最新记录**补一次。
         *
         * 单靠上面那个事件不够：它只在「封面刚刚到达」那一刻响，而队列可能是在那之前
         * 就烤好的（导入后先建队、还原上次播放带的队列），也可能这首的封面早在建队前
         * 就写进记录了、只是建队那一趟读的是旧快照 —— 那种情况没有事件可收。
         * 只补空位（`patchLocalSongCover` 的规则），已经有封面的条目一律不动。
         */
        const handleLibraryUpdated = () => {
            let changed = false;
            const nextQueue = playQueue.map(song => {
                if (song.album?.coverUrl) return song;
                const songId = localSongIdOf(song);
                const coverUrl = songId ? coverBySongId.get(songId) : undefined;
                if (!songId || !coverUrl) return song;
                const patched = patchLocalSongCover(song, songId, coverUrl);
                if (!patched) return song;
                changed = true;
                return patched;
            });
            if (changed) setPlayQueue(nextQueue);

            if (currentSong) {
                const songId = localSongIdOf(currentSong);
                const coverUrl = songId ? coverBySongId.get(songId) : undefined;
                if (songId && coverUrl) {
                    const patched = patchLocalSongCover(currentSong, songId, coverUrl);
                    if (patched) setCurrentSong(patched);
                }
            }
        };

        window.addEventListener(LOCAL_COVER_READY_EVENT, handleCoverReady);
        window.addEventListener(LOCAL_MUSIC_UPDATED_EVENT, handleLibraryUpdated);
        return () => {
            window.removeEventListener(LOCAL_COVER_READY_EVENT, handleCoverReady);
            window.removeEventListener(LOCAL_MUSIC_UPDATED_EVENT, handleLibraryUpdated);
        };
    }, [coverBySongId, currentSong, playQueue, setCurrentSong, setPlayQueue]);
};
