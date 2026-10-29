// android/qishui-bridge/src/car/playback.js
//
// 播放地址：只挑上游给的**明文**资源。
//
// 车机的 player_info 里有 full / preview 两套 video_model，每套下面可能挂多个清晰度
// 的直链；带加密标记（encrypt_info / PlayAuth）的一律跳过 —— 那需要提取音频密钥，
// Folia 不做，也不做解密（旧协议层那套 #auth= 解密代理在这里用不上：车机给的是
// 火山视频模型，不是同一种封装）。

import { QishuiError, mediaUrl } from './client.js';

const levels = { medium: 'standard', higher: 'high', highest: 'high', lossless: 'lossless', hi_res: 'hires' };
const rank = value => ['standard', 'high', 'lossless', 'hires'].indexOf(value);
const encrypted = item => Boolean(item.encrypt_info?.encrypt || item.encrypt_info?.spade_a
    || item.PlayAuth || Number(item.Encrypt || 0));

// Folia 的音质档位比车机多一个 ultra，落在 high 与 lossless 之间。
const requestedRank = value => (value === 'ultra' ? 'lossless' : (levels[value] || value || 'standard'));

export async function resolveAudio(client, track, requested) {
    const player = track?.player_info;
    if (!player) throw new QishuiError('not-playable', 'Qishui returned no player information');
    const wanted = rank(requestedRank(requested)) < 0 ? 'standard' : requestedRank(requested);
    for (const variant of ['full', 'preview']) {
        const info = player[variant]?.video_model_info;
        if (!info) continue;
        const candidates = [];
        if (info.video_model) {
            let model;
            try {
                model = typeof info.video_model === 'string' ? JSON.parse(info.video_model) : info.video_model;
            } catch (_) {
                throw new QishuiError('invalid-response', 'Invalid Qishui player model');
            }
            for (const item of model.video_list || []) {
                if (encrypted(item) || !item.main_url) continue;
                candidates.push({
                    url: mediaUrl(item.main_url),
                    quality: levels[item.video_meta?.quality] || 'standard',
                    bitrate: Number(item.video_meta?.bitrate || 0),
                });
            }
        }
        // 这一拍失败**不能让整首歌挂掉**：full 换不出明文就还有 preview 可以试，
        // 丢出去的话用户看到的是「没法播放」，而不是至少能听一段。
        if (!candidates.length && info.url_player_info) {
            let list = null;
            try {
                const { data } = await client.http(mediaUrl(info.url_player_info));
                list = data.Result?.Data?.PlayInfoList || data.data?.PlayInfoList || data.PlayInfoList;
            } catch (_) {
                list = null;
            }
            for (const item of Array.isArray(list) ? list : []) {
                if (encrypted(item) || !item.MainPlayUrl) continue;
                candidates.push({
                    url: mediaUrl(item.MainPlayUrl),
                    quality: levels[item.Quality] || 'standard',
                    bitrate: Number(item.Bitrate || 0),
                });
            }
        }
        if (!candidates.length) continue;
        const allowed = candidates.filter(item => rank(item.quality) <= rank(wanted));
        const source = (allowed.length ? allowed : candidates)
            .sort((a, b) => rank(b.quality) - rank(a.quality) || b.bitrate - a.bitrate)[0];
        const clipStartMs = variant === 'preview' ? Number(player.preview?.duration?.start_ms) : 0;
        return {
            url: source.url,
            quality: source.quality,
            playable: true,
            trial: variant === 'preview',
            fetchedAt: Date.now(),
            ...(Number(info.expire_at) > Date.now() / 1000 ? { expiresAt: Number(info.expire_at) * 1000 } : {}),
            ...(Number.isFinite(clipStartMs) && clipStartMs > 0 ? { clipStartMs } : {}),
        };
    }
    throw new QishuiError('not-playable', 'Qishui returned protected audio only; decryption is disabled');
}

export default { resolveAudio };
