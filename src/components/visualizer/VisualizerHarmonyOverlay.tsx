import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, type MotionValue, useMotionValueEvent, useTransform } from 'framer-motion';
import type { Line, LyricBackgroundVocal, SubtitleContentMode, Theme, Word } from '../../types';
import { resolveThemeFontStack, resolveThemeFontWeight, resolveThemeTranslationFontStack } from '../../utils/fontStacks';
import { buildLineGraphemeTimeline } from '../../utils/lyrics/graphemeTiming';
import { measureMonetGraphemeOffsets, resolveClampFontPx } from './monet/monetLyricsModel';
import { colorWithAlpha } from '../../utils/visualizer/colorMix';
import { resolveWordColor } from './wordColoring';
import {
    HarmonyOverlayRenderer,
    resolveHarmonyCanvasHeight,
} from './harmonyOverlayWebgl';
import {
    buildHarmonyColorRuns,
    layoutHarmonyText,
    resolveHarmonySweepWidth,
} from './harmonyOverlaySweep';
import {
    getLyricsBackgroundVocals,
    resolveHarmonyAlternateText,
    resolveHarmonySnapshotFromVocals,
    type HarmonySnapshot,
} from './harmonyRuntime';

// src/components/visualizer/VisualizerHarmonyOverlay.tsx
// Renders TTML background vocals in one shared top safe-area without changing mode-specific main lyrics.

interface VisualizerHarmonyOverlayProps {
    currentTime: MotionValue<number>;
    lines: Line[];
    showText: boolean;
    theme: Theme;
    subtitleTheme?: Theme;
    isPlayerChromeHidden?: boolean;
    hideTranslationSubtitle?: boolean;
    showSubtitleTranslation?: boolean;
    subtitleContentMode?: SubtitleContentMode;
    showHarmonySubtitle?: boolean;
    harmonySubtitleBackground?: boolean;
    subtitleFontScale?: number;
}

const EMPTY_HARMONY_SNAPSHOT: HarmonySnapshot = { signature: '', lines: [] };

/** How far below the stage's top the harmony line sits, in the stage's pixels. */
export const HARMONY_TOP_PX = 76;

/**
 * Where the harmony line sits instead. A preview that crops the stage's top (VisPlaygroundSampleStage)
 * moves it so the line keeps its distance below the box's top; elsewhere it stays HARMONY_TOP_PX.
 */
export const HarmonyTopContext = createContext(HARMONY_TOP_PX);

interface HarmonyTextPart {
    key: string;
    text: string;
    word?: Word;
}

// Preserves punctuation and whitespace while letting each timed word own its color and sweep.
const buildHarmonyTextParts = (vocal: LyricBackgroundVocal): HarmonyTextPart[] => {
    const parts: HarmonyTextPart[] = [];
    let cursor = 0;

    vocal.words.forEach((word, index) => {
        const matchIndex = vocal.text.indexOf(word.text, cursor);
        if (matchIndex < 0) {
            return;
        }
        if (matchIndex > cursor) {
            parts.push({ key: `static-${cursor}`, text: vocal.text.slice(cursor, matchIndex) });
        }
        parts.push({ key: `word-${index}-${word.startTime}`, text: word.text, word });
        cursor = matchIndex + word.text.length;
    });

    if (cursor < vocal.text.length) {
        parts.push({ key: `static-${cursor}`, text: vocal.text.slice(cursor) });
    }

    return parts.length > 0 ? parts : [{ key: 'full', text: vocal.text }];
};

const createHarmonyLine = (vocal: LyricBackgroundVocal): Line => ({
    fullText: vocal.text,
    startTime: vocal.startTime,
    endTime: vocal.endTime,
    words: vocal.words,
});

/**
 * GPU 版的一行和声。
 *
 * 每帧做的事：`currentTime` 推出「唱到第几像素」，写进 uniform，画一个四边形 —— 一次 draw call，
 * 不动任何 DOM 样式。原来的 DOM 版要每帧重建一条 `mask-image` 渐变，那正好是它在安卓 WebView
 * 上掉帧的原因。
 *
 * 拿不到 webgl2（或渲染器初始化失败）时整块退回 DOM 版：GPU 这边只是更快，不是唯一画法。
 *
 * 画循环那个 effect 故意不依赖歌词 / 字号 / 主题：一张画布上的 webgl2 上下文建好之后不能拆了
 * 重建 —— `release()` 里有一次 `loseContext()`，同一个 canvas 再 `getContext('webgl2')` 拿回来的
 * 是那个已经丢掉的上下文，之后每次 draw 都是空操作，画布就白了。所以这些输入走 ref 喂给循环；
 * 换歌词时组件本来就跟着外层的 key 一起重挂，用不着靠重跑 effect 来换。
 */
const HarmonyGlText: React.FC<{
    vocal: LyricBackgroundVocal;
    currentTime: MotionValue<number>;
    theme: Theme;
    subtitleFontScale: number;
}> = ({ vocal, currentTime, theme, subtitleFontScale }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [fallback, setFallback] = useState(false);
    /**
     * 画布尺寸由 ResizeObserver 喂进来。
     *
     * 不能在每帧的 rAF 里读 clientWidth/clientHeight：那会强制浏览器同步布局，正好是我们想甩掉
     * 的那类开销。转屏、面板收起这些才会变化尺寸，交给 observer 就好。
     */
    const sizeRef = useRef({ width: 0, height: 0 });
    const fontPx = resolveClampFontPx(0.95, 1.8, 1.3) * subtitleFontScale;
    const fontSpec = `${resolveThemeFontWeight(theme, 500)} ${fontPx}px ${resolveThemeFontStack(theme)}`;
    const graphemeTimings = useMemo(() => buildLineGraphemeTimeline(createHarmonyLine(vocal)), [vocal]);
    const graphemeOffsets = useMemo(
        () => measureMonetGraphemeOffsets(vocal.text, fontPx, fontSpec),
        [fontPx, fontSpec, vocal.text],
    );
    const runs = useMemo(() => buildHarmonyColorRuns(vocal, theme), [theme, vocal]);

    // 每帧要读的输入放在 ref 里：字号 / 主题色 / 歌词换了只决定下一帧画什么，不该把整条 GL 管道
    // 拆掉重来。
    const frameInputRef = useRef({
        vocal,
        currentTime,
        theme,
        fontPx,
        fontSpec,
        graphemeTimings,
        graphemeOffsets,
        runs,
    });
    useEffect(() => {
        frameInputRef.current = {
            vocal,
            currentTime,
            theme,
            fontPx,
            fontSpec,
            graphemeTimings,
            graphemeOffsets,
            runs,
        };
    });

    /**
     * 第一次画之前先把高度占住。
     *
     * canvas 自带 300×150 的固有比例，`w-full` 时能先撑出两三百 px 高，等 rAF 算出行数再压回去 ——
     * 整块和声（含下面那行副标题）就会跳一下，看起来像在闪。这里在 paint 之前读一次宽度把高度
     * 定下来；读布局是要付代价的，但整个组件生命周期里只有这一次。
     */
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || sizeRef.current.height > 0) return;
        const width = canvas.clientWidth;
        if (width <= 0) return;
        const layout = layoutHarmonyText(vocal.text, runs, fontPx, fontSpec, width);
        const height = resolveHarmonyCanvasHeight(layout);
        if (height <= 0) return;
        canvas.style.height = `${height}px`;
        sizeRef.current = { width, height };
    }, [fontPx, fontSpec, runs, vocal.text]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        // 布局必须按「宽度 + 字号」缓存：渲染器靠「layout 是不是同一个对象」判断要不要重烘纹理，
        // 每帧新建一个对象就等于每帧上传一次字形纹理 —— 那就比 DOM 版还慢了。
        const layoutCache = new Map<string, ReturnType<typeof layoutHarmonyText>>();
        let renderer: HarmonyOverlayRenderer | null = null;
        let frame = 0;
        let cancelled = false;
        let contextLost = false;

        const ensureRenderer = (): boolean => {
            if (renderer?.isReady) return true;
            let created: HarmonyOverlayRenderer;
            try {
                created = new HarmonyOverlayRenderer(canvas);
            } catch (error) {
                console.warn('[harmony] WebGL2 unavailable, keeping the DOM path', error);
                renderer = null;
                setFallback(true);
                return false;
            }
            if (!created.isReady) {
                created.release();
                renderer = null;
                setFallback(true);
                return false;
            }
            renderer = created;
            return true;
        };

        const render = () => {
            if (cancelled) return;
            frame = window.requestAnimationFrame(render);
            // 上下文被系统收走时既不画也不重建：重建要等 restored，抢在前面只会拿到一个死上下文。
            if (contextLost) return;
            if (!renderer && !ensureRenderer()) return;

            const input = frameInputRef.current;
            const { width: cssWidth, height: cssHeight } = sizeRef.current;
            // observer 还没喂尺寸就先等一帧：布局要跟着真实宽度排。
            if (cssWidth <= 0 || cssHeight <= 0) return;
            const layoutKey = `${Math.round(cssWidth)}|${input.fontSpec}`;
            let layout = layoutCache.get(layoutKey);
            if (!layout) {
                layout = layoutHarmonyText(input.vocal.text, input.runs, input.fontPx, input.fontSpec, cssWidth);
                layoutCache.set(layoutKey, layout);
            }
            // 画布自己撑到该有的高度：行数变了才重写这个样式，不是每帧都写。
            const canvasHeight = resolveHarmonyCanvasHeight(layout);
            // 写样式不会强制同步布局（读才会），而且只有行数变了才写。
            if (canvasHeight > 0 && Math.round(cssHeight) !== Math.round(canvasHeight)) {
                canvas.style.height = `${canvasHeight}px`;
                sizeRef.current = { width: cssWidth, height: canvasHeight };
            }
            try {
                renderer?.draw({
                    cssWidth,
                    cssHeight,
                    dpr: Math.min(window.devicePixelRatio || 1, 2.5),
                    progressPx: resolveHarmonySweepWidth(
                        input.vocal,
                        input.graphemeTimings,
                        input.graphemeOffsets,
                        input.currentTime.get(),
                    ),
                    softnessPx: input.fontPx * 0.45,
                    opacity: 1,
                    layout,
                    fontSpec: input.fontSpec,
                    idleAlpha: 0.56,
                    // 衬底那圈柔光继续由外层 DOM 那一个元素负责：它是整块一个椭圆，不是每行
                    // 一个，而且是静态的，不参与每帧。
                    drawBackground: false,
                    backgroundColor: input.theme.backgroundColor,
                });
            } catch (error) {
                // 画坏了也不能让歌词消失：交给 DOM 版重画。
                console.warn('[harmony] draw failed, falling back to DOM', error);
                cancelled = true;
                window.cancelAnimationFrame(frame);
                renderer?.release();
                renderer = null;
                setFallback(true);
            }
        };

        // 安卓 WebView 会自己回收 webgl 上下文（内存紧、同一页的 WebGL 画布太多都会）。丢了之后
        // 继续画就是一块空白，而恢复之后 program 和纹理全没了 —— 两边都得接住，否则这一句和声
        // 就是一亮一灭地闪。
        const onContextLost = (event: Event) => {
            event.preventDefault();
            contextLost = true;
            renderer?.dispose();
            renderer = null;
        };
        const onContextRestored = () => {
            contextLost = false;
            // 纹理已经跟着上下文没了，重烘一遍。
            layoutCache.clear();
            renderer = null;
        };
        canvas.addEventListener('webglcontextlost', onContextLost);
        canvas.addEventListener('webglcontextrestored', onContextRestored);

        if (typeof ResizeObserver === 'undefined') {
            // 没有 observer 就没有尺寸来源，别留一块白画布：DOM 版自己按 CSS 撑开。
            canvas.removeEventListener('webglcontextlost', onContextLost);
            canvas.removeEventListener('webglcontextrestored', onContextRestored);
            setFallback(true);
            return undefined;
        }
        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            sizeRef.current = { width: entry.contentRect.width, height: entry.contentRect.height };
        });
        observer.observe(canvas);

        if (!ensureRenderer()) {
            canvas.removeEventListener('webglcontextlost', onContextLost);
            canvas.removeEventListener('webglcontextrestored', onContextRestored);
            observer.disconnect();
            return undefined;
        }
        frame = window.requestAnimationFrame(render);

        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame);
            canvas.removeEventListener('webglcontextlost', onContextLost);
            canvas.removeEventListener('webglcontextrestored', onContextRestored);
            observer.disconnect();
            layoutCache.clear();
            renderer?.release();
            renderer = null;
        };
    }, []);

    if (fallback) {
        return <HarmonyGlowText vocal={vocal} currentTime={currentTime} theme={theme} subtitleFontScale={subtitleFontScale} />;
    }

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="pointer-events-none block w-full"
        />
    );
};

const HarmonyGlowText: React.FC<{
    vocal: LyricBackgroundVocal;
    currentTime: MotionValue<number>;
    theme: Theme;
    subtitleFontScale: number;
}> = ({ vocal, currentTime, theme, subtitleFontScale }) => {
    const fontPx = resolveClampFontPx(0.95, 1.8, 1.3) * subtitleFontScale;
    const fontWeight = resolveThemeFontWeight(theme, 500);
    const fontFamily = resolveThemeFontStack(theme);
    const fontSpec = `${fontWeight} ${fontPx}px ${fontFamily}`;
    const parts = useMemo(() => buildHarmonyTextParts(vocal), [vocal]);
    const graphemeTimings = useMemo(() => buildLineGraphemeTimeline(createHarmonyLine(vocal)), [vocal]);
    const graphemeOffsets = useMemo(
        () => measureMonetGraphemeOffsets(vocal.text, fontPx, fontSpec),
        [fontPx, fontSpec, vocal.text],
    );
    // 与 GPU 版共用同一个推进算法：切到 GPU 那条路时字的位置必须一模一样，不然会看到跳一下。
    const fillWidth = useTransform(
        currentTime,
        latest => resolveHarmonySweepWidth(vocal, graphemeTimings, graphemeOffsets, latest),
    );
    const glowPaddingPx = Math.round(Math.max(fontPx * 0.85, 16));
    const paddedMaskImage = useTransform(fillWidth, latest => {
        const softness = Math.max(Math.min(fontPx * 1.35, 36), 18);
        const edge = latest + glowPaddingPx;
        const solidEnd = Math.max(edge - softness, 0);
        return `linear-gradient(90deg, #000 0px, #000 ${solidEnd}px, rgba(0,0,0,0.86) ${Math.max(solidEnd, edge - softness * 0.5)}px, transparent ${edge}px, transparent 100%)`;
    });
    const renderParts = (active: boolean) => parts.map(part => {
        const color = part.word
            ? resolveWordColor(part.word.text, theme.wordColors, theme.accentColor, { cjkMatchMode: 'exact' })
            : theme.secondaryColor;
        return (
            <span
                key={part.key}
                style={active
                    ? {
                        color,
                        WebkitTextFillColor: color,
                    }
                    : { color: colorWithAlpha(color, 0.56) }}
            >
                {part.text}
            </span>
        );
    });

    return (
        <span
            className="relative inline-block overflow-visible whitespace-pre-wrap break-words"
            style={{ fontFamily, fontSize: `clamp(${(0.95 * subtitleFontScale).toFixed(3)}rem, ${(1.8 * subtitleFontScale).toFixed(3)}vw, ${(1.3 * subtitleFontScale).toFixed(3)}rem)`, fontWeight, lineHeight: 1.3 }}
        >
            {renderParts(false)}
            <motion.span
                aria-hidden
                // 逐字扫光的叠加层（CPU 回退版）：扁平档保留它自己的词色，见 index.css 的 [data-folia-lyric-sweep] 段。
                data-folia-lyric-sweep="1"
                className="pointer-events-none absolute block whitespace-pre-wrap"
                style={{
                    left: -glowPaddingPx,
                    right: -glowPaddingPx,
                    top: -glowPaddingPx,
                    padding: glowPaddingPx,
                    WebkitMaskImage: paddedMaskImage,
                    maskImage: paddedMaskImage,
                    WebkitMaskSize: '100% 100%',
                    maskSize: '100% 100%',
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                }}
            >
                <span className="block whitespace-pre-wrap break-words">{renderParts(true)}</span>
            </motion.span>
        </span>
    );
};

const VisualizerHarmonyOverlay: React.FC<VisualizerHarmonyOverlayProps> = ({
    currentTime,
    lines,
    showText,
    theme,
    subtitleTheme,
    isPlayerChromeHidden = false,
    hideTranslationSubtitle = false,
    showSubtitleTranslation = true,
    subtitleContentMode,
    showHarmonySubtitle = true,
    harmonySubtitleBackground = true,
    subtitleFontScale = 1,
}) => {
    const backgroundVocals = useMemo(() => getLyricsBackgroundVocals(lines), [lines]);
    const buildSnapshot = useCallback(
        (time: number) => showText && showHarmonySubtitle
            ? resolveHarmonySnapshotFromVocals(backgroundVocals, time)
            : EMPTY_HARMONY_SNAPSHOT,
        [backgroundVocals, showHarmonySubtitle, showText],
    );
    const initialSnapshot = buildSnapshot(currentTime.get());
    const [snapshot, setSnapshot] = useState<HarmonySnapshot>(initialSnapshot);
    const signatureRef = useRef(initialSnapshot.signature);

    const updateSnapshot = useCallback((time: number) => {
        const next = buildSnapshot(time);
        if (signatureRef.current === next.signature) {
            return;
        }
        signatureRef.current = next.signature;
        setSnapshot(next);
    }, [buildSnapshot]);

    useEffect(() => {
        updateSnapshot(currentTime.get());
    }, [currentTime, updateSnapshot]);

    useMotionValueEvent(currentTime, 'change', updateSnapshot);
    const harmonyTopPx = useContext(HarmonyTopContext);

    return (
        <AnimatePresence>
            {snapshot.lines.length > 0 && (
                <motion.div
                    key="visualizer-harmony-overlay"
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{
                        opacity: { duration: 0.2, ease: 'easeOut' },
                        y: { duration: 0.2, ease: 'easeOut' },
                    }}
                    className="pointer-events-none absolute left-0 right-0 z-30 flex flex-col items-center gap-1.5 px-5 text-center"
                    style={{ top: harmonyTopPx }}
                >
                    <div
                        className={`relative isolate flex max-w-full flex-col items-center gap-1.5 ${harmonySubtitleBackground ? 'px-4 py-2' : ''}`}
                    >
                    {harmonySubtitleBackground && (
                        // Keep the glow out of the masked text's negative/filter compositing path on iOS Safari.
                        <div
                            aria-hidden="true"
                            className="pointer-events-none absolute -inset-x-10 -inset-y-6 z-0 blur-2xl"
                            style={{
                                background: `radial-gradient(ellipse at center, ${colorWithAlpha(theme.backgroundColor, 0.7)} 0%, ${colorWithAlpha(theme.backgroundColor, 0.42)} 48%, transparent 78%)`,
                                transform: 'translateZ(0)',
                                WebkitTransform: 'translateZ(0)',
                                WebkitBackfaceVisibility: 'hidden',
                            }}
                        />
                    )}
                    {snapshot.lines.map(entry => {
                        const alternateText = hideTranslationSubtitle
                            ? null
                            : resolveHarmonyAlternateText(
                                entry.vocal,
                                subtitleContentMode,
                                showSubtitleTranslation,
                            );

                        return (
                            <motion.div
                            key={entry.key}
                            initial={{ opacity: 0, scale: 0.97 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.97 }}
                            className="relative z-10 max-w-4xl overflow-visible whitespace-pre-wrap break-words"
                        >
                            <HarmonyGlText
                                vocal={entry.vocal}
                                currentTime={currentTime}
                                theme={subtitleTheme ?? theme}
                                subtitleFontScale={subtitleFontScale}
                            />
                            {alternateText && (
                                <motion.div
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 0.82, y: 0 }}
                                    className="mt-0.5"
                                    style={{
                                        color: (subtitleTheme ?? theme).secondaryColor,
                                        fontFamily: resolveThemeTranslationFontStack(subtitleTheme ?? theme),
                                        fontSize: `clamp(${(0.72 * subtitleFontScale).toFixed(3)}rem, ${(1.2 * subtitleFontScale).toFixed(3)}vw, ${(0.9 * subtitleFontScale).toFixed(3)}rem)`,
                                        fontWeight: resolveThemeFontWeight(subtitleTheme ?? theme, 400),
                                        lineHeight: 1.3,
                                    }}
                                >
                                    {alternateText}
                                </motion.div>
                            )}
                        </motion.div>
                        );
                    })}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default VisualizerHarmonyOverlay;
