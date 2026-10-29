// android/qishui-bridge/src/phone/protocol.js
//
// 手机协议（passport 扫码 → 会话 Cookie，数据走 api.qishui.com 的 PC/Web 接口）的常量与登录请求。
//
// 与车机协议（car/）的关系：两套协议**各自独立一套凭据**，互不认识 ——
// 车机是 ticket-guard（抖音开放平台扫码换 ticket），手机是 passport 会话 Cookie
// （扫码确认后由 Set-Cookie 下发）。选哪套登录就用哪套拉数据，切协议等于重新登录一次。
//
// ⚠ 这一路**没有 a_bogus / msToken 那种签名**：实测（2026-10）passport 的出码与轮询、
// 以及 /luna/pc/* 的数据接口都不再要求 a_bogus / X-Helios-X-Medusa —— 缺签名时它们
// 要么照常回数据，要么回「登录状态已失效」这种只看 Cookie 的答案。这是它能在安卓上
// 活着的前提：车机协议当初就是为了绕开「/luna 只认 bdms.node（Windows x64 原生模块）」
// 才换的，而现在上游已经不再校验。桌面的 a_bogus 隐藏窗签名（sdk-glue / bdms）
// 因此一律不需要，也**不能**再引回来。
//
// 但有两样东西**不是签名、却必须有**（对齐桌面端 `qishui-auth-v6.js` 的 request）：
//   1. `Cookie` —— 出码/确认/轮询必须是同一个 passport 会话，见 passportRequest；
//   2. POST 的 `x-ss-stub` —— 请求体的 MD5 十六进制大写，上游用它挡空体与重放。
//
// 设备指纹（device_id / install_id）只用于 passport 那一侧：生成一次存起来，
// 每次启动换一套会让上游把扫码判成风险设备。

import { createHash } from 'crypto';

export const QISHUI_PHONE_API_BASE = 'https://api.qishui.com';
export const QISHUI_PHONE_WEB_BASE = 'https://www.qishui.com';

// UA 与桌面端 passport 那一段保持字面一致：上游拿它认客户端版本（版本不对时
// get_qrcode 会回 error_code 4031「当前版本过低」）。
export const QISHUI_PHONE_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) SodaMusic/3.2.1 Chrome/136.0.7103.59 '
    + 'Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36';

export const PASSPORT_AID = '386088';
export const PASSPORT_APP_VERSION = '3.5.2';
export const PASSPORT_SDK_VERSION = '2.4.13';
export const PASSPORT_SECURE_SDK_VERSION = '3.3.5';
export const PASSPORT_VERIFY_SDK_VERSION = '1.0.29';
export const PASSPORT_BDMS_VERSION = '1.0.0.41';

// 二维码的有效期：上游给的是**秒级时间戳**（expire_time），给不出来时按 5 分钟算。
export const QR_TTL_MS = 5 * 60 * 1000;

/** 十几位十进制随机数字：passport 的 device_id(19) / install_id(15) 就长这样。 */
export function randomDigits(length, firstMax = 9) {
    let value = String(Math.floor(Math.random() * Math.max(2, firstMax + 1)));
    while (value.length < length) value += String(Math.floor(Math.random() * 10));
    return value;
}

export function randomHex(bytes) {
    let out = '';
    for (let i = 0; i < bytes; i++) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    return out;
}

/**
 * 二维码里装的那个地址。
 *
 * ⚠⚠ **不能用服务端下发的那张 `qrcode` PNG。** 实测（2026-10）它装的是
 * `bff-pc.qishui.com/ucenter_web/app/sdk-next?…&uc_sdk=scan-auth` 这个**网页**地址：
 * 汽水 App 扫到它只会去开那个页面，**不会**弹「在电脑上登录」的确认框 ——
 * 于是 passport 的 check_qrconnect 一直停在「已扫码」，到点前端只能换一张新码。
 * 用户看到的就是「扫完二维码自己刷新了，什么报错都没有」。
 *
 * 桌面端（`electron/qishui/qishui-auth-v6.js` 的 officialScanUrl）是从
 * `qrcode_index_url` 里取出 token，自己拼 bff-pc 的 **scan_login** 调用地址 ——
 * 带上 token + os + 机器名，App 才认得这是一次 PC 登录。这里逐字对齐，
 * 二维码也因此在本地画（见 auth.js），不再用服务端那张图。
 */
export const QISHUI_SCAN_LOGIN_URL = 'https://bff-pc.qishui.com/light/invoke/scan_login';

/** 从 qrcode_index_url 里取出 token，拼成 App 认的扫码地址；拿不到 token 时返回空串。 */
export function buildQishuiScanUrl(indexUrl, computerName) {
    let token = '';
    try {
        token = new URL(String(indexUrl || '')).searchParams.get('token') || '';
    } catch (_) {
        return '';
    }
    if (!token) return '';
    const target = new URL(QISHUI_SCAN_LOGIN_URL);
    target.searchParams.set('token', token);
    target.searchParams.set('os', 'Windows');
    target.searchParams.set('computer_name', computerName || 'Windows-PC');
    // 与桌面端一致：把 + 还原成 %20（服务端会按字面比较机器名）。
    return target.toString().replace(/\+/g, '%20');
}

/** passport 每次请求都要带的那一串 SDK 参数。 */
export function passportCommonParams(identity, extra = {}) {
    return {
        passport_jssdk_version: PASSPORT_SDK_VERSION,
        passport_jssdk_type: 'normal',
        is_from_ttaccountsdk: '1',
        aid: PASSPORT_AID,
        language: 'zh',
        account_sdk_source: 'web',
        p_js_v: PASSPORT_SDK_VERSION,
        p_js_t: 'pro',
        p_zt: PASSPORT_SECURE_SDK_VERSION,
        p_ver: PASSPORT_VERIFY_SDK_VERSION,
        request_host: 'app%3A%2F%2Fresources',
        p_bd: PASSPORT_BDMS_VERSION,
        biz_trace_id: randomHex(4),
        is_new_login: '1',
        is_from_iesaccountsaas: '1',
        device_id: identity.deviceId,
        install_id: identity.installId,
        did: identity.deviceId,
        iid: identity.installId,
        device_platform: 'PC',
        version_code: PASSPORT_APP_VERSION,
        ...extra,
    };
}

export function passportHeaders(identity, bizTraceId) {
    const traceId = randomHex(16);
    return {
        Accept: 'application/json, text/javascript',
        'User-Agent': QISHUI_PHONE_UA,
        'x-tt-passport-verify-portrait': identity.verifyPortraitId,
        'x-tt-passport-trace-id': bizTraceId,
        'x-tt-trace-id': `00-${traceId}-${traceId.slice(0, 16)}-01`,
    };
}

/**
 * 发一次 passport 请求。
 *
 * 返回 `{ json, setCookie }`：登录态是 Set-Cookie 下发的（响应体里的 session_cookie
 * 经常是空的），所以调用方要把响应头那一条也并进 cookie 罐 —— 少了它，
 * 「扫码确认了但账号出不来」。
 *
 * ⭐ `cookie` 必须带：passport 的扫码是**一个会话**的三步 —— 出码时下发
 * `passport_csrf_token` / `sid_tt`，确认与轮询要带着它们才算同一台设备上的同一次登录。
 * 桌面端每一笔 passport 请求都塞 `cookie` 头（`qishui-auth-v6.js` 的 request），
 * 安卓这边原来一条都不带：出码与轮询在服务端是**两个陌生会话**，扫了码也认不回来。
 */
export async function passportRequest(
    fetcher,
    { identity, method = 'GET', path, params = {}, body = null, cookie = '' },
) {
    const query = passportCommonParams(identity, params);
    const url = new URL(path, QISHUI_PHONE_API_BASE);
    for (const [name, value] of Object.entries(query)) {
        if (value != null) url.searchParams.set(name, String(value));
    }
    const headers = passportHeaders(identity, String(query.biz_trace_id || ''));
    const carried = String(cookie || '').trim();
    if (carried) headers.Cookie = carried;
    let encoded = null;
    if (body != null) {
        const form = new URLSearchParams();
        for (const [name, value] of Object.entries(body)) {
            if (value != null) form.set(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
        encoded = form.toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        // 与桌面端一致：POST 的请求体摘要，上游用它挡空体/重放（不是签名，但不给会被怠工）。
        try {
            headers['x-ss-stub'] = createHash('md5').update(encoded).digest('hex').toUpperCase();
        } catch (_) { /* 摘要算不出来不影响请求本身 */ }
    }
    const response = await fetcher(url.toString(), { method, headers, body: encoded });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { json = null; }
    if (!response.ok || !json) {
        const error = new Error(`Qishui passport ${path} failed (HTTP ${response.status})`);
        error.code = 'invalid-response';
        throw error;
    }
    const setCookie = response.headers && typeof response.headers.get === 'function'
        ? String(response.headers.get('set-cookie') || '') : '';
    return { json, setCookie };
}

// ---- Cookie --------------------------------------------------------------

/** Cookie 字符串 → 键值表。 */
export function parseCookieString(raw) {
    const result = {};
    String(raw || '').split(';').forEach(pair => {
        const index = pair.indexOf('=');
        if (index > 0) result[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
    });
    return result;
}

/** 键值表 → Cookie 字符串（去掉 domain/path 那类属性项）。 */
export function buildCookieString(values) {
    return Object.entries(values || {})
        .filter(([name, value]) => name && value !== undefined && value !== null && String(value) !== '')
        .map(([name, value]) => `${name}=${String(value)}`)
        .join('; ');
}

/**
 * 登录判定认这几个键。
 *
 * ⚠ 只要**任意一个**命中就算登录（与桌面端一致），而 sid_tt 这类跟踪 Cookie 在
 * 扫码之前就已经存在 —— 所以「界面说登录成功、/luna 却回 1000016 登录状态已失效」
 * 是这一路的经典假阳性。诊断里把每个键在不在都列出来（见 auth.js 的 loginKeys）。
 */
export const QISHUI_LOGIN_COOKIE_KEYS = ['sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt', 'uid_tt', 'uid_tt_ss'];

export function hasLoginCookie(text) {
    const values = parseCookieString(text);
    return QISHUI_LOGIN_COOKIE_KEYS.some(name => Boolean(values[name]));
}

/** 把 Set-Cookie 那一条（可能带属性）折成 name=value 对。 */
export function cookieFromSetCookie(raw) {
    return String(raw || '')
        .split(/,(?=[^;]+=)/)
        .map(part => part.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
}

/**
 * 宿主 Cookie 罐里某一源下的 Cookie（OkHttp 收到 Set-Cookie 后由 Java 侧转存，
 * 见 QishuiSignHost.http）。passport 的会话 Cookie 大多数只出现在这里，
 * 响应头里拿不到完整的多条 Set-Cookie（Java 侧只回第一条）。
 */
export function hostCookie(url) {
    try {
        const host = typeof window !== 'undefined' ? window.FoliaQishuiHost : null;
        if (!host || typeof host.getCookie !== 'function') return '';
        return String(host.getCookie(url) || '');
    } catch (_) {
        return '';
    }
}

/** 宿主罐里 qishui 域下的全部 Cookie（两个源都要问：下发域名不固定）。 */
export function hostCookies() {
    return [hostCookie(`${QISHUI_PHONE_API_BASE}/`), hostCookie(`${QISHUI_PHONE_WEB_BASE}/`)]
        .filter(Boolean)
        .join('; ');
}
