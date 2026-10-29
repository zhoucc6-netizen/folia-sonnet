import { describe, expect, it } from 'vitest';
import zhCN from '@/i18n/locales/zh-CN';
import { flattenLocale } from '@/i18n/config';

// test/unit/i18n/flattenLocale.test.ts
// 来自上游 #763。改写的动机是启动开销：旧实现每递归一层都把「已经铺好的表」整份复制一次。
// 这里留一份旧实现的参照拷贝，钉住两件事 —— 结果一样，**键的顺序也一样**。
// 顺序不是风格问题：缺键兜底那张表按插入顺序被读，顺序一变，后端对不齐的地方就会换地方。

const flattenLocaleBySpread = (obj: Record<string, any>, prefix = ''): Record<string, string> => {
    let result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null) {
            result = { ...result, ...flattenLocaleBySpread(value, path) };
        } else {
            result[path] = String(value);
        }
    }
    return result;
};

const expectSameMap = (actual: Record<string, string>, expected: Record<string, string>) => {
    expect(Object.entries(actual)).toEqual(Object.entries(expected));
};

describe('flattenLocale', () => {
    it('在 zh-CN 上与旧实现一致，连键的顺序也一样', () => {
        expectSameMap(flattenLocale(zhCN), flattenLocaleBySpread(zhCN));
    });

    it('后写的嵌套路径覆盖同名的点号键，但不改变它的位置', () => {
        const input = {
            first: '1',
            'a.b': 'dotted',
            mid: '2',
            a: { b: 'nested', c: 'child' },
            last: '3',
        };
        const expected = {
            first: '1',
            'a.b': 'nested',
            mid: '2',
            'a.c': 'child',
            last: '3',
        };
        expectSameMap(flattenLocale(input), expected);
        expectSameMap(flattenLocale(input), flattenLocaleBySpread(input));
    });

    it('后写的点号键就地覆盖先前的嵌套路径', () => {
        const input = {
            a: { b: 'nested' },
            'a.b': 'dotted',
            z: 'end',
        };
        const expected = {
            'a.b': 'dotted',
            z: 'end',
        };
        expectSameMap(flattenLocale(input), expected);
        expectSameMap(flattenLocale(input), flattenLocaleBySpread(input));
    });

    it('数组按下标铺、数字与 null 转字符串、空对象不产生键', () => {
        const input = {
            items: ['x', 2, null, { n: 0 }],
            count: 3,
            flag: false,
            missing: undefined,
            empty: {},
            nestedEmpty: { d: {} },
            blank: [],
        };
        const expected = {
            'items.0': 'x',
            'items.1': '2',
            'items.2': 'null',
            'items.3.n': '0',
            count: '3',
            flag: 'false',
            missing: 'undefined',
        };
        expectSameMap(flattenLocale(input), expected);
        expectSameMap(flattenLocale(input), flattenLocaleBySpread(input));
    });

    it('显式前缀留在每个键上', () => {
        const input = { a: { b: 1 } };
        expectSameMap(flattenLocale(input, 'pre'), { 'pre.a.b': '1' });
        expectSameMap(flattenLocale(input, 'pre'), flattenLocaleBySpread(input, 'pre'));
    });
});
