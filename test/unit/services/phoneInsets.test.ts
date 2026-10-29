// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
    applyPushedPhoneInsets,
    getPhoneInsets,
    getPhoneInsetsSource,
} from '../../../src/services/phoneInsets';

// src/services/phoneInsets.ts 在**叠层**（系统悬浮层）这一页的用法。
//
// 那一页是另一个 WebView，没有 Capacitor 桥 —— installPhoneInsets 在那儿只会拿到
// 'unavailable'，四项永远 0。数值改由原生跟着状态包推下来（WallpaperOverlay.buildPayload 的
// `insets`），走 applyPushedPhoneInsets 落到同一份 current 和 CSS 变量上。
// 商籁右上角那行歌曲描述是画在 Pixi 画布里的，读的就是这份值 —— 这里锁住「推下去就有」。

const readVar = (name: string) => document.documentElement.style.getPropertyValue(name);

describe('applyPushedPhoneInsets', () => {
    it('把原生推下来的安全区写到 CSS 变量上', () => {
        applyPushedPhoneInsets({ top: 36, right: 0, bottom: 24, left: 0 });

        expect(getPhoneInsets()).toEqual({ top: 36, right: 0, bottom: 24, left: 0 });
        expect(readVar('--folia-safe-area-top')).toBe('36px');
        expect(readVar('--folia-safe-area-bottom')).toBe('24px');
        expect(getPhoneInsetsSource()).toBe('native');
    });

    it('全 0 当作「还没量到」，不覆盖已有的值', () => {
        applyPushedPhoneInsets({ top: 36, right: 0, bottom: 24, left: 0 });
        applyPushedPhoneInsets({ top: 0, right: 0, bottom: 0, left: 0 });

        expect(getPhoneInsets()).toEqual({ top: 36, right: 0, bottom: 24, left: 0 });
    });

    it('字段缺失按 0 算，负数与脏值被夹掉', () => {
        applyPushedPhoneInsets({ top: Number.NaN, right: -12, bottom: 'nope' });

        expect(getPhoneInsets()).toEqual({ top: 36, right: 0, bottom: 24, left: 0 });
    });
});
