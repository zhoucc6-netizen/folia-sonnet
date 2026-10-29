// sync-server/src/md5.ts
// MD5，与客户端 `src/utils/md5.ts` 同一个算法。
//
// 校验一条缓存要拿平台上的歌词重算一遍键，而键是 MD5 —— 但 WebCrypto 只给 SHA 家族，
// 没有 MD5（`crypto.subtle.digest('MD5')` 会直接抛），所以这里自带一份。
//
// 输入按 UTF-8 编码：歌名与歌词正文都是中文，按 UTF-16 算出来的哈希和客户端对不上。

const SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** `floor(abs(sin(i + 1)) * 2^32)`，MD5 的常量表。 */
const K = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
}

const rotateLeft = (value: number, shift: number): number => (
  ((value << shift) | (value >>> (32 - shift))) >>> 0
);

const toUtf8Bytes = (input: string): Uint8Array => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(input);
  // 老运行时兜底：手写一份 UTF-8，避免为了一次编码去引依赖。
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(bytes);
};

const hex = (value: number): string => value.toString(16).padStart(2, '0');

export const md5 = (input: string): string => {
  const message = toUtf8Bytes(String(input ?? ''));
  const bitLength = message.length * 8;

  // 补位：一个 1，若干个 0，末尾 64 位长度（小端）。
  let paddedLength = message.length + 1;
  while ((paddedLength % 64) !== 56) paddedLength += 1;
  const padded = new Uint8Array(paddedLength + 8);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength, bitLength >>> 0, true);
  view.setUint32(paddedLength + 4, Math.floor(bitLength / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let block = 0; block < padded.length; block += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i += 1) {
      m[i] = view.getUint32(block + i * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f = 0;
      let g = 0;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const f32 = (f >>> 0) + (a >>> 0) + (K[i] >>> 0) + (m[g] >>> 0);
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(f32 >>> 0, SHIFT[i])) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return Array.from(out, hex).join('');
};
