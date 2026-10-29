import type { SongResult } from '../types';
import { getSongCoverUrl } from '../services/onlineMusic/songMetadata';
import { toSafeRemoteUrl } from './appPlaybackHelpers';

// src/utils/coverUrlResolver.ts
//
// 住在 utils 而不是 components/app/playback：它只有三行逻辑、不碰 React，却被
// stores/usePlaybackStore 用（store 不能依赖组件目录）。

// Resolves the effective cover URL by preferring the cached cover over remote metadata.
export const createCoverUrlResolver = (
    cachedCoverUrl: string | null,
    currentSong: SongResult | null,
) => {
    return () => {
        if (cachedCoverUrl) return cachedCoverUrl;
        const url = getSongCoverUrl(currentSong) || null;
        return toSafeRemoteUrl(url) || null;
    };
};
