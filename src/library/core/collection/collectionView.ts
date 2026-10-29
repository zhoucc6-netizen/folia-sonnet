import type { SongResult } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import {
    compareSongs,
    type SongSortDirection,
    type SongSortFacts,
    type SongSortField,
} from '../../../utils/songSorting';
import { buildSongSortFactResolver, type SongSortFactSources } from './songSortFacts';

// src/library/core/collection/collectionView.ts
// 从已加载的曲目派生出「这次展示什么、能播什么、操作作用在哪些歌上」。与渲染形态无关：
// 网格和列表拿到的是同一份顺序和同一个操作范围。逻辑原样搬自 GridView，包括隐藏集合同时按
// key 与 key-下标 两种拼法匹配这些细节。
//
// 排序不再是本地文件夹专属：能排什么由列表的数据来源决定（见 songSortOptions），
// 这里只负责把当前选择作用在曲目上。

export type SongSortContext = SongSortFactSources & {
    field: SongSortField;
    direction: SongSortDirection;
};

/**
 * 展示顺序：先去掉被隐藏的条目，再按当前排序。`hiddenKeys` 里既可以是 playback key，
 * 也可以是 `${playbackKey}-${下标}`。
 *
 * `field` 为 'none' 或缺失时保持资源给的顺序——专辑的音轨序、歌单的自定义序都靠这个。
 * 排序事实每首歌只压一次（比较器会被调用 O(n log n) 次）。
 */
export const deriveDisplayTracks = (
    tracks: SongResult[],
    hiddenKeys: ReadonlySet<string>,
    sort: SongSortContext | null,
): SongResult[] => {
    const visibleTracks = hiddenKeys.size === 0
        ? tracks
        : tracks.filter((track, index) => (
            !hiddenKeys.has(`${getPlaybackSongKey(track)}-${index}`)
            && !hiddenKeys.has(getPlaybackSongKey(track))
        ));
    if (!sort || sort.field === 'none') {
        return visibleTracks;
    }

    const resolveFacts = buildSongSortFactResolver(sort);
    const factsCache = new Map<SongResult, SongSortFacts>();
    const factsOf = (track: SongResult): SongSortFacts => {
        const cached = factsCache.get(track);
        if (cached) return cached;
        const facts = resolveFacts(track);
        factsCache.set(track, facts);
        return facts;
    };

    return [...visibleTracks].sort((left, right) => (
        compareSongs(factsOf(left), factsOf(right), sort.field, sort.direction)
    ));
};

/** 可播放的曲目（保持顺序）。可用性判定来自 provider，所以由调用方注入。 */
export const derivePlayableTracks = (
    displayTracks: SongResult[],
    isUnavailable: (track: SongResult) => boolean,
): SongResult[] => displayTracks.filter(track => !isUnavailable(track));

/**
 * 「播放 / 入队当前范围」作用的歌：没有筛选时是全部可播放曲目，有筛选时是命中的可播放曲目。
 * `matchedTracks` 为 null 表示没有筛选。
 */
export const resolveContextTracks = (
    matchedTracks: readonly SongResult[] | null,
    playableTracks: SongResult[],
    isUnavailable: (track: SongResult) => boolean,
): SongResult[] => (
    matchedTracks === null
        ? playableTracks
        : matchedTracks.filter(track => !isUnavailable(track))
);
