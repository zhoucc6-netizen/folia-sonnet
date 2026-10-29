// android/qishui-bridge/src/car/catalog.js
//
// 车机目录读：搜索、详情、歌单曲目、我的歌单、歌手。
//
// 端点与翻页方式照 GSQZ/qishui-music-api（MIT）：车机的歌单不是行号分页而是
// **游标**，所以带 offset 的读取要从头翻（playlistPage），这一点与上游一致。
// 专辑不在车机协议里（/media/mget/ 拒绝 type album，也没有专辑端点），所以本文件
// 不提供专辑读取 —— 上层要给出明确错误，不要拿搜索结果冒充专辑。

import { QishuiError } from './client.js';
import { toFoliaSongs, toFoliaPlaylists, trackEntity } from './shape.js';
import { randomHex } from './bytes.js';

const array = (value, field) => {
    if (!Array.isArray(value)) throw new QishuiError('invalid-response', `Qishui ${field} is missing`);
    return value;
};

async function search(platform, query, type, limit, offset) {
    const items = [];
    const searchId = randomHex(16);
    let cursor = offset;
    let more = false;
    while (items.length < limit) {
        const data = await platform('/search/', {
            q: query, cursor: String(cursor), search_id: searchId, from_search_id: searchId,
            search_method: 'input', search_type: type, search_scene: 'normal', scene_name: 'search',
            ab_param: '', last_viewed_media: {},
        });
        const groups = array(data.result_groups, 'search groups');
        const group = groups.find(value => value.id === `${type}s`) || groups[0];
        if (!group) break;
        const batch = array(group.data, 'search items').map(value => value.entity?.[type]).filter(Boolean);
        const remaining = limit - items.length;
        items.push(...batch.slice(0, remaining));
        more = batch.length > remaining || group.has_more === true;
        if (!batch.length || !more || items.length === limit) break;
        const next = Number(group.next_cursor);
        if (!Number.isSafeInteger(next) || next <= cursor) break;
        cursor = next;
    }
    return { items, hasMore: more && items.length > 0, nextOffset: offset + items.length };
}

/** 带 offset 的歌单读取：游标不是行号，只能从头翻过去。 */
// count 可调：只要第一首（封面兜底那一步）时传 1，别为一张图拉满 100 首。
async function playlistPage(platform, id, ownerId, limit, offset, count = 100) {
    let cursor = '0';
    let consumed = 0;
    const seen = new Set();
    const items = [];
    let collection;
    let hasMore = false;
    while (items.length < limit && seen.size < 500) {
        seen.add(cursor);
        const data = await platform('/playlist/detail/', {
            playlist_id: id, owner_id: ownerId || '', count, cursor, type: null,
        });
        collection ||= data.playlist;
        const batch = array(data.media_entities, 'playlist tracks');
        const start = Math.max(0, offset - consumed);
        const remaining = limit - items.length;
        items.push(...batch.slice(start, start + remaining).map(trackEntity));
        consumed += batch.length;
        const next = String(data.next_cursor ?? '');
        const upstreamMore = data.has_more === true;
        hasMore = consumed > offset + items.length || upstreamMore;
        if (!upstreamMore || items.length === limit) break;
        if (!batch.length || !next || seen.has(next)) throw new QishuiError('invalid-response', 'Playlist cursor did not advance');
        cursor = next;
    }
    return { items, collection, hasMore: hasMore && items.length > 0, nextOffset: offset + items.length };
}

/** 我的喜欢是一个 type 1 的普通歌单，id 不固定 —— 每次都要先找出来。 */
export async function likedPlaylist(platform) {
    let cursor = '';
    const seen = new Set();
    for (let page = 0; page < 20; page++) {
        seen.add(cursor);
        const data = await platform('/me/playlist/', { count: 100, cursor, item_types: ['playlist'] }, true);
        const rows = Array.isArray(data.playlists) ? data.playlists
            : Array.isArray(data.playlist_list) ? data.playlist_list : null;
        if (!rows) throw new QishuiError('invalid-response', 'Qishui account playlists is missing');
        for (const row of rows) {
            const playlist = row?.playlist || row || {};
            const base = playlist.base_info || {};
            if (Number(base.type) === 1 && base.id) {
                return { id: String(base.id), ownerId: String(base.owner_id || '') };
            }
        }
        if (data.has_more !== true) return null;
        const next = String(data.next_cursor ?? '');
        if (!next || seen.has(next)) throw new QishuiError('invalid-response', 'Account playlist cursor did not advance');
        cursor = next;
    }
    throw new QishuiError('invalid-response', 'Account playlist page limit reached');
}

export function createCatalog({ platform }) {
    return {
        searchSongs: ({ query, limit, offset }) => search(platform, query, 'track', limit, offset),
        searchPlaylists: ({ query, limit, offset }) => search(platform, query, 'playlist', limit, offset),

        /**
         * 完整 track entity（含 player_info，播放要用），不裁剪。
         *
         * `credential` 传凭据就走账号那条路（ticket-guard 签名）—— 见 api.js 的
         * `accountTrack`：受版权保护的曲子用公共客户端令牌问，上游**根本不给 full**
         * （player_info 里只有 preview），表现是「每首歌都 only offers a preview」。
         */
        async track(id, options = {}) {
            const data = await platform('/media/mget/', { media_list: [{ id, type: 'track' }], card_context: {} },
                options.credential);
            const media = array(data.media_list, 'media list')
                .find(item => String(item.media_id || item.track_entity?.base_info?.id) === id);
            if (!media?.track_entity) throw new QishuiError('not-playable', 'Qishui did not return the track');
            return media.track_entity;
        },

        playlistTracks: ({ id, ownerId, limit, offset, count }) => playlistPage(platform, id, ownerId, limit, offset, count),

        async userPlaylists({ limit, offset }) {
            const items = [];
            for (const [path, field, owned] of [
                ['/me/playlist/', 'playlists', true],
                ['/me/collection/mixed/', 'mixed_collections', false],
            ]) {
                let cursor = '';
                const seen = new Set();
                for (let page = 0; page < 500; page++) {
                    seen.add(cursor);
                    const data = await platform(path, { count: 100, cursor, item_types: ['playlist'] }, true);
                    const rows = Array.isArray(data[field]) ? data[field] : (path === '/me/playlist/' ? data.playlist_list : undefined);
                    if (Array.isArray(rows)) {
                        for (const row of rows) {
                            const playlist = row?.playlist || row;
                            if (playlist?.base_info?.id) items.push({ ...playlist, isOwned: owned });
                        }
                    }
                    if (data.has_more !== true) break;
                    const next = String(data.next_cursor ?? '');
                    if (!next || seen.has(next) || !rows || !rows.length || page === 499) {
                        throw new QishuiError('invalid-response', 'Account playlist cursor did not advance');
                    }
                    cursor = next;
                }
            }
            const unique = [...new Map(items.map(item => [String(item.base_info.id), item])).values()];
            return {
                items: unique.slice(offset, offset + limit),
                total: unique.length,
                nextOffset: offset + Math.min(limit, Math.max(0, unique.length - offset)),
                hasMore: offset + limit < unique.length,
            };
        },

        async artistDetail({ id }) {
            const data = await platform('/artist/detail/', { artist_id: id });
            return data.artist_info;
        },

        async artistSongs({ id, limit, offset }) {
            // 上游在空页上会一直回 has_more，所以只取第一屏的热门曲目再内存分页。
            const data = await platform('/artist/tracks/', { artist_id: id, count: 50, cursor: '0' });
            const tracks = array(data.tracks, 'artist tracks').map(trackEntity);
            return {
                items: tracks.slice(offset, offset + limit),
                total: tracks.length,
                nextOffset: Math.min(offset + limit, tracks.length),
                hasMore: offset + limit < tracks.length,
            };
        },
    };
}

export { search, playlistPage, toFoliaSongs, toFoliaPlaylists };
