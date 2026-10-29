// android/qishui-bridge/src/car/transport.js
//
// 车机协议层的网络出口：一个够用的 fetch 子集，底下是签名宿主的原生 http 桥。
//
// 为什么不让页面自己 fetch：隐藏 WebView 的页面挂在 https://www.qishui.com 这个
// 假源下，真发到 open.douyin.com / open.qishui.com 是跨域的，而 WebView 的
// shouldInterceptRequest 又拿不到 POST body（车机接口几乎全是 POST）。OkHttp 直发
// 没有这些问题，也已经在 folia-xhr.js 里跑通了；这里只是把同一个桥包成 fetch 的
// 形状，好让协议层代码与参考实现保持逐行对应。

const DEFAULT_TIMEOUT_MS = 25000;

function headerLookup(headers, name) {
    if (!headers) return null;
    const needle = String(name || '').toLowerCase();
    for (const key of Object.keys(headers)) {
        if (String(key).toLowerCase() === needle) return headers[key];
    }
    return null;
}

function wrapResponse(native) {
    const headers = (native && native.headers) || {};
    return {
        ok: Number(native && native.status) >= 200 && Number(native && native.status) < 300,
        status: Number(native && native.status) || 0,
        // names() 只给键名不给值：诊断要能看出「头到没到」，但不把凭据带出去。
        headers: { get: name => headerLookup(headers, name), names: () => Object.keys(headers || {}) },
        text: async () => String((native && native.body) || ''),
        json: async () => JSON.parse(String((native && native.body) || '{}')),
    };
}

/**
 * @param {{ request?: (payload: object) => Promise<object> }} [transport]
 *   默认是隐藏 WebView 里 folia-xhr.js 挂上的 `__foliaHttpTransport`；
 *   验证脚本可以注入一个走 node fetch 的实现（见 verify-crypto.mjs 那一族）。
 */
export function createFetch(transport) {
    const resolve = () => {
        if (transport && typeof transport.request === 'function') return transport;
        const host = typeof window !== 'undefined' ? window.__foliaHttpTransport : null;
        if (host && typeof host.request === 'function') return host;
        throw new Error('native http transport is unavailable');
    };
    return async function foliaFetch(url, options = {}) {
        const method = String(options.method || (options.body == null ? 'GET' : 'POST')).toUpperCase();
        const payload = {
            url: String(url),
            method,
            headers: options.headers || {},
            body: options.body == null ? null : String(options.body),
            timeoutMs: DEFAULT_TIMEOUT_MS,
        };
        let native;
        try {
            native = await resolve().request(payload);
        } catch (error) {
            throw new Error('network');
        }
        return wrapResponse(native);
    };
}

export default { createFetch };
