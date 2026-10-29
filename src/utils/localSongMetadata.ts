import type { LocalSong } from '../types';
import type { LocalSongImportedMetadata, LocalSongOnlineMetadata } from '../types/localLibrary';
import { cleanLocalLibraryName, splitLocalLibraryArtistNames } from './localLibraryNames';

// src/utils/localSongMetadata.ts
// Resolves canonical local-song metadata while keeping imported and online snapshots internal.

export const stripLocalAudioExtension = (fileName: string): string => (
  fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/iu, '').trim()
);

const KNOWN_AUDIO_EXTENSIONS = /\.(mp3|flac|m4a|wav|ogg|opus|aac|alac|ape|wv|tta|wma|aif|aiff|caf)$/i;

/**
 * 从文件名里认歌手与标题（"Artist - Title.mp3" / "Artist-Title.mp3"）。
 *
 * 搬到这里是为了让**每一条**入库路径都能用上：设备扫描那条原本就靠它兜底，
 * 而安卓「挑文件导入」那条只认内嵌标签和 MediaStore —— 两者都给不出歌手时（内嵌标签
 * 是空的很常见）这首歌就彻底没有歌手，播放页、歌词壁纸、莫奈的歌手位一律是空的。
 */
export const extractMetadataFromFilename = (fileName: string): { title?: string; artist?: string } => {
  const nameWithoutExt = String(fileName || '')
    .replace(KNOWN_AUDIO_EXTENSIONS, '')
    // cue 切分出来的序号前缀："01. " / "01 - " / "1-01 "
    .replace(/^\d{1,3}(?:[-.]\d{1,3})?(?:\s*[-.]\s*|\s+)/, '')
    .trim();

  const spaced = nameWithoutExt.split(' - ');
  if (spaced.length === 2 && spaced[0].trim() && spaced[1].trim()) {
    return { artist: spaced[0].trim(), title: spaced[1].trim() };
  }

  // 不带空格的 "-"，但要躲开单词中间的连字符：取最后一个。
  const lastDashIndex = nameWithoutExt.lastIndexOf('-');
  if (lastDashIndex > 0 && lastDashIndex < nameWithoutExt.length - 1) {
    const potentialTitle = nameWithoutExt.substring(0, lastDashIndex).trim();
    const potentialArtist = nameWithoutExt.substring(lastDashIndex + 1).trim();
    if (potentialTitle && potentialArtist) {
      return { artist: potentialArtist, title: potentialTitle };
    }
  }

  return { title: nameWithoutExt };
};

export const buildImportedMetadataSnapshot = ({
  fileName,
  embeddedTitle,
  fallbackTitle,
  embeddedArtist,
  embeddedArtists,
  fallbackArtist,
  embeddedAlbum,
  fallbackAlbum,
}: {
  fileName: string;
  embeddedTitle?: string;
  fallbackTitle?: string;
  embeddedArtist?: string;
  embeddedArtists?: string[];
  fallbackArtist?: string;
  embeddedAlbum?: string;
  fallbackAlbum?: string;
}): LocalSongImportedMetadata => {
  const normalizedEmbeddedTitle = cleanLocalLibraryName(embeddedTitle);
  const title = normalizedEmbeddedTitle
    || cleanLocalLibraryName(fallbackTitle)
    || stripLocalAudioExtension(fileName)
    || fileName;
  const embeddedArtistNames = (embeddedArtists || []).flatMap(splitLocalLibraryArtistNames);
  /*
   * 最后一档兜底是文件名。
   *
   * 内嵌标签与 MediaStore 都给不出歌手是很常见的（很多文件压根没写标签），而文件名
   * "歌手 - 歌名" 里往往就有。少了这一档，这首歌在播放页与歌词壁纸上就永远没有歌手 ——
   * 莫奈那个位置更是直接退回占位文案。
   */
  const filenameArtist = extractMetadataFromFilename(fileName).artist;
  return {
    title,
    titleSource: normalizedEmbeddedTitle ? 'embedded' : 'filename',
    artistNames: embeddedArtistNames.length > 0
      ? embeddedArtistNames
      : splitLocalLibraryArtistNames(embeddedArtist || fallbackArtist || filenameArtist),
    albumName: cleanLocalLibraryName(embeddedAlbum || fallbackAlbum),
  };
};

/**
 * 这首歌的标题还归「导入时读到的那套」管吗。
 *
 * 'manual'（用户在管理歌曲里手改的名字）也算这一类：它只是把 title 换了个写法，并没有
 * 引入在线元数据，所以歌手 / 专辑仍然要看导入的那份快照。加了 'manual' 之后，凡是原本写
 * `titleOrigin === 'import'` 的地方都得换成这个判定 —— 否则手动改过名的歌会突然没有歌手。
 */
export const usesImportedSongMetadata = (
  song: Pick<LocalSong, 'titleOrigin'> | null | undefined,
): boolean => song?.titleOrigin === 'import' || song?.titleOrigin === 'manual';

export const getLocalSongImportedArtistNames = (song: LocalSong): string[] => (
  song.importedMetadata.artistNames
);

export const getLocalSongImportedAlbumName = (song: LocalSong): string | undefined => (
  song.importedMetadata.albumName
);

export const getLocalSongOnlineCoverUrl = (song: LocalSong): string | undefined => (
  song.onlineMetadata?.coverUrl
);

export const getLocalSongOnlineArtistNames = (online?: LocalSongOnlineMetadata): string[] => (
  online?.artists.map(artist => cleanLocalLibraryName(artist.name)).filter((name): name is string => Boolean(name)) || []
);
