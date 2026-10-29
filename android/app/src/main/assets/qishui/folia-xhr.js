// android/qishui-bridge/src/folia-xhr.js
//
// 签名宿主页面的网络地基。必须在 sdk-glue.js 之前加载（bootstrap.html 里排第一个
// <script>），原因：
//
//   1. a_bogus 签名来自 sdk-glue 对 XMLHttpRequest 原型的 hook —— 我们提供一个
//      接口兼容的假 XHR 并提前替换全局，sdk-glue 就会把它的签名逻辑包在我们的
//      open/send 外面，注入的参数与我们真实发出的请求完全一致；
//   2. 真发请求必须走原生桥：WebView 的 shouldInterceptRequest 拿不到 POST body，
//      而登录轮询（check_qrconnect）是 POST；且 OkHttp 直发不受 CORS 约束。
//
// 假 XHR 的 open 收到的 URL 已经是 sdk-glue 改写后的（签名注入在它那层完成），
// 我们只负责记录（__foliaXhrLog，裁剪版签名层校验 a_bogus 用）与传输。

(function () {
    'use strict';

    // ─── msToken 预置 ─────────────────────────────────────────────────────
    // 桌面端由 security_seed.html 在加载 security_host.html **之前**把 msToken 种进
    // localStorage（bdms 初始化时会读）。安卓只有一个页面，所以必须在 sdk-glue
    // 加载前同步完成 —— 这正是本文件排在 bootstrap.html 第一个 script 的原因之一。
    try {
        const existing = window.localStorage.getItem('xmst') || window.localStorage.getItem('xmsty') || '';
        if (!/^[A-Za-z0-9_-]{118}==$/.test(existing)) {
            const bytes = new Uint8Array(88);
            (window.crypto || window.msCrypto).getRandomValues(bytes);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            const token = window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '==';
            window.localStorage.setItem('xmst', token);
            window.localStorage.setItem('xmsty', token);
        }
    } catch (_) {
        // localStorage 不可用时协议层会以空 msToken 运行，签名层会报出明确错误。
    }

    const pending = new Map();
    let nextTicket = 1;

    // 原生侧完成请求后按块回调：window.__foliaHttpChunk(ticket, total, index, base64Chunk)。
    // 大响应（歌单整包）会超过 evaluateJavascript 的 IPC 上限，原生按 512KB 分片推，
    // 这里攒齐后一次性派发；内容是 base64，绕开所有引号与转义问题。
    const chunkBuffers = new Map();

    window.__foliaHttpChunk = function (ticket, total, index, base64Chunk) {
        const key = String(ticket);
        let buffer = chunkBuffers.get(key);
        if (!buffer || buffer.total !== total) {
            buffer = { total, parts: new Array(total), received: 0 };
            chunkBuffers.set(key, buffer);
        }
        if (buffer.parts[index] == null) {
            buffer.parts[index] = base64Chunk;
            buffer.received++;
        }
        if (buffer.received < total) return;
        chunkBuffers.delete(key);
        const merged = buffer.parts.join('');
        const entry = pending.get(key);
        if (!entry) return;
        pending.delete(key);
        if (entry.aborted) return;
        let json;
        try {
            json = JSON.parse(decodeBase64Utf8(merged));
        } catch (_) {
            entry.settle(null);
            return;
        }
        entry.settle(json);
    };

    function decodeBase64Utf8(base64) {
        const binary = window.atob(String(base64 || '').replace(/\s+/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    }

    function nativeRequest(payload) {
        return new Promise((resolve, reject) => {
            const ticket = String(nextTicket++);
            const host = window.FoliaQishuiHost;
            if (!host || typeof host.http !== 'function') {
                reject(new Error('FoliaQishuiHost.http is unavailable'));
                return;
            }
            let accepted = false;
            try {
                accepted = host.http(ticket, JSON.stringify(payload)) !== false;
            } catch (error) {
                reject(new Error('native http bridge failed: ' + (error && error.message || error)));
                return;
            }
            if (!accepted) {
                reject(new Error('native http bridge rejected the request'));
                return;
            }
            pending.set(ticket, {
                aborted: false,
                settle(json) {
                    if (!json || typeof json !== 'object') {
                        reject(new Error('native http bridge returned an invalid envelope'));
                    } else if (json.error) {
                        reject(new Error(String(json.error)));
                    } else {
                        resolve(json);
                    }
                },
            });
        });
    }

    window.__foliaHttpTransport = { request: nativeRequest };

    // ─── 假 XMLHttpRequest ────────────────────────────────────────────────

    const READY_STATES = { UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 };
    const xhrLog = [];
    // 日志只留尾部：裁剪版签名层只在「最近一次 passport 请求」与「最近一次 api 请求」
    // 两个位置读取，历史没有价值。
    const XHR_LOG_MAX = 40;

    function FakeXHR() {
        this.readyState = 0;
        this.status = 0;
        this.statusText = '';
        this.responseText = '';
        this.response = '';
        this.responseType = '';
        this.responseURL = '';
        this.timeout = 0;
        this.withCredentials = false;
        this.onload = null;
        this.onerror = null;
        this.ontimeout = null;
        this.onabort = null;
        this.onreadystatechange = null;
        this.__method = 'GET';
        this.__url = '';
        this.__headers = {};
        this.__aborted = false;
        this.__ticket = null;
    }

    FakeXHR.UNSENT = 0;
    FakeXHR.OPENED = 1;
    FakeXHR.HEADERS_RECEIVED = 2;
    FakeXHR.LOADING = 3;
    FakeXHR.DONE = 4;

    FakeXHR.prototype.open = function (method, url, async) {
        this.__method = String(method || 'GET').toUpperCase();
        this.__url = String(url || '');
        this.__async = async !== false;
        this.__headers = {};
        this.readyState = READY_STATES.OPENED;
        this.__fireReadyState();
        // 记录改写后的最终 URL —— a_bogus 校验与 requestUrl 回填都靠它。
        // headers 在 send 时才齐全，所以这里先记 URL，send 时回填。
        this.__logIndex = xhrLog.length;
        xhrLog.push({
            at: Date.now(),
            method: this.__method,
            url: this.__url,
            headers: this.__headers,
        });
        if (xhrLog.length > XHR_LOG_MAX) {
            xhrLog.shift();
            this.__logIndex = xhrLog.length - 1;
        }
    };

    FakeXHR.prototype.setRequestHeader = function (name, value) {
        if (name == null) return;
        this.__headers[String(name)] = value == null ? '' : String(value);
    };

    FakeXHR.prototype.send = function (body) {
        if (this.readyState !== READY_STATES.OPENED) {
            this.__fail(new Error('XHR send() called before open()'));
            return;
        }
        const xhr = this;
        const ticket = String(nextTicket++);
        xhr.__ticket = ticket;
        // 此时 sdk-glue 的 send 包装已经跑过：headers 齐了，回填到 open 时记下的条目。
        if (xhr.__logIndex != null && xhrLog[xhr.__logIndex]) {
            xhrLog[xhr.__logIndex].headers = Object.assign({}, xhr.__headers);
        }
        pending.set(ticket, {
            get aborted() { return xhr.__aborted; },
            set aborted(value) { xhr.__aborted = value; },
            settle(json) {
                xhr.__settle(json);
            },
        });
        const payload = {
            url: xhr.__url,
            method: xhr.__method,
            headers: xhr.__headers,
            body: body == null ? null : String(body),
            timeoutMs: Number(xhr.timeout) > 0 ? Number(xhr.timeout) : 20000,
        };
        const host = window.FoliaQishuiHost;
        let accepted = false;
        try {
            accepted = host && typeof host.http === 'function' ? host.http(ticket, JSON.stringify(payload)) !== false : false;
        } catch (_) {
            accepted = false;
        }
        if (!accepted) {
            pending.delete(ticket);
            // 给页面一个稳定的失败形态：网络层不可用。
            Promise.resolve().then(() => xhr.__fail(new Error('XMLHttpRequest network error')));
        }
    };

    FakeXHR.prototype.abort = function () {
        if (this.__ticket) {
            const entry = pending.get(this.__ticket);
            if (entry) entry.aborted = true;
            pending.delete(this.__ticket);
        }
        this.__aborted = true;
        this.readyState = READY_STATES.UNSENT;
        if (typeof this.onabort === 'function') {
            try { this.onabort(); } catch (_) {}
        }
    };

    FakeXHR.prototype.getResponseHeader = function (name) {
        const headers = this.__responseHeaders || {};
        const needle = String(name || '').toLowerCase();
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === needle) return String(headers[key]);
        }
        return null;
    };

    FakeXHR.prototype.getAllResponseHeaders = function () {
        const headers = this.__responseHeaders || {};
        let out = '';
        for (const key of Object.keys(headers)) out += key.toLowerCase() + ': ' + String(headers[key]) + '\r\n';
        return out;
    };

    FakeXHR.prototype.__fireReadyState = function () {
        if (typeof this.onreadystatechange === 'function') {
            try { this.onreadystatechange(); } catch (_) {}
        }
    };

    FakeXHR.prototype.__fail = function (error) {
        this.readyState = READY_STATES.DONE;
        this.status = 0;
        if (typeof this.onerror === 'function') {
            try { this.onerror(error instanceof Error ? error : new Error(String(error))); } catch (_) {}
        }
        this.__fireReadyState();
    };

    FakeXHR.prototype.__settle = function (json) {
        if (this.__aborted) return;
        this.readyState = READY_STATES.DONE;
        this.status = Number(json && json.status) || 0;
        this.statusText = this.status ? 'OK' : '';
        this.__responseHeaders = (json && json.headers) || {};
        this.responseText = String((json && json.body) || '');
        this.response = this.responseText;
        try { this.responseURL = String(json && json.responseURL || this.__url); } catch (_) { this.responseURL = this.__url; }
        this.__fireReadyState();
        if (typeof this.onload === 'function') {
            try { this.onload(); } catch (_) {}
        }
    };

    // toString 伪装成原生（部分风控/指纹代码会检查 [native code]）。
    FakeXHR.toString = function () { return 'function XMLHttpRequest() { [native code] }'; };
    FakeXHR.prototype.toString = function () { return '[object XMLHttpRequest]'; };

    try {
        Object.defineProperty(window, 'XMLHttpRequest', { value: FakeXHR, writable: true, configurable: true });
    } catch (_) {
        window.XMLHttpRequest = FakeXHR;
    }

    // 协议层/签名层的调试口：读最近的 XHR 记录。
    Object.defineProperty(window, '__foliaXhrLog', { get: () => xhrLog.slice() });
    window.__foliaXhrState = READY_STATES;
})();
