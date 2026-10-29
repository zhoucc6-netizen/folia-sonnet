// android/qishui-bridge/src/shims/fs.js
//
// qishui 协议层（qishui-api.js / qishui-qr-login.js）在桌面端把 token / cookie /
// 设备身份写成 userData 下的文件。安卓的签名宿主页面没有文件系统，这里把同步 fs
// 映射到 localStorage：键值同步读写，且随 WebView 的 DOM storage 持久化。
//
// 路径只作为 localStorage 键的一部分使用（桌面端路径里的 userData 目录在安卓没有
// 对应物），同一个键在签名宿主 WebView 的整个生命周期内稳定不变。

const PREFIX = 'qishui:fs:';

// localStorage 被禁用 / 写满时的内存兜底：本次会话内仍可读写。
// 代价是设备身份重启后会重置（可能触发风控），比让协议层直接崩掉好。
const memory = new Map();

function keyOf(file) {
    return PREFIX + String(file);
}

export function existsSync(file) {
    const key = keyOf(file);
    if (memory.has(key)) return true;
    try {
        return window.localStorage.getItem(key) !== null;
    } catch (_) {
        return false;
    }
}

export function readFileSync(file, _encoding) {
    const key = keyOf(file);
    if (memory.has(key)) return memory.get(key);
    let value = null;
    try {
        value = window.localStorage.getItem(key);
    } catch (_) {
        value = null;
    }
    if (value === null) {
        const error = new Error('ENOENT: no such file, open \'' + file + '\'');
        error.code = 'ENOENT';
        throw error;
    }
    return value;
}

export function writeFileSync(file, data) {
    const key = keyOf(file);
    const value = data == null ? '' : String(data);
    memory.set(key, value);
    try {
        window.localStorage.setItem(key, value);
    } catch (_) {
        // 留在 memory 里兜底。
    }
}

export function mkdirSync() {
    // 目录概念不存在，no-op（调用方传 recursive: true 也一样）。
}

export function unlinkSync(file) {
    const key = keyOf(file);
    memory.delete(key);
    try {
        window.localStorage.removeItem(key);
    } catch (_) {
        // 已从 memory 移除，无需再处理。
    }
}

// 登出时按前缀批量清理（fs 没有这个语义，是安卓侧的扩展）。
export function unlinkAllByPrefix(prefix) {
    const needle = PREFIX + String(prefix || '');
    const touched = [];
    for (const key of Array.from(memory.keys())) {
        if (key.indexOf(needle) === 0) touched.push(key);
    }
    for (const key of touched) memory.delete(key);
    try {
        const store = window.localStorage;
        const removals = [];
        for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (key && key.indexOf(needle) === 0) removals.push(key);
        }
        for (const key of removals) store.removeItem(key);
    } catch (_) {
        // memory 已清，localStorage 留到下次也只会被覆盖。
    }
}

export default { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, unlinkAllByPrefix };
