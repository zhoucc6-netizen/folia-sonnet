// android/qishui-bridge/src/shims/http.js
//
// qishui 协议层用 Node 的 http/https 模块发请求（requestText / requestTextWithMeta）。
// 在签名宿主页面里这些请求改由原生桥真发：页面发出去的跨域请求即使带上了
// a_bogus，POST body 也会被 shouldInterceptRequest 丢掉（WebView 不给 body），
// 所以网络层整体下沉到 OkHttp —— 由 folia-xhr.js 暴露的 __foliaHttpTransport 承载。
//
// 这里只需要覆盖协议层实际用到的那一小片 Node API：
//   request(url, {method, headers}, callback) + req.setTimeout/write/end/on('error')
//   res.statusCode / res.headers / res.on('data'|'end')

function normalizeUrl(url) {
    return typeof url === 'string' ? url : String(url && url.href || url);
}

class ClientRequest {
    constructor(url, options, callback) {
        this.url = normalizeUrl(url);
        this.options = options || {};
        this.callback = typeof callback === 'function' ? callback : null;
        this.errorListeners = [];
        this.timeoutTimer = null;
        this.aborted = false;
        this.chunks = [];
        this.timeoutMs = 20000;
    }

    setTimeout(ms, handler) {
        const value = Number(ms) || 0;
        if (value > 0) this.timeoutMs = value;
        if (typeof handler === 'function') this.timeoutHandler = handler;
        return this;
    }

    on(event, listener) {
        if (event === 'error' && typeof listener === 'function') this.errorListeners.push(listener);
        return this;
    }

    write(chunk) {
        if (chunk != null) this.chunks.push(String(chunk));
        return this;
    }

    end(chunk) {
        if (chunk != null) this.chunks.push(String(chunk));
        this._dispatch();
        return this;
    }

    destroy(error) {
        this.aborted = true;
        if (error) this._fail(error);
        return this;
    }

    _fail(error) {
        for (const listener of this.errorListeners) {
            try { listener(error); } catch (_) {}
        }
    }

    _dispatch() {
        const transport = window.__foliaHttpTransport;
        if (!transport || typeof transport.request !== 'function') {
            this._fail(new Error('native http transport is unavailable'));
            return;
        }
        const payload = {
            url: this.url,
            method: String(this.options.method || 'GET').toUpperCase(),
            headers: this.options.headers || {},
            body: this.chunks.length ? this.chunks.join('') : null,
            timeoutMs: Number(this.options.timeoutMs) > 0 ? Number(this.options.timeoutMs) : this.timeoutMs,
        };
        const started = Date.now();
        transport.request(payload).then(native => {
            if (this.aborted) return;
            const response = wrapResponse(native);
            if (this.callback) {
                try { this.callback(response); } catch (error) { this._fail(error); }
            }
            response._drain();
        }).catch(error => {
            if (this.aborted) return;
            this._fail(error instanceof Error ? error : new Error(String(error)));
        });
    }
}

function wrapResponse(native) {
    const listeners = { data: [], end: [], error: [] };
    const response = {
        statusCode: Number(native && native.status) || 0,
        headers: (native && native.headers) || {},
        text: String((native && native.body) || ''),
        on(event, listener) {
            if (listeners[event] && typeof listener === 'function') listeners[event].push(listener);
            return this;
        },
        _drain() {
            // Node 的响应是分块流式的，但原生桥一次给全文；模拟成「一块 data + end」，
            // 用微任务保证消费方先挂完监听再收事件。
            Promise.resolve().then(() => {
                for (const listener of listeners.data) {
                    try { listener(Buffer.from(response.text, 'utf8')); } catch (_) {}
                }
                for (const listener of listeners.end) {
                    try { listener(); } catch (_) {}
                }
            });
        },
    };
    return response;
}

export function request(url, options, callback) {
    return new ClientRequest(url, options, callback);
}

export default { request, ClientRequest };
