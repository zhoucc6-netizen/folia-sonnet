// android/qishui-bridge/src/car/client.js
//
// 车机 HTTP 客户端：公共读取与账号请求走两套鉴权。
//
//  - 公共读取（搜索 / 详情 / 歌单 / 媒体）：`access-token` 是一份**客户端令牌**，
//    不绑定账号，从 /client/token/get/ 拿，用完即弃；上游给了明确的过期错误码
//    28001008 时才换新的一代并重放一次（只重放已知读端点，写操作绝不重放）。
//  - 账号请求（我的歌单 / 喜欢 / 最近播放 / 加歌）：走 ticket-guard，头由
//    protocol.qishuiGuardHeaders 现签（ECDSA P-256，见 guard.js）。
//
// 与参考实现（GSQZ/qishui-music-api，MIT）逐行对应，只把鉴权头改成 await。

import { QISHUI_CLIENT_KEY, QISHUI_OPEN_HOST, QISHUI_PREFIX, QISHUI_UA, QISHUI_DOUYIN_HOST, qishuiGuardHeaders, qishuiParams } from './protocol.js';

export class QishuiError extends Error {
    constructor(code, message, upstreamCode) {
        super(message);
        this.code = code;
        this.upstreamCode = upstreamCode;
    }
}

const AUTH_CODES = [28001003, 28001007, 28001008, 10007];
// 只有已知读端点可以重放：车机 API 读写都用 POST，不能因为方法是 POST 就给写操作
// 也套一层重试（重复加歌、重复取消喜欢都是真副作用）。
const RETRYABLE_READS = new Set(['/search/', '/playlist/detail/', '/media/mget/', '/media/mcheck/',
    '/artist/detail/', '/artist/tracks/', '/feed/mode/', '/feed/song-tab/', '/me/playlist/',
    '/me/collection/mixed/', '/me/recent-played/']);

function checked(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new QishuiError('invalid-response', 'Invalid Qishui response');
    }
    const code = Number(data.err_no ?? data.data?.error_code ?? 0);
    if (code) {
        // 带上服务端自己给的说明：光有错误码（例如 ticket 那一步的 10001）在诊断里
        // 什么都看不出来，是 CSR 不被认还是 access_code 过期全靠猜。
        const nested = data.data && typeof data.data === 'object' ? data.data : null;
        const detail = [data.status_msg, data.message, data.description,
            nested?.description, nested?.message, nested?.status_msg]
            .map(value => (typeof value === 'string' ? value.trim() : ''))
            .find(Boolean) || '';
        throw new QishuiError(AUTH_CODES.includes(code) ? 'auth-required' : 'unavailable',
            detail ? `Qishui rejected the request: ${detail.slice(0, 200)}` : 'Qishui rejected the request',
            String(code));
    }
    return data;
}

// 音频直链只接受这些域：播放器会把 URL 直接交给 <audio>，不加白名单等于把
// 上游返回值当地址用。
const HOSTS = ['365yg.com', 'douyinvod.com', 'douyinscdn.com', 'bytefcdn.com', 'bytecdn.cn', 'byteicdn.com', 'ibytedtos.com',
    'pstatp.com', 'snssdk.com', 'bytedance.com', 'bytetos.com', 'volcvideo.com', 'volccdn.com', 'volces.com',
    'volcengineapi.com', 'douyin.com', 'qishui.com', 'zijieapi.com'];

export function mediaUrl(raw) {
    let url;
    try { url = new URL(String(raw)); } catch (_) { throw new QishuiError('invalid-response', 'Invalid Qishui media URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
        || !HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
        throw new QishuiError('invalid-response', 'Untrusted Qishui media host');
    }
    return url.href;
}

export function createClient({ sessions, fetch: fetcher }) {
    let tokenEntry;

    async function http(url, { body, headers = {}, form = false } = {}) {
        let response;
        try {
            response = await fetcher(url, {
                method: body === undefined ? 'GET' : 'POST',
                headers: {
                    'user-agent': QISHUI_UA,
                    ...(body === undefined ? {} : { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' }),
                    ...headers,
                },
                ...(body === undefined ? {} : { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) }),
            });
        } catch (_) {
            throw new QishuiError('network', 'Qishui service could not be reached');
        }
        if (!response.ok) {
            const status = Number(response.status);
            throw new QishuiError(status === 429 ? 'unavailable' : [401, 403].includes(status) ? 'auth-required' : 'network',
                `Qishui HTTP ${status}`);
        }
        try { return { data: checked(await response.json()), headers: response.headers }; }
        catch (error) {
            if (error instanceof QishuiError) throw error;
            throw new QishuiError('invalid-response', 'Qishui response is not JSON');
        }
    }

    const query = (path, extras = {}, deviceId = sessions.deviceId) => {
        const values = new URLSearchParams(qishuiParams(deviceId));
        Object.entries(extras || {}).forEach(([key, value]) => values.set(key, String(value)));
        return `${path}?${values}`;
    };

    const clientToken = () => {
        if (!tokenEntry) {
            const entry = {};
            entry.task = http(query(`${QISHUI_OPEN_HOST}${QISHUI_PREFIX}/client/token/get/`, { trigger_type: 'cold_start' }))
                .then(({ data }) => {
                    if (typeof data.client_token !== 'string' || !data.client_token) {
                        throw new QishuiError('invalid-response', 'Client token is missing');
                    }
                    return data.client_token;
                })
                .catch(error => {
                    if (tokenEntry === entry) tokenEntry = undefined;
                    throw error;
                });
            tokenEntry = entry;
        }
        return tokenEntry;
    };

    async function platform(path, body = {}, credential) {
        if (credential === true) {
            credential = sessions.get();
            if (!credential) throw new QishuiError('auth-required', 'Sign in to Qishui first');
        }
        const account = credential || sessions.get();
        const revision = sessions.revision;
        const request = async headers => {
            const { data } = await http(query(`${QISHUI_DOUYIN_HOST}${QISHUI_PREFIX}${path}`, {}, account?.deviceId), {
                body: { ...body, common_params: { ...(account?.userId ? { user_id: account.userId } : {}) } },
                headers,
            });
            if (!data.data || typeof data.data !== 'object') throw new QishuiError('invalid-response', 'Qishui data is missing');
            return data.data;
        };
        // ticket-guard 的失败属于账号那条路，不该拿公共客户端令牌去救。
        if (credential) return request(await qishuiGuardHeaders(credential, path));
        let token = clientToken();
        for (let attempt = 0; ; attempt++) {
            const headers = { 'access-token': await token.task };
            if (attempt && revision !== sessions.revision) {
                throw new QishuiError('unavailable', 'Qishui account changed during the request');
            }
            try {
                return await request(headers);
            } catch (error) {
                if (!(error instanceof QishuiError) || error.upstreamCode !== '28001008') throw error;
                // 上一代令牌的迟到失败不能作废更新的一代。
                if (tokenEntry === token) tokenEntry = undefined;
                if (attempt || !RETRYABLE_READS.has(path)) throw error;
                // 并发的过期读取共用同一次换牌（连同它的失败一起）。
                token = tokenEntry || (token.replacement ||= clientToken());
            }
        }
    }

    async function command(path, body = {}) {
        const credential = sessions.get();
        if (!credential) throw new QishuiError('auth-required', 'Sign in to Qishui first');
        const { data } = await http(query(`${QISHUI_DOUYIN_HOST}${QISHUI_PREFIX}${path}`, {}, credential.deviceId), {
            body: { ...body, common_params: { ...(credential.userId ? { user_id: credential.userId } : {}) } },
            headers: await qishuiGuardHeaders(credential, path),
        });
        return data.data && typeof data.data === 'object' ? data.data : {};
    }

    return { http, query, platform, command, sessions };
}

export default { createClient, QishuiError, mediaUrl };
