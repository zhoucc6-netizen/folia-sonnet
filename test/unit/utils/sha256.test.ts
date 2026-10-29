import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexSync } from '../../../src/utils/sha256';

// test/unit/utils/sha256.test.ts
// 飞牛的密码登录要传 sha256(password)，所以这两条实现（Web Crypto 与纯 JS 兜底）
// 必须给出同一个结果 —— 少了这条测试，http 自建地址上「crypto.subtle 不存在」
// 那条路走错了会表现成一句毫不相关的登录失败。

// 标准的 SHA-256 测试向量（NIST 的样例与几个常见输入）。
const VECTORS: Array<[string, string]> = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
        'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    ['a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
];

describe('sha256Hex', () => {
    it('matches the published test vectors', () => {
        for (const [input, expected] of VECTORS) {
            expect(sha256HexSync(input)).toBe(expected);
        }
    });

    it('agrees with the async entry point', async () => {
        for (const [input, expected] of VECTORS) {
            expect(await sha256Hex(input)).toBe(expected);
        }
    });

    it('hashes non-ascii text as utf-8 bytes', () => {
        // 多字节字符必须按 UTF-8 的字节算：按 UTF-16 码元算会得到另一个值。
        expect(sha256HexSync('密码')).toBe('a621ab606db2a11f63edc576a729843b8269250dc324206871d90635ac5e531c');
        expect(sha256HexSync('密码')).not.toBe(sha256HexSync('密 码'));
        expect(sha256HexSync('密码')).toMatch(/^[0-9a-f]{64}$/);
    });
});
