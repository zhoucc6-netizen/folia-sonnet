import { create } from 'zustand';
import type { SongSortDirection, SongSortField } from '../../../utils/songSorting';

// src/library/core/state/useTrackSortStore.ts
// 曲目列表的排序选择。原先只服务本地文件夹（useLocalTrackSortStore），排序放开到所有列表之后
// 换 renderer 也必须是同一个顺序，所以它仍在 store 里。
//
// 两个 localStorage 键沿用旧名，已有的选择不会丢。默认值是 'none'（保持列表原本的顺序）：
// 老用户存过 fileName 之类就照旧，没存过的不会让在线歌单莫名其妙按文件名重排一遍。

const TRACK_SORT_FIELD_STORAGE_KEY = 'local_track_sort_field';
const TRACK_SORT_DIRECTION_STORAGE_KEY = 'local_track_sort_direction';

const LEGACY_FIELDS: readonly SongSortField[] = ['fileName', 'fileLastModified', 'albumTrack'];
const STORED_FIELDS: readonly SongSortField[] = [
    'none', 'addedAt', 'title', 'artist', 'liked', 'playCount', ...LEGACY_FIELDS,
];

const readField = (): SongSortField => {
    if (typeof window === 'undefined') return 'none';
    const stored = localStorage.getItem(TRACK_SORT_FIELD_STORAGE_KEY);
    const matched = STORED_FIELDS.find(field => field === stored);
    return matched ?? 'none';
};

const readDirection = (): SongSortDirection => {
    if (typeof window === 'undefined') return 'asc';
    return localStorage.getItem(TRACK_SORT_DIRECTION_STORAGE_KEY) === 'desc' ? 'desc' : 'asc';
};

type TrackSortState = {
    field: SongSortField;
    direction: SongSortDirection;
    setField: (field: SongSortField) => void;
    setDirection: (direction: SongSortDirection) => void;
};

export const useTrackSortStore = create<TrackSortState>(set => ({
    field: readField(),
    direction: readDirection(),
    setField: (field) => {
        localStorage.setItem(TRACK_SORT_FIELD_STORAGE_KEY, field);
        set({ field });
    },
    setDirection: (direction) => {
        localStorage.setItem(TRACK_SORT_DIRECTION_STORAGE_KEY, direction);
        set({ direction });
    },
}));
