import type { LocalSong, SongResult, UnifiedSong } from '../../../types';
import { isLocalPlaybackSong, isNavidromePlaybackSong, resolveNavidromePlaybackCarrier } from '../../../utils/appPlaybackGuards';
import { getImportedAlbumName } from '../../../utils/localLibraryNames';
import type { SongSortFacts } from '../../../utils/songSorting';

// src/library/core/model/songSortFacts.ts
//
// 把一首展示曲目压成排序用的那几个值。三个来源各自的取值规则只写在这里：
// 本地读曲库记录，Navidrome 读它自己的载体，在线只有名字和歌手。
//
// 「喜欢」不在曲目上：本地是「我喜欢的」那份歌单，Navidrome 是 starred 集合，在线是 provider 的
// 已喜欢列表，三套都由调用方注入成一个判别式，这里不关心它们怎么来。

export type SongSortFactSources = {
    /** 本地曲库按 songId 索引；只有本地集合给。 */
    localSongsById?: ReadonlyMap<string, LocalSong>;
    /** 喜欢状态。`resolveSongLiked` 的三套后端在这里合成一个。 */
    isLiked?: (track: SongResult) => boolean;
};

const joinArtistNames = (names: readonly string[] | undefined): string => (names ?? []).join(', ');

const localFacts = (song: LocalSong, track: SongResult): SongSortFacts => ({
    addedAt: song.addedAt,
    title: song.title?.trim() || song.fileName,
    artist: joinArtistNames(song.onlineMetadata?.artists.map(artist => artist.name))
        || joinArtistNames(song.importedMetadata?.artistNames),
    liked: false,
    playCount: undefined,
    fileName: song.fileName,
    filePath: song.filePath,
    fileLastModified: song.fileLastModified,
    trackNumber: song.trackNumber,
    discNumber: song.discNumber,
    albumGroupKey: track.album?.entityId || getImportedAlbumName(song) || '',
});

const navidromeFacts = (track: SongResult): SongSortFacts => {
    const carrier = resolveNavidromePlaybackCarrier(track);
    const data = carrier?.navidromeData as Record<string, unknown> | undefined;
    const created = typeof data?.created === 'string' ? Date.parse(data.created) : Number.NaN;
    const artist = typeof data?.artist === 'string' && data.artist
        ? data.artist
        : joinArtistNames(track.artists?.map(item => item.name));

    return {
        addedAt: Number.isNaN(created) ? undefined : created,
        title: (typeof data?.title === 'string' && data.title) ? data.title : track.name,
        artist,
        liked: false,
        playCount: typeof data?.playCount === 'number' ? data.playCount : undefined,
        fileName: undefined,
        filePath: undefined,
        fileLastModified: undefined,
        trackNumber: typeof data?.track === 'number' ? data.track : undefined,
        discNumber: typeof data?.discNumber === 'number' ? data.discNumber : undefined,
        albumGroupKey: track.album?.entityId || track.album?.name || '',
    };
};

const onlineFacts = (track: SongResult): SongSortFacts => ({
    addedAt: undefined,
    title: track.name ?? '',
    artist: joinArtistNames(track.artists?.map(item => item.name)),
    liked: false,
    playCount: undefined,
    fileName: undefined,
    filePath: undefined,
    fileLastModified: undefined,
    trackNumber: undefined,
    discNumber: undefined,
    albumGroupKey: track.album?.entityId || track.album?.name || '',
});

/** 造一个 resolver：给定曲目，给出它参与排序的那几个值。 */
export const buildSongSortFactResolver = (
    sources: SongSortFactSources,
): (track: SongResult) => SongSortFacts => {
    const { localSongsById, isLiked } = sources;

    return (track: SongResult): SongSortFacts => {
        let facts: SongSortFacts;
        if (isLocalPlaybackSong(track) && localSongsById?.size) {
            const songId = (track as UnifiedSong).localRef?.songId;
            const song = songId ? localSongsById.get(songId) : undefined;
            facts = song ? localFacts(song, track) : onlineFacts(track);
        } else if (isNavidromePlaybackSong(track)) {
            facts = navidromeFacts(track);
        } else {
            facts = onlineFacts(track);
        }

        return isLiked ? { ...facts, liked: isLiked(track) } : facts;
    };
};
