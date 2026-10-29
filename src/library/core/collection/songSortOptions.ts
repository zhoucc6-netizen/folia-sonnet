import type { SongSortDirection, SongSortField } from '../../../utils/songSorting';

// src/library/core/model/songSortOptions.ts
//
// 排序菜单的唯一真源。网格侧栏的下拉、bravais 面板的下拉、命令面板的命令，三处都从这张表派生——
// 之前每一处各自写死一份列表，加一个排序方式要改三遍，而且改漏一处两边就长得不一样。
//
// 「歌曲平台没有返回的就不用写了」落在这里：每个排序项声明自己需要哪一份数据（`needs`），
// 列表按自己的来源算出能力，用不上的项根本不进菜单。

/** 一个列表能为排序提供的字段。来源决定它，跟列表是歌单还是文件夹无关。 */
export type SongSortCapability = {
    /** 加入 / 创建时间：本地有 addedAt，Navidrome 有 created；在线平台歌曲级不返回。 */
    addedAt: boolean;
    liked: boolean;
    /** 播放量：只有 Navidrome 的 SubsonicSong.playCount 有，本地不统计，在线平台不返回。 */
    playCount: boolean;
    fileName: boolean;
    fileLastModified: boolean;
    albumTrack: boolean;
};

export type SongSortCapabilityKey = keyof SongSortCapability;

export type SongSortPresetId =
    | 'newest'
    | 'oldest'
    | 'titleAsc'
    | 'artistAsc'
    | 'likedDesc'
    | 'likedAsc'
    | 'playCountDesc'
    | 'playCountAsc'
    | 'default'
    | 'fileNameAsc'
    | 'fileLastModifiedDesc'
    | 'albumTrackAsc';

export type SongSortPreset = {
    id: SongSortPresetId;
    field: SongSortField;
    direction: SongSortDirection;
    labelKey: string;
    /** 需要的那份数据；null 表示任何列表都排得了。 */
    needs: SongSortCapabilityKey | null;
    /** primary 是菜单上半部分按数据能力过滤的项，legacy 是本地文件时代留下的三项。 */
    group: 'primary' | 'legacy';
};

const NO_CAPABILITY: SongSortCapability = {
    addedAt: false,
    liked: false,
    playCount: false,
    fileName: false,
    fileLastModified: false,
    albumTrack: false,
};

/**
 * 本地文件给出全部文件字段，但没有播放量（本地不统计播放次数）。
 * Navidrome 有创建时间、收藏和播放量，没有文件概念。
 * 在线平台歌曲级只给得出名字、歌手和「已喜欢」。
 */
export const resolveSongSortCapability = (source: string | undefined): SongSortCapability => {
    if (source === 'local') {
        return { ...NO_CAPABILITY, addedAt: true, liked: true, fileName: true, fileLastModified: true, albumTrack: true };
    }
    if (source === 'navidrome') {
        return { ...NO_CAPABILITY, addedAt: true, liked: true, playCount: true };
    }
    if (source === 'online') {
        return { ...NO_CAPABILITY, liked: true };
    }
    return { ...NO_CAPABILITY };
};

/** 菜单里出现得了的排序项，按数据能力过滤。能力一项都不给的列表返回空——那时按钮不该出现。 */
export const resolveAvailableSongSortPresets = (capability: SongSortCapability): SongSortPreset[] => (
    SONG_SORT_PRESETS.filter(preset => preset.needs === null || capability[preset.needs])
);

/** 当前选中的排序在这个列表里排不了（比如本地选了播放量）时，退回保持原序。 */
export const isSongSortFieldAvailable = (field: SongSortField, capability: SongSortCapability): boolean => {
    const preset = SONG_SORT_PRESETS.find(item => item.field === field);
    if (!preset || preset.needs === null) return true;
    return capability[preset.needs];
};

/** 当前选择在这一组预设里没有对应项时（方向被单独翻过），取同字段的第一项。 */
export const findSongSortPreset = (
    field: SongSortField,
    direction: SongSortDirection,
): SongSortPreset | undefined => (
    SONG_SORT_PRESETS.find(preset => preset.field === field && preset.direction === direction)
    ?? SONG_SORT_PRESETS.find(preset => preset.field === field)
);

export const SONG_SORT_PRESETS: readonly SongSortPreset[] = [
    { id: 'newest', field: 'addedAt', direction: 'desc', labelKey: 'songSort.newest', needs: 'addedAt', group: 'primary' },
    { id: 'oldest', field: 'addedAt', direction: 'asc', labelKey: 'songSort.oldest', needs: 'addedAt', group: 'primary' },
    { id: 'titleAsc', field: 'title', direction: 'asc', labelKey: 'songSort.titleAsc', needs: null, group: 'primary' },
    { id: 'artistAsc', field: 'artist', direction: 'asc', labelKey: 'songSort.artistAsc', needs: null, group: 'primary' },
    { id: 'likedDesc', field: 'liked', direction: 'desc', labelKey: 'songSort.likedDesc', needs: 'liked', group: 'primary' },
    { id: 'likedAsc', field: 'liked', direction: 'asc', labelKey: 'songSort.likedAsc', needs: 'liked', group: 'primary' },
    { id: 'playCountDesc', field: 'playCount', direction: 'desc', labelKey: 'songSort.playCountDesc', needs: 'playCount', group: 'primary' },
    { id: 'playCountAsc', field: 'playCount', direction: 'asc', labelKey: 'songSort.playCountAsc', needs: 'playCount', group: 'primary' },
    { id: 'default', field: 'none', direction: 'asc', labelKey: 'songSort.default', needs: null, group: 'legacy' },
    { id: 'fileNameAsc', field: 'fileName', direction: 'asc', labelKey: 'localMusic.sortByFileName', needs: 'fileName', group: 'legacy' },
    { id: 'fileLastModifiedDesc', field: 'fileLastModified', direction: 'desc', labelKey: 'localMusic.sortByModifiedDate', needs: 'fileLastModified', group: 'legacy' },
    { id: 'albumTrackAsc', field: 'albumTrack', direction: 'asc', labelKey: 'localMusic.sortByAlbumTrack', needs: 'albumTrack', group: 'legacy' },
];
