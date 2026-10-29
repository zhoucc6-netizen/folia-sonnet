// android/qishui-bridge/src/car/guard.js
//
// bd-ticket-guard 的 ECDSA P-256 部分。
//
// 参考实现（GSQZ/qishui-music-api，MIT）用 node:crypto 的 generateKeyPairSync /
// sign 同步完成两件事：生成 PKCS#10 证书请求、给每次请求签名。签名宿主页面里没有
// node:crypto，所以这两件事改用 WebCrypto：
//
//   1. generateKey({ name: 'ECDSA', namedCurve: 'P-256' }) 取代 generateKeyPairSync；
//   2. WebCrypto 的 ECDSA 签名是**裸 r||s**，而 PKCS#10 与 bd-ticket-guard 都要 DER
//      编码的 SEQUENCE{r, s} —— 所以多一步 rawToDer（见下）。
//
// 其余字节结构（subject 用 2.5.4.3 / 2.5.4.11 / 2.5.4.10，算法 OID 是
// ecdsa-with-SHA256）与参考实现逐一对应，服务端认的是这个形状。

import { bytesFromPem, bytesToBase64, concatBytes, pemFromBytes, utf8Bytes } from './bytes.js';

const subtle = () => {
    const cryptoRef = (typeof globalThis !== 'undefined' ? globalThis.crypto : null)
        || (typeof window !== 'undefined' ? window.crypto : null);
    if (!cryptoRef || !cryptoRef.subtle) throw new Error('WebCrypto is unavailable in this runtime');
    return cryptoRef.subtle;
};

// ─── DER ─────────────────────────────────────────────────────────────────

function derLength(length) {
    if (length < 128) return new Uint8Array([length]);
    if (length < 256) return new Uint8Array([0x81, length]);
    return new Uint8Array([0x82, length >> 8, length & 255]);
}

function der(tag, ...values) {
    const value = concatBytes(...values);
    return concatBytes(new Uint8Array([tag]), derLength(value.length), value);
}

/** DER INTEGER：去掉多余前导零，最高位为 1 时补一个 0x00（否则会被当成负数）。 */
function derInteger(bytes) {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    let value = bytes.subarray(start);
    if (value[0] & 0x80) value = concatBytes(new Uint8Array([0]), value);
    return der(0x02, value);
}

/** 裸 r||s（WebCrypto 的输出）→ DER SEQUENCE{INTEGER r, INTEGER s}。 */
export function rawSignatureToDer(raw) {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (bytes.length % 2 !== 0) throw new Error('Raw ECDSA signature has an odd length');
    const half = bytes.length / 2;
    return der(0x30, derInteger(bytes.subarray(0, half)), derInteger(bytes.subarray(half)));
}

// ─── 密钥 ─────────────────────────────────────────────────────────────────

const EC_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };

async function generateKeyPair() {
    return subtle().generateKey(EC_ALGORITHM, true, ['sign']);
}

export async function exportPrivateKeyPem(privateKey) {
    return pemFromBytes('PRIVATE KEY', new Uint8Array(await subtle().exportKey('pkcs8', privateKey)));
}

export async function importPrivateKeyPem(pem) {
    return subtle().importKey('pkcs8', bytesFromPem(pem), EC_ALGORITHM, true, ['sign']);
}

/** 一次签名：输入文本，输出 base64(DER)，与 node 的 sign().toString('base64') 等价。 */
export async function signTextDerBase64(privateKey, text) {
    const raw = new Uint8Array(await subtle().sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privateKey,
        utf8Bytes(text),
    ));
    return bytesToBase64(rawSignatureToDer(raw));
}

// ─── PKCS#10 ──────────────────────────────────────────────────────────────

// 2.5.4.<id>：0x55 = 2.5，04 = 4，最后是属性号（3=CN, 10=O, 11=OU）。
const OID_ATTRIBUTE = id => der(0x06, new Uint8Array([0x55, 0x04, id]));
const OID_ECDSA_SHA256 = der(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]));

function subjectAttribute(id, value) {
    return der(0x31, der(0x30, OID_ATTRIBUTE(id), der(0x0c, utf8Bytes(value))));
}

/**
 * 生成一次授权用的密钥对与证书请求。
 *
 * 参考实现特意强调：这是 Folia 自己这次授权临时生成的身份，不是客户端保存的身份 ——
 * 所以密钥只随这次会话持久化（用于后续签名），不复用、不跨账号。
 *
 * 返回值里 privateKey 是 CryptoKey（不可序列化，只在内存里用），guardKey 是它的
 * PKCS#8 PEM（持久化用）。调用方不要把 privateKey 写进任何存储。
 */
export async function createGuard() {
    const { privateKey, publicKey } = await generateKeyPair();
    const spki = new Uint8Array(await subtle().exportKey('spki', publicKey));
    const subject = der(0x30,
        subjectAttribute(3, 'bd-ticket-guard'),
        subjectAttribute(11, ''),
        subjectAttribute(10, ''),
    );
    const info = der(0x30, der(0x02, new Uint8Array([0])), subject, spki, der(0xa0));
    const algorithm = der(0x30, OID_ECDSA_SHA256);
    const signature = new Uint8Array(await subtle().sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privateKey,
        info,
    ));
    const request = der(0x30, info, algorithm, der(0x03, new Uint8Array([0]), rawSignatureToDer(signature)));
    // 上游要的是「**PEM 文本**再 base64」而不是 DER 的 base64 —— 同一个接口族里
    // 服务端下发的 client_cert 也是这个形态（见 protocol.readQishuiGuard 对
    // `-----BEGIN` 的判断）。发 DER base64 会被拒：/passport/open/get_access_ticket/
    // 回 10001，表现成「扫码确认了却登录失败」。
    return {
        privateKey,
        guardKey: await exportPrivateKeyPem(privateKey),
        csr: bytesToBase64(utf8Bytes(pemFromBytes('CERTIFICATE REQUEST', request))),
    };
}
