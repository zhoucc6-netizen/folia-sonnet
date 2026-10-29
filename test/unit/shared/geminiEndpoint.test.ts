import { describe, expect, it } from 'vitest';
import {
    GEMINI_DEFAULT_API_BASE,
    GEMINI_DEFAULT_MODEL,
    resolveGeminiGenerateContentUrl,
} from '../../../shared/geminiEndpoint.mjs';

// test/unit/shared/geminiEndpoint.test.ts
//
// 这一份要盯住两件事：
//  1. 各种「用户会填成什么样」的输入都拼出能打的端点（填错一律回落默认，不抛）；
//  2. .mjs / .cjs 两份给出同样的结果 —— 渲染进程与主进程各用一份，跑偏了就会出现
//     「App 里能生成、桌面版打的是另一个地址」这种最难查的不一致。

const cjs = require('../../../shared/geminiEndpoint.cjs') as {
    GEMINI_DEFAULT_API_BASE: string;
    GEMINI_DEFAULT_MODEL: string;
    resolveGeminiGenerateContentUrl: (rawUrl: unknown, model?: unknown) => string;
};

const DEFAULT_ENDPOINT = `${GEMINI_DEFAULT_API_BASE}/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`;

const CASES: Array<{ name: string; input: unknown; expected: string }> = [
    { name: '留空走默认', input: '', expected: DEFAULT_ENDPOINT },
    { name: 'null 走默认', input: null, expected: DEFAULT_ENDPOINT },
    { name: 'undefined 走默认', input: undefined, expected: DEFAULT_ENDPOINT },
    { name: '只有空白走默认', input: '   ', expected: DEFAULT_ENDPOINT },
    { name: '默认域名补全路径', input: GEMINI_DEFAULT_API_BASE, expected: DEFAULT_ENDPOINT },
    {
        name: '官方域名也要能回去',
        input: 'https://generativelanguage.googleapis.com',
        expected: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`,
    },
    {
        name: '前缀带尾斜杠不会拼出双斜杠',
        input: `${GEMINI_DEFAULT_API_BASE}/`,
        expected: DEFAULT_ENDPOINT,
    },
    {
        name: '前面带空格照样认',
        input: `  ${GEMINI_DEFAULT_API_BASE}  `,
        expected: DEFAULT_ENDPOINT,
    },
    {
        name: '中文冒号照样认',
        input: 'https：//proxy.example',
        expected: `https://proxy.example/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`,
    },
    {
        name: '已经填到动作名就原样用',
        input: 'https://proxy.example/v1beta/models/gemini-2.5-flash:generateContent',
        expected: 'https://proxy.example/v1beta/models/gemini-2.5-flash:generateContent',
    },
    {
        name: '填到模型这一级只补动作名',
        input: 'https://proxy.example/v1beta/models/gemini-2.5-flash',
        expected: 'https://proxy.example/v1beta/models/gemini-2.5-flash:generateContent',
    },
    {
        name: '带端口也保留',
        input: 'http://192.168.1.9:8080',
        expected: `http://192.168.1.9:8080/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`,
    },
    // 解析不出来一律回落默认：地址是随手填的，一个拼错的地址不该让「AI 不可用」。
    { name: '不是 URL 回落默认', input: 'not a url', expected: DEFAULT_ENDPOINT },
    { name: '非 http 协议回落默认', input: 'ftp://proxy.example', expected: DEFAULT_ENDPOINT },
];

describe('gemini endpoint', () => {
    it.each(CASES)('$name', ({ input, expected }) => {
        expect(resolveGeminiGenerateContentUrl(input)).toBe(expected);
    });

    it('把默认模型换成调用方给的那个', () => {
        expect(resolveGeminiGenerateContentUrl('', 'gemini-9-pro'))
            .toBe(`${GEMINI_DEFAULT_API_BASE}/v1beta/models/gemini-9-pro:generateContent`);
    });

    it('留空总是解析成默认（设置里存空串就是「用默认」）', () => {
        expect(resolveGeminiGenerateContentUrl('')).toBe(DEFAULT_ENDPOINT);
    });

    // 主进程用 .cjs、渲染进程用 .mjs，两份必须给出同样的结果。
    it('keeps the CommonJS twin identical', () => {
        expect(cjs.GEMINI_DEFAULT_API_BASE).toBe(GEMINI_DEFAULT_API_BASE);
        expect(cjs.GEMINI_DEFAULT_MODEL).toBe(GEMINI_DEFAULT_MODEL);
        for (const { input } of CASES) {
            expect(cjs.resolveGeminiGenerateContentUrl(input)).toBe(resolveGeminiGenerateContentUrl(input));
        }
        expect(cjs.resolveGeminiGenerateContentUrl('', 'gemini-9-pro'))
            .toBe(resolveGeminiGenerateContentUrl('', 'gemini-9-pro'));
    });
});
