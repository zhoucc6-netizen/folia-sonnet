import { describe, expect, it } from 'vitest';
import type { Line, Theme } from '@/types';
import { layoutLatticeLine, type LatticeTypography } from '@/components/app/lattice/lyrics/latticeLyricLayout';
import {
    buildWordColorRangesFromMatchers,
    prepareWordColorMatchers,
    resolveTokenColorMap,
    resolveWordColor,
} from '@/components/visualizer/wordColoring';

// test/unit/lattice/latticeWordColoring.test.ts
// 磁贴墙（歌曲墙 / 海报墙）的歌词**显示**这一层：AI 主题挑的高亮词，在墙上到底给哪几个词上色。
//
// 用户报的是「整行一个颜色 / 没有 AI 高亮」，而播放页同一首歌是有高亮的。两边共用同一份
// wordColors，所以差别只可能在「这一行切成哪几个能上色的单元」—— 这里把那一整条路原样跑
// 一遍（layoutLatticeLine → buildWordColorRangesFromMatchers → resolveTokenColorMap →
// resolveWordColor），哪个词拿到什么颜色，一眼看得见。

const ACCENT = '#123456';
const FALLBACK = ACCENT;
const RED = '#ff0000';
const GREEN = '#00ff00';

/** 一个字 12px 宽，够宽不至于换行。 */
const measure = (text: string) => ({ width: text.length * 12, height: 24 });
const type = {
    fontPx: 24, font: '600 24px sans-serif', translationPx: 12, translationFont: '500 12px sans-serif',
    showTranslation: false, lineHeight: 28, translationLineHeight: 16, padding: 14,
} as LatticeTypography;

const lineOf = (fullText: string, words: Line['words'] = [], extra: Partial<Line> = {}): Line => ({
    fullText, words, startTime: 0, endTime: 4, ...extra,
});

/** 与 latticeLyricScene.resolvePieceColor 同一套取法。 */
const pieceColors = (line: Line, wordColors: NonNullable<Theme['wordColors']>) => {
    const { pieces } = layoutLatticeLine(line, type, 4096, measure, false);
    const matchers = prepareWordColorMatchers(wordColors, true);
    const ranges = buildWordColorRangesFromMatchers(line.fullText, matchers);
    const colors = resolveTokenColorMap(pieces.map(piece => piece.token), ranges);
    return pieces
        .filter(piece => !piece.translation)
        .map(piece => ({
            text: piece.text,
            color: colors.get(piece.token.key)
                ?? resolveWordColor(piece.text, wordColors, FALLBACK, { keywordColoringEnabled: true }),
        }));
};

describe('磁贴墙歌词上的 AI 高亮色', () => {
    it('挑的是几个短词时，只有那几个词是关键字的颜色', () => {
        const colors = pieceColors(lineOf('故事的小黄花 童年的荡秋千'), [
            { word: '小黄花', color: RED },
            { word: '荡秋千', color: GREEN },
        ]);

        expect(colors.map(entry => entry.color)).toContain(RED);
        expect(colors.map(entry => entry.color)).toContain(GREEN);
        // 不是整行一个颜色：其余的词兜的是强调色。
        expect(colors.some(entry => entry.color === FALLBACK)).toBe(true);
    });

    /*
     * 用户那句「整行一个颜色 / 没有 AI 高亮」：有的音源的逐字歌词整行只给一个 word（一行
     * 一条时间）。墙照 line.words 切就是「整行一个 token」，一个 token 只能拿一个颜色 ——
     * 于是要么整行刷成某个关键字的颜色，要么一个都没中、整行兜主题色。
     *
     * 播放页那几套样式不受影响：它们自己按语义分词，不看 line.words 的粒度。
     */
    it('is not one flat colour when the timed words are one entry for the whole line', () => {
        const colors = pieceColors(
            lineOf('故事的小黄花 童年的荡秋千', [
                { text: '故事的小黄花 童年的荡秋千', startTime: 0, endTime: 4 },
            ]),
            [{ word: '小黄花', color: RED }, { word: '荡秋千', color: GREEN }],
        );

        expect(colors.length).toBeGreaterThan(1);
        expect(colors.map(entry => entry.color)).toContain(RED);
        expect(colors.map(entry => entry.color)).toContain(GREEN);
        expect(colors.some(entry => entry.color === FALLBACK)).toBe(true);
    });

    /** 烘上去的切分退化成「整行一个词」时同样要切开，不能又回到整行一个 token。 */
    it('splits a line whose baked segmentation is one segment for the whole line', () => {
        const text = '故事的小黄花 童年的荡秋千';
        const colors = pieceColors(
            lineOf(text, [], { autoWordSegments: [text] }),
            [{ word: '小黄花', color: RED }, { word: '荡秋千', color: GREEN }],
        );

        expect(colors.map(entry => entry.color)).toContain(RED);
        expect(colors.map(entry => entry.color)).toContain(GREEN);
        expect(colors.some(entry => entry.color === FALLBACK)).toBe(true);
    });
});
