// src/utils/sha256.ts
/**
 * 字符串的小写 hex SHA-256。飞牛（FNOS）的密码登录接口要的就是这个。
 *
 * 为什么不直接用 `crypto.subtle`：它只在安全上下文里存在。自建 NAS 常常用
 * `http://192.168.x.x:端口` 访问，那一刻 `crypto.subtle` 是 undefined，
 * 直接在 `.digest()` 上抛 TypeError —— 登录就以一句毫不相关的错误失败，
 * 查起来只会怀疑到密码或网络头上。所以这里自带一份纯 JS 实现兜底，
 * Web Crypto 可用时优先用它（快且是平台自己审计过的），两者结果一致。
 */

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const toHex = (state: Uint32Array): string => {
    let output = '';
    for (let index = 0; index < state.length; index += 1) {
        output += state[index].toString(16).padStart(8, '0');
    }
    return output;
};

/** 纯 JS 的 SHA-256。Web Crypto 不可用时的兜底，也是单测能直接验的那条路。 */
export const sha256HexSync = (input: string): string => {
    const message = new TextEncoder().encode(input);
    // 补位：一个 0x80、若干个 0x00，末尾 8 字节写长度（位），整块凑成 64 字节的整数倍。
    // 向上取整，别写成 `((len + 9) >> 6) + 1`：那会在「本身已经对齐」的那几档（55、119…
    // 字节，即 len + 9 正好是 64 的倍数）多垫一整个块，长度前缀跟着挪到第二个块尾巴上，
    // 算出来的摘要与标准不符 —— 而那几档恰恰是块边界的用例。
    const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
    const buffer = new Uint8Array(paddedLength);
    buffer.set(message);
    buffer[message.length] = 0x80;
    const view = new DataView(buffer.buffer);
    const bitLength = message.length * 8;
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(paddedLength - 4, bitLength >>> 0);

    const state = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const schedule = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let index = 0; index < 16; index += 1) schedule[index] = view.getUint32(offset + index * 4);
        for (let index = 16; index < 64; index += 1) {
            const previous = schedule[index - 15];
            const older = schedule[index - 2];
            const s0 = (previous >>> 7 | previous << 25) ^ (previous >>> 18 | previous << 14) ^ (previous >>> 3);
            const s1 = (older >>> 17 | older << 15) ^ (older >>> 19 | older << 13) ^ (older >>> 10);
            schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0;
        }

        let a = state[0];
        let b = state[1];
        let c = state[2];
        let d = state[3];
        let e = state[4];
        let f = state[5];
        let g = state[6];
        let h = state[7];
        for (let index = 0; index < 64; index += 1) {
            const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
            const choice = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + choice + K[index] + schedule[index]) >>> 0;
            const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        state[0] = (state[0] + a) >>> 0;
        state[1] = (state[1] + b) >>> 0;
        state[2] = (state[2] + c) >>> 0;
        state[3] = (state[3] + d) >>> 0;
        state[4] = (state[4] + e) >>> 0;
        state[5] = (state[5] + f) >>> 0;
        state[6] = (state[6] + g) >>> 0;
        state[7] = (state[7] + h) >>> 0;
    }

    return toHex(state);
};

/** 优先用 Web Crypto，拿不到或出错时落到纯 JS 实现。 */
export const sha256Hex = async (input: string): Promise<string> => {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        try {
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
            return Array.from(new Uint8Array(digest))
                .map(value => value.toString(16).padStart(2, '0'))
                .join('');
        } catch {
            // 安全上下文的判断在个别 WebView 上不可靠：算不出来就换自己的实现。
        }
    }
    return sha256HexSync(input);
};
