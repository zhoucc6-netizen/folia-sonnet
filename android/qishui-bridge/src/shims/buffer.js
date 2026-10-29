// android/qishui-bridge/src/shims/buffer.js
//
// qishui 协议层只用了 Buffer 的三个静态成员（concat / byteLength / isBuffer），
// 加上 crypto shim 产生的 randomBytes().toString()。esbuild 用 inject 把这个
// default 导出替换成全局 Buffer。

class BufferShim extends Uint8Array {
    toString(encoding) {
        if (encoding === 'hex') {
            let out = '';
            for (let i = 0; i < this.length; i++) out += this[i].toString(16).padStart(2, '0');
            return out;
        }
        return new TextDecoder('utf-8').decode(this);
    }
}

export function concat(list) {
    const total = (list || []).reduce((sum, item) => sum + item.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const item of list || []) { merged.set(item, offset); offset += item.length; }
    return merged;
}

export function byteLength(value) {
    return new TextEncoder().encode(String(value == null ? '' : value)).length;
}

export function isBuffer(value) {
    return value instanceof Uint8Array;
}

export function from(value, encoding) {
    if (typeof value === 'string') {
        if (encoding === 'hex') {
            const out = new Uint8Array(value.length >> 1);
            for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
            return out;
        }
        if (encoding === 'base64' || encoding === 'base64url') {
            const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
            const binary = window.atob(normalized);
            const out = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
            return out;
        }
        return new TextEncoder().encode(value);
    }
    return new Uint8Array(value || 0);
}

export default Object.assign(BufferShim, { concat, byteLength, isBuffer, from });
