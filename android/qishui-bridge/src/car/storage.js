// android/qishui-bridge/src/car/storage.js
//
// 设备身份与登录凭据的持久化。
//
// 三级，按可靠性从高到低：
//
//   1. **原生 SharedPreferences**（`FoliaQishuiHost.getStore/putStore`）—— App 自己
//      的文件，重启必在。只写 WebView 的 localStorage 是不够的：DOM storage 依赖
//      WebView 数据目录的状态（系统清理、存储紧张、多进程都可能让它丢），表现为
//      「登录成功、重启后账号没了」。
//   2. localStorage —— 回退（宿主是老版本、还没有 getStore 时用）。
//   3. 内存 —— 两者都不可用时，本次进程内还能正常登录，重启才丢。
//
// 写入双写（1 与 2 都写），读取按 1 → 2 → 3。`storageMode()` 报告实际生效的那一档，
// 由 status 带进诊断：真机上再说「账号丢了」，先看这一档是什么。

const PREFIX = 'folia:qishui:car:';
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

// ⚠ 读档与写档**必须分开记**。设备 ID 在页面一起起来就要写一次（读不到才生成新的），
// 于是「写档」几乎恒为 native；早先只有一个 lastMode，写入把它盖成 native，
// 诊断里就永远显示 native —— 而真正的读档可能一路掉到 memory，凭据根本没找回来。
// 「重启后账号没了」排查时看的就是读档，混在一起会直接把人带到错的方向。
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

export const DEVICE_KEY = 'device-id';
export const SESSION_KEY = 'session';
