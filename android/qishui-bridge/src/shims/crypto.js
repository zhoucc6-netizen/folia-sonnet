// android/qishui-bridge/src/shims/crypto.js
//
// qishui 协议层与签名层用到的 crypto 子集：
//   createHash('sha1' | 'md5')、randomBytes、randomUUID、randomInt。
// WebView 里没有同步的 SubtleCrypto，这里内置两份纯 JS 摘要实现（输入都是 UTF-8
// 字符串，与 Node 的 .update(str) 默认行为一致）。

function utf8Bytes(text) {
    return new TextEncoder().encode(String(text));
}

// WebView 里 window === globalThis；用 globalThis 让验证脚本可以在 node 里跑。
const win = typeof window !== 'undefined' ? window : globalThis;

function bytesToHex(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
}

function randomValues(length) {
    const bytes = new Uint8Array(length);
    const cryptoRef = win.crypto || win.msCrypto;
    if (!cryptoRef || typeof cryptoRef.getRandomValues !== 'function') {
        // 理论上到不了：Android WebView 一定有 crypto.getRandomValues。
        for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
        return bytes;
    }
    // getRandomValues 单次上限 65536 字节，分批填。
    for (let offset = 0; offset < length; offset += 65536) {
        cryptoRef.getRandomValues(bytes.subarray(offset, Math.min(length, offset + 65536)));
    }
    return bytes;
}

// ─── SHA-1 ───────────────────────────────────────────────────────────────

function sha1Digest(message) {
    const bytes = message instanceof Uint8Array ? message : utf8Bytes(message);
    const bitLength = bytes.length * 8;
    const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 4, bitLength >>> 0, false);
    view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);

    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    const w = new Uint32Array(80);
    for (let block = 0; block < padded.length; block += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4, false);
        for (let i = 16; i < 80; i++) {
            const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
            w[i] = (n << 1) | (n >>> 31);
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4;
        for (let i = 0; i < 80; i++) {
            let f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
            else { f = b ^ c ^ d; k = 0xCA62C1D6; }
            const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
            e = d; d = c;
            c = (b << 30) | (b >>> 2);
            b = a; a = temp;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const out = new Uint8Array(20);
    new DataView(out.buffer).setUint32(0, h0, false);
    new DataView(out.buffer).setUint32(4, h1, false);
    new DataView(out.buffer).setUint32(8, h2, false);
    new DataView(out.buffer).setUint32(12, h3, false);
    new DataView(out.buffer).setUint32(16, h4, false);
    return out;
}

// ─── MD5 ─────────────────────────────────────────────────────────────────

function md5Digest(message) {
    const bytes = message instanceof Uint8Array ? message : utf8Bytes(message);
    const bitLengthLow = (bytes.length * 8) >>> 0;
    const bitLengthHigh = Math.floor(bytes.length * 8 / 0x100000000) >>> 0;
    const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, bitLengthLow, true);
    view.setUint32(padded.length - 4, bitLengthHigh, true);

    const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    // Math.floor(abs(sin(i+1)) * 2^32) —— 与 RFC 1321 的 K 表一致。
    let K = md5Digest.K;
    if (!K) {
        K = md5Digest.K = new Uint32Array(64);
        for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    }

    let a0 = 0x67452301, b0 = 0xEFCDAB89, c0 = 0x98BADCFE, d0 = 0x10325476;
    const M = new Uint32Array(16);
    for (let block = 0; block < padded.length; block += 64) {
        for (let i = 0; i < 16; i++) M[i] = view.getUint32(block + i * 4, true);
        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) { F = (B & C) | (~B & D); g = i; }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * i) % 16; }
            F = (F + A + K[i] + M[g]) >>> 0;
            A = D; D = C; C = B;
            B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
        }
        a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const out = new Uint8Array(16);
    new DataView(out.buffer).setUint32(0, a0, true);
    new DataView(out.buffer).setUint32(4, b0, true);
    new DataView(out.buffer).setUint32(8, c0, true);
    new DataView(out.buffer).setUint32(12, d0, true);
    return out;
}

function base64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return win.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

class Hash {
    constructor(kind) {
        this.kind = kind;
        this.chunks = [];
    }

    update(data) {
        this.chunks.push(data instanceof Uint8Array ? data : utf8Bytes(data));
        return this;
    }

    digest(encoding) {
        const merged = new Uint8Array(this.chunks.reduce((total, chunk) => total + chunk.length, 0));
        let offset = 0;
        for (const chunk of this.chunks) { merged.set(chunk, offset); offset += chunk.length; }
        const digest = this.kind === 'sha1' ? sha1Digest(merged) : md5Digest(merged);
        if (encoding === 'hex') return bytesToHex(digest);
        if (encoding === 'base64url') return base64Url(digest);
        if (encoding === 'base64') {
            let binary = '';
            for (let i = 0; i < digest.length; i++) binary += String.fromCharCode(digest[i]);
            return win.btoa(binary);
        }
        return digest;
    }
}

export function createHash(kind) {
    return new Hash(String(kind || '').toLowerCase());
}

export function randomBytes(length) {
    const bytes = randomValues(length);
    bytes.toString = function (encoding) {
        if (encoding === 'hex') return bytesToHex(this);
        if (encoding === 'base64url') return base64Url(this);
        let binary = '';
        for (let i = 0; i < this.length; i++) binary += String.fromCharCode(this[i]);
        return win.btoa(binary);
    };
    return bytes;
}

export function randomUUID() {
    const bytes = randomValues(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytesToHex(bytes);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-'
        + hex.slice(16, 20) + '-' + hex.slice(20);
}

export function randomInt(min, max) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    if (high <= low) return low;
    const range = high - low;
    const bytes = randomValues(4);
    const value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    return low + (value % range);
}

export default { createHash, randomBytes, randomUUID, randomInt };
