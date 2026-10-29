import { describe, expect, it } from 'vitest';
import {
    DEFAULT_RENDER_PIXEL_RATIO,
    RENDER_PIXEL_RATIO_OPTIONS,
    isRenderPixelRatio,
    parseRenderPixelRatio,
    resolveRenderPixelRatio,
} from '../../../src/utils/renderPixelRatio';

// Pure half of the render-resolution cap: what a stored value parses to, and what the cap does to
// a real screen ratio. The window patch itself is covered by the desktop smoke pass, not here.

describe('isRenderPixelRatio', () => {
    it('accepts every offered step', () => {
        for (const option of RENDER_PIXEL_RATIO_OPTIONS) {
            expect(isRenderPixelRatio(option)).toBe(true);
        }
    });

    it('rejects values that are not steps, even plausible ones', () => {
        expect(isRenderPixelRatio(1.75)).toBe(false);
        expect(isRenderPixelRatio(3)).toBe(false);
        expect(isRenderPixelRatio(0)).toBe(false);
        expect(isRenderPixelRatio('1')).toBe(false);
        expect(isRenderPixelRatio(null)).toBe(false);
        expect(isRenderPixelRatio(undefined)).toBe(false);
        expect(isRenderPixelRatio(Number.NaN)).toBe(false);
    });

    it('offers the default step', () => {
        expect(isRenderPixelRatio(DEFAULT_RENDER_PIXEL_RATIO)).toBe(true);
    });
});

describe('parseRenderPixelRatio', () => {
    it('treats missing, empty and "off" as follow-the-screen', () => {
        expect(parseRenderPixelRatio(null)).toBeNull();
        expect(parseRenderPixelRatio('')).toBeNull();
        expect(parseRenderPixelRatio('off')).toBeNull();
    });

    it('parses the stored numbers', () => {
        expect(parseRenderPixelRatio('1')).toBe(1);
        expect(parseRenderPixelRatio('0.75')).toBe(0.75);
        expect(parseRenderPixelRatio('2')).toBe(2);
    });

    it('falls back to follow-the-screen on garbage instead of throwing', () => {
        expect(parseRenderPixelRatio('abc')).toBeNull();
        expect(parseRenderPixelRatio('1.75')).toBeNull();
        expect(parseRenderPixelRatio('-1')).toBeNull();
        expect(parseRenderPixelRatio('Infinity')).toBeNull();
    });
});

describe('resolveRenderPixelRatio', () => {
    it('leaves the screen ratio alone without a cap', () => {
        expect(resolveRenderPixelRatio(2, null)).toBe(2);
        expect(resolveRenderPixelRatio(1.5, null)).toBe(1.5);
    });

    it('only ever lowers the ratio', () => {
        expect(resolveRenderPixelRatio(2, 1)).toBe(1);
        expect(resolveRenderPixelRatio(1.5, 1)).toBe(1);
        expect(resolveRenderPixelRatio(0.8, 1)).toBe(0.8);
        expect(resolveRenderPixelRatio(1, 2)).toBe(1);
    });

    it('treats a broken native ratio as 1x', () => {
        expect(resolveRenderPixelRatio(0, 1)).toBe(1);
        expect(resolveRenderPixelRatio(Number.NaN, null)).toBe(1);
        expect(resolveRenderPixelRatio(Number.POSITIVE_INFINITY, 1.5)).toBe(1);
        expect(resolveRenderPixelRatio(-2, null)).toBe(1);
    });
});
