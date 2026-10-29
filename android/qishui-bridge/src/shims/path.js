// android/qishui-bridge/src/shims/path.js
//
// 协议层只把 path 当「拼文件路径」用（join / dirname / resolve），
// 而安卓侧的「文件」其实是 localStorage 键 —— 简单按 POSIX 规则拼即可。

export function join(...parts) {
    const segments = (parts || []).filter(part => part != null && String(part) !== '').map(String);
    if (!segments.length) return '.';
    const joined = segments.join('/').replace(/\/{2,}/g, '/');
    return normalize(joined);
}

export function dirname(file) {
    const value = String(file || '');
    const index = value.lastIndexOf('/');
    if (index < 0) return '.';
    if (index === 0) return '/';
    return normalize(value.slice(0, index));
}

export function resolve(...parts) {
    return join(...parts);
}

function normalize(value) {
    let out = value;
    while (/\/\.\//.test(out)) out = out.replace(/\/\.\//g, '/');
    if (out.endsWith('/.')) out = out.slice(0, -2);
    return out || '/';
}

export default { join, dirname, resolve, normalize };
