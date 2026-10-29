// src/utils/songSorting.ts
//
// 歌曲列表排序的通用比较层。它不认识 LocalSong，也不认识 Navidrome：调用方先把每首歌压成一份
// `SongSortFacts`（排序用得着的那几个值），比较只在这份事实上进行。
//
// 之所以要有这一层：排序从「只有本地文件夹能排」放开到所有列表之后，同一个排序项要在本地文件、
// Navidrome 和在线歌曲上给出同一个结果。让比较器直接吃 SongResult 会把三套取值规则揉进排序里，
// 每加一个排序项就要改三处；压成事实之后，加排序项只动这里，取值只动各自的 resolver。

export type SongSortField =
    /** 保持资源给的顺序（专辑的音轨序、歌单的自定义序）。 */
    | 'none'
    | 'addedAt'
    | 'title'
    | 'artist'
    | 'liked'
    | 'playCount'
    // 本地文件才有的三项，从 localSongSorting 时代沿用下来。
    | 'fileName'
    | 'fileLastModified'
    | 'albumTrack';

export type SongSortDirection = 'asc' | 'desc';

/** 一首歌在排序里用得着的那几个值。缺失的字段表示「这个来源没有这一项」。 */
export type SongSortFacts = {
    /** 加入曲库 / 服务端创建的时间戳（毫秒）。 */
    addedAt?: number;
    title: string;
    artist: string;
    liked: boolean;
    playCount?: number;
    fileName?: string;
    filePath?: string;
    fileLastModified?: number;
    trackNumber?: number;
    discNumber?: number;
    /** 专辑分组的身份；同名的两张专辑靠它分开（本地是实体 id，其余是专辑名）。 */
    albumGroupKey?: string;
};

const naturalCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

const compareText = (left: string, right: string): number => naturalCollator.compare(left, right);

/**
 * 有值的一边排在没值的一边前面，两个方向都一样。
 *
 * 按数值排序时缺失不是「很小」，而是「不知道」，把它当 0 会让没有播放量的歌永远压在最前面。
 */
const compareOptionalNumber = (
    left: number | undefined,
    right: number | undefined,
): number | null => {
    if (typeof left === 'number' && typeof right === 'number') {
        return left === right ? 0 : (left < right ? -1 : 1);
    }
    if (typeof left === 'number') return -1;
    if (typeof right === 'number') return 1;
    return null;
};

const compareTrackPosition = (left: SongSortFacts, right: SongSortFacts): number =>
    (left.discNumber ?? 1) - (right.discNumber ?? 1)
    || (left.trackNumber ?? 0) - (right.trackNumber ?? 0);

const compareFileName = (left: SongSortFacts, right: SongSortFacts): number =>
    compareText(left.fileName ?? '', right.fileName ?? '')
    || compareText(left.filePath ?? '', right.filePath ?? '');

/**
 * 专辑号排序：专辑组领先，音轨号只在同组内比。
 *
 * 没有音轨号的一律沉底，两个方向都一样——「没有编号」不是「编号很小」，翻个方向不该让它冒到顶上。
 * 剩下的部分交给调用方按方向翻转。
 */
const compareAlbumTrack = (
    left: SongSortFacts,
    right: SongSortFacts,
    direction: SongSortDirection,
): number => {
    const leftNumbered = typeof left.trackNumber === 'number';
    const rightNumbered = typeof right.trackNumber === 'number';
    if (leftNumbered !== rightNumbered) {
        return leftNumbered ? -1 : 1;
    }
    if (!leftNumbered) {
        return compareFileName(left, right);
    }

    const leftGroup = left.albumGroupKey ?? '';
    const rightGroup = right.albumGroupKey ?? '';
    // 归不到任何专辑的编号文件同样沉底（与「没有编号」同理）。
    if (Boolean(leftGroup) !== Boolean(rightGroup)) {
        return leftGroup ? -1 : 1;
    }

    return orient(
        compareText(leftGroup, rightGroup)
        || compareTrackPosition(left, right)
        || compareFileName(left, right),
        direction,
    );
};

/** 同一个方向的原始比较结果；`desc` 时整体翻转。 */
const orient = (result: number, direction: SongSortDirection): number => (
    direction === 'desc' ? -result : result
);

/**
 * 两首歌在给定排序项下的先后。返回 0 表示这一项分不出高下（调用方的稳定排序会保留原序）。
 *
 * `addedAt` / `playCount` 缺失时沉底，且两个方向都沉底——「不知道」不该因为翻转方向就变成「最大」。
 */
export const compareSongs = (
    left: SongSortFacts,
    right: SongSortFacts,
    field: SongSortField,
    direction: SongSortDirection = 'asc',
): number => {
    if (field === 'none') return 0;

    if (field === 'addedAt' || field === 'playCount') {
        const byValue = compareOptionalNumber(
            field === 'addedAt' ? left.addedAt : left.playCount,
            field === 'addedAt' ? right.addedAt : right.playCount,
        );
        return byValue === null ? 0 : orient(byValue, direction);
    }

    if (field === 'liked') {
        const leftWeight = left.liked ? 1 : 0;
        const rightWeight = right.liked ? 1 : 0;
        if (leftWeight === rightWeight) return 0;
        // desc：喜欢的在前（「喜欢程度 高→低」）；asc：没标记的在前。
        return orient(leftWeight < rightWeight ? -1 : 1, direction);
    }

    if (field === 'albumTrack') {
        return compareAlbumTrack(left, right, direction);
    }

    const result = field === 'title'
        ? compareText(left.title, right.title) || compareText(left.artist, right.artist)
        : field === 'artist'
            ? compareText(left.artist, right.artist) || compareText(left.title, right.title)
            : field === 'fileLastModified'
                ? compareOptionalNumber(left.fileLastModified, right.fileLastModified) ?? compareFileName(left, right)
                : compareFileName(left, right);

    return orient(result, direction);
};

export const sortSongs = <T,>(
    songs: readonly T[],
    factsOf: (song: T) => SongSortFacts,
    field: SongSortField,
    direction: SongSortDirection = 'asc',
): T[] => [...songs].sort((left, right) => compareSongs(factsOf(left), factsOf(right), field, direction));
