// test/unit/nativeBridge/neteaseWeapi.test.ts
//
// 回归现场：「专辑界面读取不到数据」，真因不在专辑那条路由上 —— `weapi.js` 里的
// `RSA_MODULUS` 是一个被写坏的常量（从第 9 个字符起就与标准值分岔，413 位十六进制，
// 标准值是 256 位 / 1024 bit），算出来的 `encSecKey` 有 413 位。NetEase 解不开参数，
// 对**所有** weapi 请求一律回「HTTP 200 + 空 body」；而 `weapiRequest` 对空体返回 `{}`
// 且不抛错 —— 于是「网关解不开」和「这一栏本来没内容」在界面上是同一个样子：整页空着、
// 日志里看不到任何报错。靠现象反推这个根因非常贵，所以把「模数必须是对的」钉成单测。
//
// 本机实测（走代理发真请求）：修正前 `POST /weapi/toplist` 回 200 + 0 字节，
// 修正后回 `{"code":200,"list":[…]}`；专辑那条 `/weapi/v1/album/32311` 同样从空体变成正常 JSON。

import { describe, expect, it } from 'vitest';
import { weapiEncrypt } from '../../../src/nativeBridge/api/weapi.js';

describe('网易云 weapi 加密', () => {
    it('encSecKey 是 256 位十六进制（1024 bit 模数）', () => {
        const { encSecKey, params } = weapiEncrypt({ ids: 'x' });
        expect(encSecKey).toMatch(/^[0-9a-f]{256}$/);
        expect(params.length).toBeGreaterThan(0);
    });

    it('每次调用都用新的随机密钥', () => {
        const first = weapiEncrypt({ a: 1 });
        const second = weapiEncrypt({ a: 1 });
        expect(first.params).not.toBe(second.params);
        expect(first.encSecKey).not.toBe(second.encSecKey);
    });
});
