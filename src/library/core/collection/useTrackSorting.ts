import { useCallback, useMemo } from 'react';
import type { LocalSong } from '../../../types';
import type { SongSortDirection, SongSortField } from '../../../utils/songSorting';
import {
    isSongSortFieldAvailable,
    resolveAvailableSongSortPresets,
    resolveSongSortCapability,
    type SongSortCapability,
    type SongSortPreset,
} from './songSortOptions';
import type { SongSortContext } from './collectionView';
import { useTrackSortStore } from '../directory/useTrackSortStore';
import { useSongLikedResolver } from '../directory/useSongLikedResolver';

// src/library/core/collection/useTrackSorting.ts
//
// 一个列表的排序这一整件事：能排什么（能力）、菜单里该出现哪些项、当前选择、以及交给
// deriveDisplayTracks 的排序上下文。网格、bravais、TUI 三个 renderer 都从这里拿，
// 免得「哪些排序项可用」在三个地方各判一遍。
//
// 上游把排序收成了「只有本地文件夹能排」（useLocalTrackSortStore + LocalTrackSortMenu），
// 在线歌单按标题 / 歌手 / 喜欢 / 播放次数排这些项就没了。这里仍是按列表的数据来源算能力。

export type TrackSorting = {
    /** 这个列表排得了序吗（至少有一个排序项用得上）。 */
    supported: boolean;
    capability: SongSortCapability;
    /** 菜单要显示的项，已按能力过滤，primary 在前。 */
    presets: SongSortPreset[];
    /** 当前生效的排序字段；存下来的选择在这个列表排不了时是 'none'。 */
    field: SongSortField;
    direction: SongSortDirection;
    setField: (field: SongSortField) => void;
    setDirection: (direction: SongSortDirection) => void;
    /** 菜单 / 命令面板选中一个排序方式时用它：字段与方向一次设好。 */
    applyPreset: (preset: SongSortPreset) => void;
    /** 交给 useCollectionView 的上下文；不需要排序时为 null。 */
    sort: SongSortContext | null;
};

export const useTrackSorting = ({
    source,
    localSongsById,
}: {
    source?: string;
    localSongsById?: ReadonlyMap<string, LocalSong>;
}): TrackSorting => {
    const storedField = useTrackSortStore(state => state.field);
    const direction = useTrackSortStore(state => state.direction);
    const setField = useTrackSortStore(state => state.setField);
    const setDirection = useTrackSortStore(state => state.setDirection);
    const isLiked = useSongLikedResolver();

    const capability = useMemo(() => resolveSongSortCapability(source), [source]);
    const presets = useMemo(() => resolveAvailableSongSortPresets(capability), [capability]);
    // 名字和歌手任何列表都有，所以只要还剩得下排序项就挂按钮；按钮挂不挂得住由 renderer 再判一次
    // （例如专辑保留音轨序）。
    const supported = presets.length > 0;

    // 存下来的选择在这个列表排不了（例：本地选了播放量，切到在线歌单）时退回原序，而不是硬排。
    const field: SongSortField = isSongSortFieldAvailable(storedField, capability) ? storedField : 'none';

    const sort = useMemo<SongSortContext | null>(() => (
        field === 'none'
            ? null
            : { field, direction, localSongsById, isLiked }
    ), [direction, field, isLiked, localSongsById]);

    const applyPreset = useCallback((preset: SongSortPreset) => {
        setField(preset.field);
        setDirection(preset.direction);
    }, [setDirection, setField]);

    return {
        supported,
        capability,
        presets,
        field,
        direction,
        setField,
        setDirection,
        applyPreset,
        sort,
    };
};
