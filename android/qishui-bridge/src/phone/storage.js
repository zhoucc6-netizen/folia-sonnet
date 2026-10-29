// android/qishui-bridge/src/phone/storage.js
//
// 手机协议的设备身份与会话 Cookie 的持久化。
//
// 与 car/storage.js 是同一套三级存储（原生 SharedPreferences → localStorage → 内存），
// 只是**键前缀不同**：两套协议的凭据各自独立，清一套不该动另一套。逻辑故意保持
// 逐行对应， diagnose 的字段名也一致（storage / store / deviceIdReused），
// 真机上「重启后账号没了」时两边的诊断可以互相印证。
//
// 写入双写（1 与 2 都写），读取按 1 → 2 → 3。`storageMode()` 报告实际生效的那一档。

const PREFIX = 'folia:qishui:phone:';
const memory = new Map();

/** 原生出口：宿主老版本没有这两个方法时返回 null，调用方自行降级。 */
function native() {
    try {
        const host = typeof window !== 'undefined' ? window.FoliaQishuiHost : null;
        if (!host || typeof host.getStore !== 'function' || typeof host.putStore !== 'function') return null;
        return host;
    } catch (_) {
        return null;
    }
}

function local() {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch (_) {
        return null;
    }
}

// ⚠ 读档与写档**必须分开记**：见 car/storage.js 里同一段的注释 —— 混在一起会把
// 「重启后账号没了」的排查直接带到错的方向。
let lastRead = 'none';
let lastWrite = 'none';
let lastParseError = '';
export const storageMode = () => lastRead;
export const storageWriteMode = () => lastWrite;
export const storageParseError = () => lastParseError;

/** 这个键现在落在哪一档（诊断用，不改 storageMode 的读数）。 */
export function whereIs(key) {
    const host = native();
    if (host) {
        try { if (host.getStore(key)) return 'native'; } catch (_) { /* 继续问下一档 */ }
    }
    const target = local();
    if (target) {
        try { if (target.getItem(PREFIX + key) != null) return 'local'; } catch (_) { /* 同上 */ }
    }
    return memory.has(key) ? 'memory' : 'none';
}

export function readJson(key, fallback = null) {
    const host = native();
    if (host) {
        try {
            const text = host.getStore(key);
            if (text) {
                lastRead = 'native';
                try { return JSON.parse(text); } catch (error) { lastParseError = `native/${key}: ${error?.message || error}`; }
            }
        } catch (_) { /* 落到下一档 */ }
    }
    const target = local();
    if (target) {
        try {
            const text = target.getItem(PREFIX + key);
            if (text != null) {
                lastRead = 'local';
                try { return JSON.parse(text); } catch (error) { lastParseError = `local/${key}: ${error?.message || error}`; }
            }
        } catch (_) { /* 同上 */ }
    }
    if (memory.has(key)) {
        lastRead = 'memory';
        return memory.get(key);
    }
    lastRead = 'none';
    return fallback;
}

export function writeJson(key, value) {
    const text = JSON.stringify(value == null ? null : value);
    memory.set(key, value);
    const host = native();
    if (host) {
        try {
            host.putStore(key, text);
            lastWrite = 'native';
        } catch (_) { /* 继续写 localStorage */ }
    }
    const target = local();
    if (target) {
        try {
            target.setItem(PREFIX + key, text);
            if (lastWrite !== 'native') lastWrite = 'local';
        } catch (_) { /* 留在内存兜底 */ }
    }
    if (lastWrite === 'none') lastWrite = 'memory';
}

export function remove(key) {
    memory.delete(key);
    const host = native();
    if (host) {
        try { host.putStore(key, null); } catch (_) { /* 忽略 */ }
    }
    const target = local();
    if (target) {
        try { target.removeItem(PREFIX + key); } catch (_) { /* 同上 */ }
    }
}

export const DEVICE_KEY = 'phone-device-id';
export const SESSION_KEY = 'phone-session';
