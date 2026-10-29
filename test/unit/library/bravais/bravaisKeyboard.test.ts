import { describe, expect, it } from 'vitest';
import { getWallSlot } from '@/components/wall/wallSlots';
import { resolveBravaisKey, resolveEscapeStep, type BravaisKeyInput } from '@/library/suites/bravais/bravaisKeyboardModel';
import { resolveSeamEscapeLevel } from '@/library/suites/bravais/bravaisSeamLevel';
import { findAdjacentSlot } from '@/library/suites/bravais/bravaisNavigation';
import { resolveFocusReflow } from '@/library/suites/bravais/bravaisDisplay';

// test/unit/library/bravais/bravaisKeyboard.test.ts
// 墙上的按键规则（设计稿 §7.6）：只认不可打印键、修饰键组合只处理 Alt+Enter 一族、Esc 不响应长按；Esc 阶梯每次一级；
// 方向键在绝对块坐标的墙上走到相邻的有内容磁贴，聚焦卡所在块按让位后的矩形走。

const metrics = { cellSize: 128, gap: 8 };
const key = (input: Partial<BravaisKeyInput> & { key: string }): BravaisKeyInput => ({
    shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, ...input,
});

describe('resolveBravaisKey', () => {
    it('maps arrows, Home, PgUp / PgDn and Tab', () => {
        expect(resolveBravaisKey(key({ key: 'ArrowLeft' }))).toEqual({ type: 'move', direction: 'left' });
        expect(resolveBravaisKey(key({ key: 'ArrowDown' }))).toEqual({ type: 'move', direction: 'down' });
        expect(resolveBravaisKey(key({ key: 'Home' }))).toEqual({ type: 'first' });
        expect(resolveBravaisKey(key({ key: 'PageDown' }))).toEqual({ type: 'page', direction: 1 });
        expect(resolveBravaisKey(key({ key: 'PageUp' }))).toEqual({ type: 'page', direction: -1 });
        expect(resolveBravaisKey(key({ key: 'Tab', shiftKey: true }))).toEqual({ type: 'tab', backwards: true });
    });

    it('maps the Enter family and ignores its key repeat', () => {
        expect(resolveBravaisKey(key({ key: 'Enter' }))).toEqual({ type: 'enter' });
        expect(resolveBravaisKey(key({ key: 'Enter', shiftKey: true }))).toEqual({ type: 'enqueue' });
        expect(resolveBravaisKey(key({ key: 'Enter', altKey: true }))).toEqual({ type: 'open-album' });
        expect(resolveBravaisKey(key({ key: 'Enter', altKey: true, shiftKey: true }))).toEqual({ type: 'open-artist' });
        expect(resolveBravaisKey(key({ key: 'Enter', repeat: true }))).toBeNull();
    });

    it('leaves printable keys, Space and other modifier combinations alone', () => {
        for (const input of [
            key({ key: 'a' }),
            key({ key: ' ' }),
            key({ key: 's' }),
            key({ key: 'Enter', ctrlKey: true }),
            key({ key: 'ArrowRight', ctrlKey: true }),
            key({ key: 'ArrowRight', shiftKey: true }),
            key({ key: 'ArrowRight', altKey: true }),
            key({ key: 'k', metaKey: true }),
            key({ key: 'Escape', repeat: true }),
        ]) {
            expect(resolveBravaisKey(input), input.key).toBeNull();
        }
        expect(resolveBravaisKey(key({ key: 'Escape' }))).toEqual({ type: 'escape' });
    });

    it('carries the system-back flag: the ladder skips the keyboard focus ring for it', () => {
        // 安卓返回键 / 边缘返回手势转成的那一次 Esc（useNativeBackButton 派发时打的标记）。
        expect(resolveBravaisKey(key({ key: 'Escape', nativeBack: true }))).toEqual({ type: 'escape', nativeBack: true });
        expect(resolveBravaisKey(key({ key: 'Escape' }))).toEqual({ type: 'escape' });
    });
});

describe('resolveEscapeStep', () => {
    it('handles one level per press: form, focus card, keyboard focus, panel, query, back', () => {
        const all = { hasForm: true, hasFocusCard: true, hasKeyboardFocus: true, hasPanel: true, hasQuery: true, canGoBack: true };
        expect(resolveEscapeStep(all)).toBe('form');
        expect(resolveEscapeStep({ ...all, hasForm: false })).toBe('focus-card');
        expect(resolveEscapeStep({ ...all, hasForm: false, hasFocusCard: false })).toBe('keyboard-focus');
        expect(resolveEscapeStep({ ...all, hasForm: false, hasFocusCard: false, hasKeyboardFocus: false })).toBe('panel');
        expect(resolveEscapeStep({ hasFocusCard: false, hasKeyboardFocus: false, hasQuery: true, canGoBack: true })).toBe('query');
        expect(resolveEscapeStep({ hasFocusCard: false, hasKeyboardFocus: false, canGoBack: true })).toBe('back');
        // 首页没有 onBack：最后一级什么都不做（不吞掉 Esc）。
        expect(resolveEscapeStep({ hasFocusCard: false, hasKeyboardFocus: false, canGoBack: false })).toBeNull();
    });

    it('folds the expanded seam back after the query and before leaving the layer', () => {
        const base = { hasFocusCard: false, hasKeyboardFocus: false, canGoBack: true };
        expect(resolveEscapeStep({ ...base, hasQuery: true, hasSeam: true })).toBe('query');
        expect(resolveEscapeStep({ ...base, hasSeam: true })).toBe('seam');
        expect(resolveEscapeStep({ ...base })).toBe('back');
    });

    it('closes the seam search before folding the seam or leaving the layer', () => {
        const base = { hasFocusCard: false, hasKeyboardFocus: false, canGoBack: true };
        expect(resolveEscapeStep({ ...base, hasSearch: true, hasSeam: true })).toBe('search');
        expect(resolveEscapeStep({ ...base, hasSearch: true })).toBe('search');
        // 搜索框的 Esc 原本只挂在输入框的 React onKeyDown 上：安卓返回派发到 window 的那一次到不了它
        // （BravaisSeamSearch），所以这一级是给返回手势用的。
        expect(resolveEscapeStep({ ...base, hasSeam: true })).toBe('seam');
    });
});

describe('resolveSeamEscapeLevel', () => {
    it('folds a seam the user expanded, and leaves the wide default alone', () => {
        // 窄屏（手机）默认只给书脊：完整信息条是用户自己展开的，Esc / 返回先把它收回去。
        expect(resolveSeamEscapeLevel('full', 480)).toBe('spine');
        // 宽屏默认就是完整信息条 —— 那不是「展开过」，收它等于按了返回只动了一下信息条。
        expect(resolveSeamEscapeLevel('full', 1280)).toBeNull();
        expect(resolveSeamEscapeLevel('spine', 480)).toBeNull();
        expect(resolveSeamEscapeLevel('hidden', 480)).toBeNull();
    });
});

describe('findAdjacentSlot', () => {
    const everything = () => true;

    it('steps to a slot wholly ahead in every direction, across block borders', () => {
        const from = getWallSlot(0, 0, 0, metrics)!;
        for (const direction of ['up', 'down', 'left', 'right'] as const) {
            const next = findAdjacentSlot(from, direction, { hasContent: everything });
            expect(next, direction).not.toBeNull();
            if (direction === 'right') expect(next!.x).toBeGreaterThanOrEqual(from.x + from.width);
            if (direction === 'left') expect(next!.x + next!.width).toBeLessThanOrEqual(from.x);
            if (direction === 'down') expect(next!.y).toBeGreaterThanOrEqual(from.y + from.height);
            if (direction === 'up') expect(next!.y + next!.height).toBeLessThanOrEqual(from.y);
        }
    });

    it('skips slots without content', () => {
        const from = getWallSlot(0, 0, 0, metrics)!;
        const first = findAdjacentSlot(from, 'right', { hasContent: everything })!;
        const next = findAdjacentSlot(from, 'right', { hasContent: slot => slot.key !== first.key })!;
        expect(next.key).not.toBe(first.key);
    });

    it('navigates by the re-geared rects inside the focus card block', () => {
        const focused = getWallSlot(3, 3, 6, metrics)!;
        const reflow = resolveFocusReflow(focused.key);
        const card = reflow.get(focused.key)!;
        const next = findAdjacentSlot(focused, 'right', {
            hasContent: everything,
            drawn: slot => reflow.get(slot.key) ?? slot,
        })!;
        const drawn = reflow.get(next.key) ?? next;
        expect(drawn.x).toBeGreaterThanOrEqual(card.x + card.width);
    });

    it('gives up after three rings of empty blocks', () => {
        const from = getWallSlot(0, 0, 0, metrics)!;
        expect(findAdjacentSlot(from, 'right', { hasContent: () => false })).toBeNull();
    });
});
