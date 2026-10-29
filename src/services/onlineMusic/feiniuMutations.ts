import type { MediaId, OnlineMutationProvider, ProviderCollection } from '../../types/onlineMusic';
import type { SongResult } from '../../types';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { OnlineProviderError } from '../../types/onlineMusic';
import { FEINIU_ALL_TRACKS_ID, FEINIU_FAVORITE_ID } from './feiniuCatalog';
import { feiniuRequest } from './feiniuTransport';

// src/services/onlineMusic/feiniuMutations.ts
// 收藏与歌单增删。飞牛的收藏是独立的接口（不是某个歌单），所以「我喜欢的」那条伪歌单
// 只接受收藏动作，不接受增删曲目。「全部歌曲」是曲目列表本身，同样不是真歌单。

const trackGuidOf = (song: MediaId | SongResult): string => {
    if (typeof song === 'string' || typeof song === 'number') return String(song);
    const source = getPlaybackSourceRef(song);
    if (source.kind !== 'online' || source.providerId !== 'feiniu') {
        throw new OnlineProviderError('unsupported', 'Song does not belong to FeiNiu', 'feiniu');
    }
    return String(source.mediaId);
};

export const feiniuMutations: OnlineMutationProvider = {
    /** 两条伪歌单都不是真歌单（收藏 / 曲目列表本身），往里加歌要走各自的接口。 */
    canAddToPlaylist: playlist => (
        String(playlist.id) !== FEINIU_FAVORITE_ID
        && String(playlist.id) !== FEINIU_ALL_TRACKS_ID
        && playlist.isLiked !== true
    ),

    async likeSong(song, liked) {
        await feiniuRequest(liked ? '/favorite-track/create' : '/favorite-track/delete', {
            method: 'POST',
            body: { trackGUID: trackGuidOf(song) },
        });
    },

    async updatePlaylistTracks(operation, playlist, tracks) {
        const guid = typeof playlist === 'string' || typeof playlist === 'number'
            ? String(playlist)
            : String(playlist.id);
        if (guid === FEINIU_FAVORITE_ID || guid === FEINIU_ALL_TRACKS_ID) {
            throw new OnlineProviderError('unsupported', 'FeiNiu built-in collections cannot be edited as a playlist', 'feiniu');
        }
        const trackGUIDs = tracks.map(trackGuidOf);
        if (trackGUIDs.length === 0) return;
        await feiniuRequest(operation === 'add' ? '/playlist/add-track' : '/playlist/remove-track', {
            method: 'POST',
            body: { guid, trackGUIDs },
        });
    },
};

/** 播放上报（飞牛的「最近播放」与统计靠它）。 */
export const reportFeiniuPlayback = async (song: SongResult): Promise<void> => {
    const guid = trackGuidOf(song);
    await feiniuRequest('/event/report', {
        method: 'POST',
        body: {
            events: [{
                eventType: 'track_play',
                occurredAt: Date.now(),
                payload: { trackGUID: guid },
            }],
        },
    });
};

export const isFeiniuPlaylistEditable = (collection: ProviderCollection): boolean => (
    String(collection.id) !== FEINIU_FAVORITE_ID && collection.isLiked !== true
);
