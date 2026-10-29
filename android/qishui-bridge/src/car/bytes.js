// android/qishui-bridge/src/car/bytes.js
//
// 车机协议层的字节/base64 小工具。
//
// 签名宿主页面里没有 Buffer（也不该再引入 shims/buffer.js —— 那份是给旧协议层
// 用的），一切以 Uint8Array 为准：它是 WebCrypto 与 TextEncoder 的公共语言。
// btoa/atob 在 WebView 与 Node 16+ 里都有，省掉一份 base64 实现。

export function utf8Bytes(text) {
    return new TextEncoder().encode(String(text));
}

export function bytesToBase64(bytes) {
    let binary = '';
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
    return btoa(binary);
}

export function base64ToBytes(value) {
    const clean = String(value || '').replace(/\s+/g, '');
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

export function bytesToBase64Url(bytes) {
    return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function concatBytes(...parts) {
    const chunks = parts.map(part => (part instanceof Uint8Array ? part : new Uint8Array(part || [])));
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

export function pemFromBytes(label, bytes) {
    const body = bytesToBase64(bytes);
    const lines = body.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

export function bytesFromPem(pem) {
    const text = String(pem || '');
    const body = text
        .replace(/-----BEGIN [^-]+-----/g, '')
        .replace(/-----END [^-]+-----/g, '')
        .replace(/\s+/g, '');
    return base64ToBytes(body);
}

/** 19 位十进制数字：车机协议的设备 ID 必须是这个形状（上游按它校验）。 */
export function randomDigits19() {
    const bytes = randomBytes(8);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return ((value % 9000000000000000000n) + 1000000000000000000n).toString();
}

export function randomHex(byteLength) {
    const bytes = randomBytes(byteLength);
    let out = '';
    for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
    return out;
}

export function randomBytes(length) {
    const bytes = new Uint8Array(length);
    const cryptoRef = (typeof globalThis !== 'undefined' ? globalThis.crypto : null)
        || (typeof window !== 'undefined' ? window.crypto : null);
    if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
        for (let offset = 0; offset < length; offset += 65536) {
            cryptoRef.getRandomValues(bytes.subarray(offset, Math.min(length, offset + 65536)));
        }
        return bytes;
    }
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
}
