// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { LyricBackgroundVocal, Theme } from '@/types';
import type { GraphemeTiming } from '@/utils/lyrics/graphemeTiming';
import { buildHarmonyColorRuns, layoutHarmonyText, resolveHarmonySweepWidth } from '@/components/visualizer/harmonyOverlaySweep';
import { resolveHarmonyCanvasHeight } from '@/components/visualizer/harmonyOverlayWebgl';

// test/unit/visualizer/harmonyOverlaySweep.test.ts
// 叠加歌词 GPU 化那一步抽出来的纯算术。DOM 版和 WebGL 版必须算出同一个结果，否则切过去那一帧
// 字会跳位 —— 这里守的就是「两条路共用」的这部分。
//
// jsdom 的 measureText 恒返回 0，所以字宽用一个够用的假实现替代：这里验证的是排版与进度的算术，
// 不是真实字形宽度。

vi.mock('@/components/visualizer/monet/monetLyricsModel', async () => {
    const actual = await vi.importActual<typeof import('@/components/visualizer/monet/monetLyricsModel')>(
        '@/components/visualizer/monet/monetLyricsModel',
    );
    return {
        ...actual,
        measureMonetGraphemeOffsets: (text: string) => {
            const offsets = [0];
            Array.from(text).forEach((_grapheme, index) => offsets.push(offsets[index] + 20));
            return offsets;
        },
    };
});

const theme = {
    accentColor: '#ff0000',
    secondaryColor: '#00ff00',
    backgroundColor: '#000000',
    primaryColor: '#ffffff',
    wordColors: [{ word: '天空', color: '#0000ff' }],
} as unknown as Theme;

const vocal: LyricBackgroundVocal = {
    text: '天空之城',
    startTime: 0,
    endTime: 4,
    words: [
        { text: '天空', startTime: 0, endTime: 2 },
        { text: '之城', startTime: 2, endTime: 4 },
    ],
};

const timings: GraphemeTiming[] = [
    { char: '天', startTime: 0, endTime: 1 },
    { char: '空', startTime: 1, endTime: 2 },
    { char: '之', startTime: 2, endTime: 3 },
    { char: '城', startTime: 3, endTime: 4 },
];

const FONT_SPEC = '500 16px sans-serif';

describe('harmony overlay sweep', () => {
    it('gives every character a run and colors the timed words from the theme', () => {
        const runs = buildHarmonyColorRuns(vocal, theme);
        // 每个字符都得落在某个区间里，否则绘制时会漏字。
        const covered = runs.reduce((sum, run) => sum + (run.end - run.start), 0);
        expect(covered).toBe(vocal.text.length);
        expect(runs.find(run => run.start === 0)?.color).toBe('#0000ff');
    });

    it('sweeps from the line start to its end and nothing past it', () => {
        const offsets = [0, 20, 40, 60, 80];
        expect(resolveHarmonySweepWidth(vocal, timings, offsets, -1)).toBe(0);
        expect(resolveHarmonySweepWidth(vocal, timings, offsets, 0.5)).toBeCloseTo(10);
        expect(resolveHarmonySweepWidth(vocal, timings, offsets, 5)).toBe(80);
    });

    it('breaks lines instead of overflowing, and keeps every grapheme', () => {
        const runs = buildHarmonyColorRuns(vocal, theme);
        // 一行只够放两个字（假字宽 20px）。
        const layout = layoutHarmonyText(vocal.text, runs, 16, FONT_SPEC, 45);
        expect(layout.rows.length).toBe(2);
        expect(layout.rows.every(row => row.width <= 45)).toBe(true);
        expect(layout.rows.flatMap(row => row.pieces).map(piece => piece.text).join('')).toBe('天空之城');
        expect(layout.rows[0].pieces[0].x).toBe(0);
    });

    it('reports a canvas height that leaves room for the glow padding', () => {
        const runs = buildHarmonyColorRuns(vocal, theme);
        const layout = layoutHarmonyText(vocal.text, runs, 16, FONT_SPEC, 400);
        // padding = max(24, 行高*0.6)，这里行高 21 → 24。
        expect(resolveHarmonyCanvasHeight(layout)).toBe(layout.height + 48);
        expect(resolveHarmonyCanvasHeight({ rows: [], width: 0, height: 0, rowHeight: 0 })).toBe(0);
    });
});
