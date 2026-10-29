// android/qishui-bridge/src/phone/api.js
//
// 手机协议层的对外门面：把 passport 登录（auth.js）与桌面端那套 Web/PC 数据接口
// （generated/qishui-web-api.cjs）拼成与 car/api.js 同名的一组方法，
// 上层（entry.js）因此不必为两套协议分叉。
//
// ⚠ 数据层**复用桌面端已经跑通的实现**，不在安卓这边另写一套解析：/luna/pc/* 的
// 响应嵌套很深（媒体与歌单都是「遍历找字段」才稳），照抄一份等于把同一个坑踩两遍。
// 桌面端那份由 build.mjs 从 electron/qishui/qishui-api.js 原样 vendored 进来
// （只把签名桥那一处 require 换成空壳），所以两边的行为天然一致。
//
// 返回的形状就是桌面端的那一份（provider / songs / playlists / tracks …），
// 渲染层的 qishuiNormalize 本来就认它 —— 历史上桌面端走的就是这条 Web 协议。

import webApi from '../generated/qishui-web-api.cjs';
import { createAuth } from './auth.js';
import { createFetch } from '../car/transport.js';
import { QishuiError } from '../car/client.js';
import { hasLoginCookie } from './protocol.js';
import { storageMode, storageParseError, storageWriteMode, whereIs } from './storage.js';

const text = value => (value == null ? '' : String(value));

/**
 * 状态富化的时间预算。
 *
 * 「是否登录」只由 Cookie 决定；handleQishuiStatus 额外去拉资料与歌单，那是锦上添花。
 * 早先把整段 await 住：一次 /luna 卡住就能把 status 拖过插件的 25s 上限，表现成
 * 「登录超时」。所以富化单独一个预算，超时就按 Cookie 判定返回（照旧车机之前的做法）。
 */
const STATUS_ENRICH_BUDGET_MS = 15000;

const withBudget = async (promise, ms) => {
    let timer = null;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); });
    try {
        return await Promise.race([Promise.resolve(promise).catch(() => null), timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

export function createQishuiPhone(options = {}) {
    const fetcher = options.fetch || createFetch(options.transport);
    const log = options.log || (() => {});
    const auth = options.auth || createAuth(fetcher, { log });

    /** 账号级读取：没有会话 Cookie 就是没登录，不去碰数据接口。 */
    const requireSession = () => {
        const cookie = auth.cookie();
        if (!hasLoginCookie(cookie)) {
            throw new QishuiError('auth-required', 'Qishui phone protocol needs a signed-in session cookie');
        }
        return cookie;
    };

    return {
        sessions: { get: () => (auth.isLoggedIn() ? { cookie: auth.cookie() } : null) },

        /**
         * 登录态：只认手里有没有会话 Cookie。
         *
         * 字段与车机那一份对齐（storage / store / cookieKeys / loginKeys），
         * 诊断面板与「重启后账号没了」的排查两边能互相印证。
         */
        async status() {
            const cookie = auth.cookie();
            const loggedIn = hasLoginCookie(cookie);
            const base = {
                provider: 'qishui',
                configured: true,
                loggedIn,
                webSession: loggedIn,
                cookieReady: loggedIn,
                protocol: 'passport-web',
                cookieKeys: auth.cookieKeys(),
                loginKeys: auth.loginKeys(),
                storage: storageMode(),
                store: {
                    read: storageMode(),
                    write: storageWriteMode(),
                    session: whereIs('phone-session'),
                    deviceId: whereIs('phone-device-id'),
                    deviceIdReused: auth.identity.reused === true,
                    ...(storageParseError() ? { parseError: storageParseError() } : {}),
                },
                userId: '',
                libraryReady: loggedIn,
                libraryErrors: [],
            };
            if (!loggedIn) {
                return { ...base, profileReady: false, profile: null, message: '未登录：请用汽水/抖音 App 扫码（手机协议）' };
            }
            // 富化：资料与歌单。超时或失败都不推翻登录结论（凭据还在手上）。
            const enriched = await withBudget(webApi.handleQishuiStatus(cookie), STATUS_ENRICH_BUDGET_MS);
            if (!enriched) {
                return {
                    ...base,
                    profileReady: false,
                    profile: null,
                    profileError: 'the profile read did not finish in time',
                };
            }
            const profile = enriched.profile || {};
            return {
                ...base,
                userId: text(profile.userId || enriched.userId),
                profileReady: Boolean(profile.profileReady),
                profile: profile.profileReady ? {
                    id: text(profile.userId),
                    nickname: text(profile.nickname),
                    avatarUrl: text(profile.avatar),
                    ...(Number.isFinite(Number(profile.vipType)) ? { vipType: Number(profile.vipType) } : {}),
                } : null,
                ...(Array.isArray(enriched.libraryErrors) && enriched.libraryErrors.length
                    ? { libraryErrors: enriched.libraryErrors.map(item => String(item)) } : {}),
            };
        },

        async startLogin() {
            const result = await auth.start();
            // scanUrl 一起带出去：真机排查时最要紧的一句话是「码里到底装了什么地址」，
            // 而二维码是一张图，从图上根本看不出来。
            return {
                key: result.key, qrDataUrl: result.imageUrl,
                expiresAt: result.expiresAt, scanUrl: result.scanUrl,
            };
        },

        qr: key => auth.qr(key).imageUrl,
        checkLogin: key => auth.check(key),
        cancelLogin: key => { auth.cancel(key); },

        exportSession: () => auth.exportSession(),
        importSession: credential => auth.importSession(credential),
        /** 手动粘贴 Cookie 那一条路：跳过扫码，直接把会话灌进来。 */
        importCookie: raw => auth.importCookie(raw),

        logout() {
            auth.logout();
            return { provider: 'qishui', loggedIn: false, webSession: false, cookieReady: false, configured: true };
        },

        async search(keywords, limit, offset) {
            const cookie = auth.cookie();
            const data = await webApi.handleQishuiSearch(keywords, limit, cookie, offset);
            return { provider: 'qishui', ...data, offset, limit };
        },

        async songDetail(id) {
            // 详情走 SEO 端点（不需要登录），登录与否都能答。
            const data = await webApi.handleQishuiSongDetail(text(id));
            if (!data?.song) {
                throw new QishuiError('invalid-response', text(data?.error) || 'Qishui phone protocol has no such track');
            }
            return { provider: 'qishui', ...data };
        },

        async lyrics(id) {
            const data = await webApi.handleQishuiLyric(text(id), auth.cookie());
            return {
                provider: 'qishui',
                lyric: text(data?.lyric),
                tlyric: text(data?.tlyric),
                // 手机协议只有整行歌词，没有逐字（yrc）：渲染层认没有 yrc 的情况。
                source: text(data?.source) || 'none',
            };
        },

        async audio(id, quality) {
            const cookie = requireSession();
            const data = await webApi.handleQishuiSongUrl({ id: text(id), quality: text(quality || 'standard') }, cookie);
            // 与车机那份对齐：trial / url / playable 之外，把「为什么只剩试听」的现场
            // 也带出去（渲染层会把 audioMeta 写进报错文案）。
            return {
                provider: 'qishui',
                ...data,
                audioMeta: {
                    account: true,
                    protocol: 'passport-web',
                    gotFull: data?.trial === false,
                    ...(data?.restriction?.category ? { category: String(data.restriction.category) } : {}),
                },
            };
        },

        async userPlaylists(limit, offset) {
            const cookie = requireSession();
            const data = await webApi.handleQishuiUserPlaylists(cookie);
            const playlists = Array.isArray(data?.playlists) ? data.playlists : [];
            return {
                provider: 'qishui',
                ...data,
                playlists: playlists.slice(offset, offset + limit),
                total: playlists.length,
                nextOffset: offset + Math.min(limit, Math.max(0, playlists.length - offset)),
                hasMore: offset + limit < playlists.length,
            };
        },

        async playlistTracks(id, limit, offset) {
            const cookie = requireSession();
            const data = await webApi.handleQishuiPlaylistTracks(text(id), { limit, offset }, cookie);
            return { provider: 'qishui', ...data, songs: data?.tracks || [] };
        },

        /**
         * 歌手页：官方没有「按 id 取歌手」的端点，桌面端那一份是**用歌手名搜索再聚合**，
         * 所以 artistName 是必填（渲染层从搜索结果里记住了名字再传回来，
         * 见 qishuiNormalize 的 rememberQishuiArtist）。
         */
        async artist(artistId, limit, offset, artistName = '') {
            const cookie = requireSession();
            const data = await webApi.handleQishuiArtistDetail(
                { artistId: text(artistId), artistName: text(artistName), limit: limit || 36 },
                cookie,
            );
            if (data?.error && !Array.isArray(data.songs)) {
                throw new QishuiError('invalid-response', text(data.error));
            }
            return { provider: 'qishui', ...data, total: Array.isArray(data?.songs) ? data.songs.length : 0 };
        },

        async feed(limit) {
            const cookie = requireSession();
            const data = await webApi.handleQishuiFeed(limit, cookie);
            return { provider: 'qishui', ...data };
        },

        likedSongs() {
            const cookie = requireSession();
            return webApi.handleQishuiPlaylistTracks('liked', { limit: 50, offset: 0 }, cookie);
        },

        recentPlayed(limit, offset) {
            const cookie = requireSession();
            return webApi.handleQishuiPlaylistTracks('recent', { limit: limit || 50, offset: offset || 0 }, cookie)
                .then(data => ({ provider: 'qishui', songs: data?.tracks || [], hasMore: Boolean(data?.hasMore) }));
        },

        checkTracks(ids) {
            const cookie = requireSession();
            return webApi.handleQishuiCheckTracksLiked(ids, cookie);
        },

        likeSong(id, liked) {
            const cookie = requireSession();
            return webApi.handleQishuiSetTrackLiked(text(id), liked !== false, cookie)
                .then(() => ({ provider: 'qishui', success: true }));
        },

        addSongs(playlistId, ids) {
            const cookie = requireSession();
            return Promise.all((ids || []).map(trackId => webApi.handleQishuiPlaylistAddSong(
                text(playlistId), { id: text(trackId) }, cookie,
            ))).then(() => ({ provider: 'qishui', success: true }));
        },

        removeSongs(playlistId, ids) {
            // 手机协议的 PC 端点没有删歌（只有 append），明确不支持，别静默返回成功。
            throw new QishuiError('unsupported', 'Qishui phone protocol cannot remove tracks from a playlist');
        },

        dislikeSong(id, disliked) {
            throw new QishuiError('unsupported', 'Qishui phone protocol has no dislike endpoint');
        },
    };
}

export default { createQishuiPhone };
