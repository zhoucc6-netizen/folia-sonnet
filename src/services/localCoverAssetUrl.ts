import type { LocalSong } from '../types';
import { isValidLocalCoverAssetId, isLocalCoverWebRuntimeSupported } from './localCoverBinaryStore';
import { getSizedCoverUrl } from '../utils/coverUrl';

// src/services/localCoverAssetUrl.ts
// Resolves content-addressed local covers to stable Electron or same-origin Web resource URLs.

const WEB_COVER_PATH_PREFIX = '/__folia_cover/';

const hasElectronCoverProtocol = (): boolean => (
  typeof window !== 'undefined' && typeof window.electron?.hasLocalCoverAsset === 'function'
);

export const getLocalCoverAssetUrl = (assetId: string | undefined, size?: number): string | null => {
  if (!isValidLocalCoverAssetId(assetId)) return null;
  let url: string;
  if (hasElectronCoverProtocol()) {
    url = `folia-cover://asset/${encodeURIComponent(assetId)}`;
  } else {
    if (!isLocalCoverWebRuntimeSupported()) return null;
    url = `${WEB_COVER_PATH_PREFIX}${encodeURIComponent(assetId)}`;
  }
  return size ? getSizedCoverUrl(url, size) : url;
};

export const isLocalCoverAssetUrl = (url: string | null | undefined): url is string => (
  typeof url === 'string'
  && (url.startsWith('folia-cover://asset/') || url.startsWith(WEB_COVER_PATH_PREFIX))
);

/**
 * 这首歌现在该用哪张封面。
 *
 * `useOnlineCover` 只是「优先用哪张」的开关，**不是**「有没有在线封面」 ——
 * 关着的时候在线封面仍然要当兜底。各处手写这段 if/else 时漏过这个兜底（建队列那处
 * 就漏了，于是匹配来的在线封面在 `useOnlineCover` 为 false 的歌上直接消失），
 * 所以这里收成一处，别再到处抄。
 */
export const getPreferredLocalSongCoverUrl = (song: LocalSong, size?: number): string | null => {
  const localCoverUrl = getLocalCoverAssetUrl(song.localCoverAssetId, size ?? 1024);
  return song.useOnlineCover
    ? song.onlineMetadata?.coverUrl || localCoverUrl
    : localCoverUrl || song.onlineMetadata?.coverUrl || null;
};
