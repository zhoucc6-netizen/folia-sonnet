import type { SongResult } from '../../types';
import type { OnlineProviderId, ProviderSongMetadata } from '../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { getOnlineMusicProvider } from './providerRegistry';
import { requestSongCoverFallback, resolveProxiedSongCover } from './onlineCoverFallback';

// src/services/onlineMusic/songMetadata.ts

// Resolves legacy provider fields once at the provider boundary and exposes only canonical song metadata to consumers.
export const getProviderSongMetadata = (
    song: SongResult | null | undefined,
    providerId?: OnlineProviderId,
): ProviderSongMetadata => {
    if (!song) {
        return {
            artists: [],
            album: { id: 0, name: '' },
            durationMs: 0,
            aliases: [],
            translatedNames: [],
        };
    }
    const sourceRef = getPlaybackSourceRef(song);
    const provider = getOnlineMusicProvider(
        providerId || (sourceRef.kind === 'online' ? sourceRef.providerId : ''),
    );
    return provider?.songMetadata?.getSongMetadata(song) || createProviderSongMetadata(song);
};

export const getSongArtistLabel = (song: SongResult | null | undefined, providerId?: OnlineProviderId): string => (
    song ? getProviderSongMetadata(song, providerId).artists.map(artist => artist.name).filter(Boolean).join(', ') : ''
);

export const getSongAlbumLabel = (song: SongResult | null | undefined, providerId?: OnlineProviderId): string => (
    song ? getProviderSongMetadata(song, providerId).album?.name || '' : ''
);

export const getSongDurationMs = (song: SongResult | null | undefined, providerId?: OnlineProviderId): number => (
    song ? getProviderSongMetadata(song, providerId).durationMs : 0
);

/**
 * 取封面。**没有封面时顺手排一次网络兜底**（按歌名去别的平台搜一张）。
 *
 * 挂在这里而不是某一个 provider 的出口，是因为网格布局、墙面布局、队列磁贴、控制面板、
 * 播放页背景 / 莫奈背景全都读这一个函数 —— 只在 provider 出口补的话，队列里那份
 * 「建队时烤进去的快照」和就地算出来的那些背景照样是空的。
 *
 * 兜底是异步的：这里照旧同步返回（现在是空），搜到之后由 onlineCoverFallback 写回
 * 并广播，界面自己重画。缓存 / 预算 / 串行都在那一侧，重复调用不会有额外开销。
 */
export const getSongCoverUrl = (song: SongResult | null | undefined, providerId?: OnlineProviderId): string | undefined => {
    if (!song) return undefined;
    const coverUrl = getProviderSongMetadata(song, providerId).coverUrl;
    if (!coverUrl) {
        requestSongCoverFallback(song);
        return undefined;
    }
    // 自建服务（飞牛）的封面要 Cookie 才给图，而 <img> 与通知栏那一路都带不上 ——
    // 换成回环代理地址，两边就都能取到字节了。
    return resolveProxiedSongCover(song, coverUrl) || undefined;
};

export const getProviderSongPageUrl = (song: SongResult | null | undefined, providerId?: OnlineProviderId): string | null => {
    if (!song) return null;
    const sourceRef = getPlaybackSourceRef(song);
    const provider = getOnlineMusicProvider(providerId || (sourceRef.kind === 'online' ? sourceRef.providerId : ''));
    return provider?.getSongPageUrl?.(song) || null;
};
