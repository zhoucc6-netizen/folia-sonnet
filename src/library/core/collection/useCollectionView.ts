import { useCallback, useMemo, useRef } from 'react';
import type { SongResult } from '../../../types';
import { isSongUnavailable } from '../../../services/onlineMusic/songAvailability';
import {
    buildDuplicateOccurrences,
    entryKeyAt,
    findEntryIndex,
    type DuplicateOccurrenceCache,
} from './collectionEntries';
import { matchTrackIndexes } from './collectionQuery';
import { isCloudThemePendingTrack } from './resource/cloudThemeCollection.service';
import {
    deriveDisplayTracks,
    derivePlayableTracks,
    resolveContextTracks,
    type SongSortContext,
} from './collectionView';

// src/library/core/collection/useCollectionView.ts
// 把资源里的曲目派生成 renderer 要的那几样：展示顺序、可播放曲目、筛选命中、操作范围、条目键。
// 规则都在 core/collection 的纯规则文件里，这里只负责按依赖记忆化，并缓存重复序号的扫描（分页追加时复用前缀）。

const NO_HIDDEN_KEYS: ReadonlySet<string> = new Set();

export type CollectionView = {
    displayTracks: SongResult[];
    playableTracks: SongResult[];
    /** 筛选命中的下标（在 displayTracks 里）；没有筛选时为 null。 */
    matchIndexes: number[] | null;
    /** 播放 / 入队「当前范围」作用的歌。 */
    contextTracks: SongResult[];
    isFilterActive: boolean;
    occurrences: ReadonlyMap<number, number>;
    entryKeyAt: (index: number) => string | null;
    findEntryIndex: (entryKey: string) => number;
};

export const useCollectionView = ({
    tracks,
    committedQuery,
    hiddenKeys = NO_HIDDEN_KEYS,
    localSort = null,
}: {
    tracks: SongResult[];
    committedQuery: string;
    hiddenKeys?: ReadonlySet<string>;
    localSort?: SongSortContext | null;
}): CollectionView => {
    const displayTracks = useMemo(
        () => deriveDisplayTracks(tracks, hiddenKeys, localSort),
        [hiddenKeys, localSort, tracks],
    );
    /*
     * 「AI 主题」的占位行也排在这里。
     *
     * 那一屏先把云端的歌名铺成等长的占位行，再一条一条去平台上搜出来换掉；占位行只有个
     * 歌名和一个假的 id（`cloud-pending:N`），既没有音源也没有时长。放进可播放清单就等于
     * 让用户拿到一串守不到任何东西的 id 去播：「播放全部」会把队列填成半真半假，
     * 一首一首点下去则一部分直接失败。所以它们既不该播放、也不该入队 —— 顺带连
     * 「这个范围有几首可播」的数也不能算进去（contextTracks 就是从 playableTracks 派生的）。
     */
    const playableTracks = useMemo(
        () => derivePlayableTracks(displayTracks, song => isSongUnavailable(song) || isCloudThemePendingTrack(song)),
        [displayTracks],
    );

    const occurrenceCacheRef = useRef<DuplicateOccurrenceCache | null>(null);
    const occurrences = useMemo(() => {
        const { seen, occurrences: next } = buildDuplicateOccurrences(displayTracks, occurrenceCacheRef.current);
        occurrenceCacheRef.current = { source: displayTracks, seen, occurrences: next };
        return next;
    }, [displayTracks]);

    const matchIndexes = useMemo(() => matchTrackIndexes(displayTracks, committedQuery), [committedQuery, displayTracks]);
    const contextTracks = useMemo(() => resolveContextTracks(
        matchIndexes ? matchIndexes.map(index => displayTracks[index]) : null,
        playableTracks,
        isSongUnavailable,
    ), [displayTracks, matchIndexes, playableTracks]);

    const entryKeyAtIndex = useCallback((index: number) => entryKeyAt(displayTracks, occurrences, index), [displayTracks, occurrences]);
    const findEntry = useCallback((entryKey: string) => findEntryIndex(displayTracks, occurrences, entryKey), [displayTracks, occurrences]);

    return useMemo(() => ({
        displayTracks,
        playableTracks,
        matchIndexes,
        contextTracks,
        isFilterActive: matchIndexes !== null,
        occurrences,
        entryKeyAt: entryKeyAtIndex,
        findEntryIndex: findEntry,
    }), [contextTracks, displayTracks, entryKeyAtIndex, findEntry, matchIndexes, occurrences, playableTracks]);
};
