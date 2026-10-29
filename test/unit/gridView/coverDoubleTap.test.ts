import { describe, expect, it } from 'vitest';
import {
    DOUBLE_TAP_MS,
    DOUBLE_TAP_SLOP_PX,
    isDoubleTap,
    type TapPoint,
} from '../../../src/library/suites/grid/shared/coverDoubleTap';

// test/unit/gridView/coverDoubleTap.test.ts
// 双击封面的判定。手势在真机上才好验（点击是不是落得下来、会不会被拖动吃掉），
// 但「算不算一次双击」是纯函数，可以在这里钉住：判定宽一点会误播，窄一点等于没有这条手势。

const tap = (at: number, x = 100, y = 100): TapPoint => ({ at, x, y });

describe('isDoubleTap', () => {
    it('needs a previous tap: the first one only arms the gesture', () => {
        expect(isDoubleTap(null, tap(1000))).toBe(false);
    });

    it('counts two taps close in time and place', () => {
        expect(isDoubleTap(tap(1000), tap(1000 + DOUBLE_TAP_MS - 1))).toBe(true);
    });

    it('takes the window at its edge', () => {
        expect(isDoubleTap(tap(1000), tap(1000 + DOUBLE_TAP_MS))).toBe(true);
        expect(isDoubleTap(tap(1000), tap(1000 + DOUBLE_TAP_MS + 1))).toBe(false);
    });

    it('refuses a slow second tap: two separate taps, not a double tap', () => {
        expect(isDoubleTap(tap(1000), tap(1000 + 900))).toBe(false);
        // 上一次比这一次「晚」也只能是另一次点击（计时器回拨、或事件乱序）：不认。
        expect(isDoubleTap(tap(2000), tap(1000))).toBe(false);
    });

    it('takes the slop at its edge and no further', () => {
        expect(isDoubleTap(tap(1000, 100, 100), tap(1100, 100 + DOUBLE_TAP_SLOP_PX, 100))).toBe(true);
        expect(isDoubleTap(tap(1000, 100, 100), tap(1100, 100, 100 + DOUBLE_TAP_SLOP_PX))).toBe(true);
        expect(isDoubleTap(tap(1000, 100, 100), tap(1100, 100 + DOUBLE_TAP_SLOP_PX + 1, 100))).toBe(false);
        expect(isDoubleTap(tap(1000, 100, 100), tap(1100, 100 - DOUBLE_TAP_SLOP_PX - 1, 100))).toBe(false);
    });

    it('does not mistake the far end of a drag for the second tap', () => {
        expect(isDoubleTap(tap(1000, 40, 40), tap(1150, 260, 190))).toBe(false);
    });
});
