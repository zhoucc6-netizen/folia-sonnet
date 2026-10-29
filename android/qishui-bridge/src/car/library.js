// android/qishui-bridge/src/car/library.js
//
// 账号读取与写入（喜欢 / 歌单加删歌 / 最近播放 / 不感兴趣）。
//
// 车机协议没有专辑端点，也没有「收藏歌单」端点，所以这两类操作不在这里 ——
// 上层收到的是明确的不支持，而不是假成功。

import { QishuiError } from './client.js';
import { trackEntity } from './shape.js';
import { likedPlaylist } from './catalog.js';

const MAX_BATCH = 100;
const PAGE_SIZE = 100;
const PAGE_LIMIT = 500;

const mediaId = value => {
    if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) {
        throw new QishuiError('invalid-response', 'Invalid Qishui media ID');
    }
    return value;
};
const mediaIds = value => {
    if (!Array.isArray(value) || value.length === 0) {
        throw new QishuiError('invalid-response', 'Qishui media IDs are required');
    }
    if (value.length > MAX_BATCH) {
        throw new QishuiError('unsupported', `Select at most ${MAX_BATCH} tracks per operation`);
    }
    return [...new Set(value.map(mediaId))];
};
const trackRef = id => ({ id, type: 'track' });
const requiredList = (data, fields, label) => {
    const rows = fields.map(field => data?.[field]).find(Array.isArray);
    if (!rows) throw new QishuiError('invalid-response', `Qishui ${label} is missing`);
    return rows;
};

async function likedSongs(platform) {
    const liked = await likedPlaylist(platform);
    if (!liked) return { ids: [], whole: true, total: 0 };
    const ids = new Set();
    let cursor = '';
    let whole = false;
    const seen = new Set();
    for (let page = 0; page < PAGE_LIMIT; page++) {
        seen.add(cursor);
        const data = await platform('/playlist/detail/', {
            playlist_id: liked.id, owner_id: liked.ownerId, count: PAGE_SIZE, cursor, type: 1,
        });
        const media = requiredList(data, ['media_entities', 'media_list'], 'liked playlist tracks');
        for (const item of media) {
            const entity = trackEntity(item);
            if (entity?.base_info?.id) ids.add(String(entity.base_info.id));
        }
        if (data.has_more !== true) { whole = true; break; }
        const next = String(data.next_cursor ?? '');
        if (!next || seen.has(next)) throw new QishuiError('invalid-response', 'Liked playlist cursor did not advance');
        cursor = next;
    }
    return { ids: [...ids], whole, total: ids.size };
}

async function recentPlayed(platform, limit, offset) {
    const items = [];
    let cursor = '';
    let consumed = 0;
    let hasMore = false;
    for (let page = 0; page < PAGE_LIMIT; page++) {
        const data = await platform('/me/recent-played/', {
            count: PAGE_SIZE, cursor, media_type: 'track', scene: 'me_tab',
        }, true);
        const rows = Array.isArray(data.media) ? data.media : [];
        for (const row of rows) {
            const entity = trackEntity(row?.media);
            if (!entity) continue;
            const rawPlayedAt = Number(row.play_start_timestamp);
            const playedAt = rawPlayedAt > 1e12 ? rawPlayedAt : rawPlayedAt * 1000;
            if (consumed >= offset && items.length < limit) {
                items.push({ ...entity, ...(Number.isFinite(playedAt) && playedAt > 0 ? { playedAt } : {}) });
            }
            consumed++;
        }
        const upstreamMore = data.has_more === true;
        hasMore = consumed > offset + items.length || upstreamMore;
        if (!upstreamMore || items.length >= limit) break;
        const next = String(data.next_cursor ?? '');
        if (!next || next === cursor) throw new QishuiError('invalid-response', 'Recent-played cursor did not advance');
        cursor = next;
    }
    return { items, hasMore: hasMore && items.length > 0, nextOffset: offset + items.length };
}

async function checkTracks(platform, ids) {
    const data = await platform('/media/mcheck/', { media_list: ids.map(trackRef) });
    const rows = Array.isArray(data.media_status_list) ? data.media_status_list : [];
    return {
        statuses: rows.map(row => ({
            id: String(row.id ?? ''),
            riskResult: Number(row.risk_info?.risk_result ?? -1),
            status: Number(row.risk_info?.status ?? 0),
        })),
    };
}

export function createLibrary(client) {
    const { platform, command } = client;
    return {
        likedSongs: () => likedSongs(platform),
        recentPlayed: ({ limit = 30, offset = 0 } = {}) => recentPlayed(platform, limit, offset),
        checkTracks: ({ ids }) => checkTracks(platform, mediaIds(ids)),
        async likeSong({ id, liked }) {
            const trackId = mediaId(id);
            if (liked === false) {
                await command('/media/cancel/collect/', { media: [trackRef(trackId)] });
            } else {
                await command('/media/collect/', { media: [trackRef(trackId)], scene: '', collect_action: 1 });
            }
        },
        async editPlaylist({ operation, id, ids }) {
            const playlistId = mediaId(id);
            const tracks = mediaIds(ids);
            const path = operation === 'add' ? '/playlist/append/' : '/playlist/delete/';
            if (operation !== 'add' && operation !== 'remove') {
                throw new QishuiError('unsupported', 'Unsupported playlist operation');
            }
            await command(path, { playlist_id: playlistId, media: tracks.map(trackRef) });
        },
        async dislikeSong({ id, disliked }) {
            const trackId = mediaId(id);
            await command('/dislike/', {
                item_id: trackId, author_ids: [], dislike_item_type: 'track', action_type: disliked ? 0 : 1,
            });
        },
    };
}

export default { createLibrary, likedSongs, recentPlayed, checkTracks };
