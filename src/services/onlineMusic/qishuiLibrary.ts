import type { MediaId, OnlineLibraryProvider, ProviderCollection } from '../../types/onlineMusic';
import { backfillQishuiCollectionCovers, normalizeQishuiCollection, qishuiPage } from './qishuiNormalize';
import { QISHUI_LIKED_PLAYLIST_ID, qishuiTrackPage } from './qishuiCatalog';
import { requestQishui, throwQishuiDataError } from './qishuiTransport';

// src/services/onlineMusic/qishuiLibrary.ts

const playlistCache = new Map<string, { at: number; items: ProviderCollection[] }>();
export const clearQishuiLibraryCache = () => playlistCache.clear();

// /luna 那一路的失败原因留在协议层的 libraryErrors 里，但歌单拉空时上层只看到
// 「没有数据」，看不出是被签名挡了还是接口换了。这里记一句，由 useQishuiLibrary
// 读走（不能直接 import qishuiProvider —— 它反过来 import 本文件，会成环）。
let lastQishuiLibraryNote: string | null = null;
export const getQishuiLibraryNote = (): string | null => lastQishuiLibraryNote;

// `user.playlists` 一次就把整库（含我的喜欢 / 最近播放 / 推荐流的虚拟歌单）带回来，没有分页参数。
async function allPlaylists(userId: MediaId): Promise<ProviderCollection[]> {
    const data = await requestQishui<any>('user.playlists', {});
    throwQishuiDataError(data);
    const raw = Array.isArray(data.playlists) ? data.playlists : [];
    const errors = Array.isArray(data.libraryErrors) ? data.libraryErrors.map(String) : [];
    lastQishuiLibraryNote = errors.length
        ? `/luna errors: ${errors.join(' | ')}`
        : '/luna ok (no errors)';
    const items = await backfillQishuiCollectionCovers(raw.map((item: unknown) => normalizeQishuiCollection(item)));
    playlistCache.set(String(userId), { at: Date.now(), items });
    return items;
}

export const qishuiLibrary: OnlineLibraryProvider = {
    async getUserPlaylists(userId, limit, offset) {
        const cached = playlistCache.get(String(userId));
        const items = offset > 0 && cached && Date.now() - cached.at < 60_000 ? cached.items : await allPlaylists(userId);
        return qishuiPage(items.slice(offset, offset + limit), items.length, offset, limit);
    },
    // 汽水没有「我的专辑」operation（收藏只能写不能列），因此不实现 getUserAlbums。
    async getLikedSongIds() {
        const ids = new Set<MediaId>();
        let offset = 0;
        // 翻到平台说没有下一页才算整份；中途 break 的都是「只拿到一部分」。
        let whole = false;
        while (true) {
            const page = await qishuiTrackPage(QISHUI_LIKED_PLAYLIST_ID, 100, offset);
            const previousCount = ids.size;
            page.items.forEach(song => ids.add(song.id));
            if (!page.hasMore) {
                whole = true;
                break;
            }
            if (page.nextOffset <= offset || ids.size === previousCount) break;
            offset = page.nextOffset;
        }
        return { ids: [...ids], whole };
    },
};
