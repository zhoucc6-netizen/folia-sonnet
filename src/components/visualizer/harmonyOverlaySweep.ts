import type { LyricBackgroundVocal, Theme } from '../../types';
import type { GraphemeTiming } from '../../utils/lyrics/graphemeTiming';
import { measureMonetGraphemeOffsets, splitMonetGraphemes } from './monet/monetLyricsModel';
import { resolveWordColor } from './wordColoring';

// src/components/visualizer/harmonyOverlaySweep.ts
// 叠加歌词（HarmonyOverlay）里「唱到哪一列」与「文本怎么排」的纯算术部分。
//
// 抽出来是因为它有两条绘制路径：原来的 DOM 版（framer-motion + mask-image）和新的 WebGL2 版。
// 两边必须算出一模一样的结果，否则切到 GPU 那一路时字的位置会跳一下 —— 所以这里不许出现
// 与绘制有关的任何东西，只有度量与布局。

/** 一段同色的文本，按字符下标给区间（与 splitting 后的字素会再映射一次）。 */
export interface HarmonyColorRun {
    start: number;
    end: number;
    color: string;
}

/**
 * 行一句和声文本切成带颜色的区间。
 *
 * 歌词 Pit 只在 `.words` 上带颜色，标点和空隙没有 —— 这里沿用 DOM 版的做法：夹在两个歌词
 * 之间的标点跟着前一个歌词的颜色，句首的空隙用下一句的颜色。
 */
export const buildHarmonyColorRuns = (
    vocal: LyricBackgroundVocal,
    theme: Theme,
): HarmonyColorRun[] => {
    const runs: HarmonyColorRun[] = [];
    let cursor = 0;

    vocal.words.forEach(word => {
        const matchIndex = vocal.text.indexOf(word.text, cursor);
        if (matchIndex < 0) return;
        const color = resolveWordColor(word.text, theme.wordColors, theme.accentColor, { cjkMatchMode: 'exact' });
        if (matchIndex > cursor) {
            // 夹在两句之间的标点/空隙：跟着前一句的颜色（同一段里不可能出现 next run 的颜色，
            // 因为下一句还没轮到）。
            runs.push({ start: cursor, end: matchIndex, color });
        }
        runs.push({ start: matchIndex, end: matchIndex + word.text.length, color });
        cursor = matchIndex + word.text.length;
    });

    if (cursor < vocal.text.length) {
        const color = runs.length > 0 ? runs[runs.length - 1].color : theme.secondaryColor;
        runs.push({ start: cursor, end: vocal.text.length, color });
    }
    return runs;
};

/** 行内的一段同色文本及其起点（相对行首，CSS px）。 */
export interface HarmonyTextPiece {
    text: string;
    x: number;
    color: string;
}

export interface HarmonyTextRow {
    pieces: HarmonyTextPiece[];
    width: number;
}

export interface HarmonyTextLayout {
    rows: HarmonyTextRow[];
    /** 文本块的实际宽高（CSS px，不含留白）。 */
    width: number;
    height: number;
    rowHeight: number;
}

const EMPTY_LAYOUT: HarmonyTextLayout = { rows: [], width: 0, height: 0, rowHeight: 0 };

/** 断行优先挑空格后面的位置：中文没有空格，就退化成逐字断。 */
const findBreakIndex = (graphemes: string[], from: number, to: number): number => {
    for (let index = to - 1; index > from; index -= 1) {
        if (/^\s+$/.test(graphemes[index])) return index + 1;
    }
    return to;
};

/**
 * 按可用宽度把一句和声排出若干行，行内按颜色分段。
 *
 * 用的是 monet 那套带缓存的字素偏移（`offsets.length === graphemes.length + 1`）：一次 measure
 * 就能拿到任意连续区间的宽度，省掉逐次 measureText —— 这条路径每帧都在跑。
 */
export const layoutHarmonyText = (
    text: string,
    runs: HarmonyColorRun[],
    fontPx: number,
    fontSpec: string,
    maxWidth: number,
): HarmonyTextLayout => {
    if (!text || fontPx <= 0) return EMPTY_LAYOUT;
    const graphemes = splitMonetGraphemes(text);
    if (graphemes.length === 0) return EMPTY_LAYOUT;

    const offsets = measureMonetGraphemeOffsets(text, fontPx, fontSpec);
    if (offsets.length < graphemes.length + 1) return EMPTY_LAYOUT;

    // 字符下标 → 字素下标：runs 是按字符给的区间，而宽度是按字素算的。
    let charCursor = 0;
    const graphemeStartChar = graphemes.map(grapheme => {
        const start = charCursor;
        charCursor += grapheme.length;
        return start;
    });
    const colorAt = (graphemeIndex: number): string => {
        const charIndex = graphemeStartChar[graphemeIndex];
        for (const run of runs) {
            if (charIndex >= run.start && charIndex < run.end) return run.color;
        }
        return runs.length > 0 ? runs[0].color : '#ffffff';
    };

    const rowHeight = Math.round(fontPx * 1.3);
    const room = maxWidth > 0 ? maxWidth : Number.POSITIVE_INFINITY;
    const rows: HarmonyTextRow[] = [];
    let rowStart = 0;

    while (rowStart < graphemes.length) {
        let take = graphemes.length - rowStart;
        // 贪心：从一个字开始往后加，直到放不下为止。
        let breakAt = rowStart;
        for (let index = rowStart; index < graphemes.length; index += 1) {
            if (offsets[index + 1] - offsets[rowStart] > room) break;
            breakAt = index + 1;
        }
        if (breakAt <= rowStart) {
            // 单个字就超宽：硬塞一个字，否则会死循环。
            breakAt = rowStart + 1;
        } else if (breakAt < graphemes.length) {
            breakAt = findBreakIndex(graphemes, rowStart, breakAt);
        }
        take = breakAt - rowStart;

        const pieces: HarmonyTextPiece[] = [];
        let pieceStart = rowStart;
        for (let index = rowStart; index < breakAt; index += 1) {
            const isLast = index === breakAt - 1;
            const colorChanged = colorAt(index) !== colorAt(pieceStart);
            if (!isLast && colorChanged) {
                pieces.push({
                    text: graphemes.slice(pieceStart, index).join(''),
                    x: offsets[pieceStart] - offsets[rowStart],
                    color: colorAt(pieceStart),
                });
                pieceStart = index;
            }
        }
        pieces.push({
            text: graphemes.slice(pieceStart, breakAt).join(''),
            x: offsets[pieceStart] - offsets[rowStart],
            color: colorAt(pieceStart),
        });

        rows.push({ pieces, width: offsets[breakAt] - offsets[rowStart] });
        rowStart = breakAt;
    }

    const width = rows.reduce((widest, row) => Math.max(widest, row.width), 0);
    return {
        rows,
        width,
        height: rowHeight * rows.length,
        rowHeight,
    };
};

/**
 * 唱到哪一列（CSS px，相对行块左边缘）。DOM 与 WebGL 两条路径共用，保证切换时不会跳位置。
 */
export const resolveHarmonySweepWidth = (
    vocal: LyricBackgroundVocal,
    graphemeTimings: GraphemeTiming[],
    graphemeOffsets: number[],
    latest: number,
): number => {
    const fullWidth = graphemeOffsets[graphemeOffsets.length - 1] ?? 0;
    if (latest <= vocal.startTime) return 0;
    if (latest >= vocal.endTime) return fullWidth;

    const timingCount = Math.min(graphemeTimings.length, graphemeOffsets.length - 1);
    for (let index = 0; index < timingCount; index += 1) {
        const timing = graphemeTimings[index];
        const start = Math.max(vocal.startTime, timing.startTime);
        const end = Math.max(start, timing.endTime);
        const startWidth = graphemeOffsets[index] ?? 0;
        const endWidth = graphemeOffsets[index + 1] ?? startWidth;

        if (latest < start) return startWidth;
        if (latest <= end) {
            return startWidth + (endWidth - startWidth)
                * ((latest - start) / Math.max(0.001, end - start));
        }
    }

    return fullWidth;
};
