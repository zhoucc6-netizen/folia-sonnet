// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { wordGlowVariants } from '@/components/visualizer/wordGlow';
import {
    clearCanvasTextGlow,
    quantizeShadowBlur,
    setCanvasTextGlow,
    setGlowBlurQuantized,
} from '@/utils/glowBlurQuantize';
import { isLyricFlat } from '@/utils/lyricFlat';

// test/unit/visualizer/lyricFlat.test.ts
// 歌词扁平化开关（设置 → 常规「歌词扁平化」）：打开后歌词不该有任何发光。
//
// 发光有三条路，只有两条能靠 CSS 压（text-shadow、DOM 上的 filter），canvas 内部的 shadowBlur
// CSS 根本到不了 —— 所以必须在绘制侧也收口。这里守的是那两个 canvas / framer 的统一入口，
// 它们一旦漏了，开关在 fume、classic、partita 这些模式上就是无效的（现象：开了还是发光）。
//
// 开关值是 <html data-lyric-flat> 这个属性（store 写、CSS 读、utils 也读），测试按同样的方式开关。

type Target = { color?: string; textShadow?: unknown; filter?: unknown; opacity?: unknown };
const active = (custom: Record<string, unknown>) => (
    (wordGlowVariants.active as unknown as (c: unknown) => Target)(custom)
);

const CUSTOMS = [
    { activeColor: '#ffd54f', wordRevealMode: 'instant', duration: 0.1 },
    { activeColor: '#ffd54f', wordRevealMode: 'fast', duration: 0.15 },
    { activeColor: '#ffd54f', wordRevealMode: 'normal', duration: 0.6, index: 1, total: 3 },
    { activeColor: '#ffd54f', wordRevealMode: 'normal', duration: 0.6 },
];

const setFlat = (enabled: boolean) => {
    if (enabled) document.documentElement.setAttribute('data-lyric-flat', '1');
    else document.documentElement.removeAttribute('data-lyric-flat');
};

afterEach(() => { setFlat(false); setGlowBlurQuantized(false); });

describe('lyric flat switch', () => {
    it('is off until the store writes the attribute', () => {
        expect(isLyricFlat()).toBe(false);
        setFlat(true);
        expect(isLyricFlat()).toBe(true);
    });

    it('gives the word glow layer nothing to paint', () => {
        // 那层光晕本来就是「透明的字 + 只留它的影子」（见 wordGlow.ts）：没了影子就得彻底
        // 看不见，留着一个全透明的副本只是白白多合成一层。
        for (const quantized of [false, true]) {
            setGlowBlurQuantized(quantized);
            setFlat(true);
            for (const custom of CUSTOMS) {
                const target = active(custom);
                expect(target.color).toBe('transparent');
                expect(target.opacity).toBe(0);
                expect(target.textShadow).toBe('none');
                expect(target.filter).toBe('none');
            }
        }
    });

    it('leaves no blur on canvas text', () => {
        const context = { shadowBlur: 0, shadowColor: 'transparent', filter: 'none' } as CanvasRenderingContext2D;
        for (const quantized of [false, true]) {
            setGlowBlurQuantized(quantized);
            setFlat(true);
            expect(quantizeShadowBlur(19.6)).toBe(0);

            setCanvasTextGlow(context, 12, 'red');
            expect([context.shadowBlur, context.shadowColor, context.filter]).toEqual([0, 'transparent', 'none']);
            clearCanvasTextGlow(context);
            expect([context.shadowBlur, context.filter]).toEqual([0, 'none']);
        }
    });

    it('gives the animation back unchanged once the switch is off again', () => {
        // 关掉开关必须回到完整 fallthrough 的旧动画，不能留下半关的状态。
        for (const quantized of [false, true]) {
            setGlowBlurQuantized(quantized);
            setFlat(true);
            setFlat(false);
            expect(quantizeShadowBlur(19.6)).toBe(quantized ? 20 : 19.6);
        }

        setGlowBlurQuantized(true);
        const target = active(CUSTOMS[3]);
        expect(target.opacity).toEqual([0, 1, 1]);
        expect(target.filter).toEqual([
            'drop-shadow(0 0 0px rgba(255, 213, 79, 0.7)) drop-shadow(0 0 0px #ffd54f)',
            'drop-shadow(0 0 8px rgba(255, 213, 79, 0.7)) drop-shadow(0 0 16px #ffd54f)',
            'drop-shadow(0 0 8px rgba(255, 213, 79, 0.7)) drop-shadow(0 0 16px #ffd54f)',
        ]);
    });
});
