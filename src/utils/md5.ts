// src/utils/md5.ts
// A small synchronous MD5, because the AI cloud cache's key has to match what
// the server filed the previous answer under.
//
// Web Crypto has no MD5 (only SHA-1/SHA-256), and a cache key is not a
// security decision — it is an address. Everyone who plays the same lyric file
// must compute the same address, so the algorithm is fixed rather than
// negotiated.

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// floor(2^32 * |sin(i + 1)|), the table MD5 is defined by.
const K = new Uint32Array(64);
for (let index = 0; index < 64; index += 1) {
  K[index] = Math.floor(Math.abs(Math.sin(index + 1)) * 4294967296) >>> 0;
}

const rotateLeft = (value: number, amount: number): number => (
  ((value << amount) | (value >>> (32 - amount))) >>> 0
);

const utf8Bytes = (input: string): Uint8Array => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(input);
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
};

const bytePairs = new Uint8Array(4);
const bytePairsView = new DataView(bytePairs.buffer);

/** One MD5 word as eight hex characters, low byte first. */
const toHex = (value: number): string => {
  bytePairsView.setUint32(0, value >>> 0, true);
  return Array.from(bytePairs, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** 32 lowercase hex characters — the shape the cache endpoints expect. */
export const md5 = (input: string): string => {
  const message = utf8Bytes(String(input ?? ''));
  const bitLength = message.length * 8;
  const withOne = message.length + 1;
  const paddedLength = withOne + ((56 - (withOne % 64) + 64) % 64);
  const buffer = new Uint8Array(paddedLength + 8);
  buffer.set(message);
  buffer[message.length] = 0x80;

  const view = new DataView(buffer.buffer);
  // Length is stored low word first; masked to 32 bits is plenty here.
  view.setUint32(paddedLength, bitLength >>> 0, true);
  view.setUint32(paddedLength + 4, Math.floor(bitLength / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < buffer.length; offset += 64) {
    const words = new Uint32Array(16);
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let f = 0;
      let g = 0;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }

      f = (f + a + K[index] + words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(f, SHIFTS[index])) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return `${toHex(a0)}${toHex(b0)}${toHex(c0)}${toHex(d0)}`;
};
