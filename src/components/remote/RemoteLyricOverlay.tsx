import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { PlayerState, type Line, type LyricData } from '../../types';
import { findLatestActiveLineIndex } from '../../utils/appPlaybackHelpers';
import { useLyricFlatSettingsStore } from '../../stores/useLyricFlatSettingsStore';

// src/components/remote/RemoteLyricOverlay.tsx
// Renders remote-window lyrics while keeping continuous playback progress out of React state.
type RemoteLyricOverlayProps = {
    lyrics: LyricData | null | undefined;
    currentTime: number;
    duration: number;
    playerState: PlayerState;
    hasTrack: boolean;
    visible: boolean;
    baseColor: string;
    activeColor: string;
};

type RemoteLyricDisplay = {
    currentLine: Line | null;
    nextLine: Line | null;
};

const EMPTY_DISPLAY: RemoteLyricDisplay = {
    currentLine: null,
    nextLine: null,
};

const clampProgress = (value: number) => Math.max(0, Math.min(100, value));

const getInterpolatedTime = (
    playerState: PlayerState,
    duration: number,
    sync: { snapshotTime: number; localTime: number },
) => {
    if (playerState !== PlayerState.PLAYING) {
        return sync.snapshotTime;
    }

    const elapsed = (performance.now() - sync.localTime) / 1000;
    const upperBound = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
    return Math.min(upperBound, sync.snapshotTime + elapsed);
};

const resolveDisplay = (lyrics: LyricData | null | undefined, time: number): RemoteLyricDisplay => {
    if (!lyrics?.lines.length) {
        return EMPTY_DISPLAY;
    }

    const index = findLatestActiveLineIndex(lyrics.lines, time);
    if (index !== -1) {
        return {
            currentLine: lyrics.lines[index] ?? null,
            nextLine: lyrics.lines[index + 1] ?? null,
        };
    }

    const upcomingIndex = lyrics.lines.findIndex(line => line.startTime > time);
    const previousIndex = upcomingIndex === -1 ? lyrics.lines.length - 1 : upcomingIndex - 1;
    return {
        currentLine: previousIndex >= 0 ? lyrics.lines[previousIndex] ?? null : null,
        nextLine: upcomingIndex === -1 ? null : lyrics.lines[upcomingIndex] ?? null,
    };
};

const getLineKey = (line: Line | null) => (
    line ? `${line.startTime}-${line.endTime}-${line.fullText}` : 'empty'
);

const buildGradient = (activeColor: string, baseColor: string, progress: number) => (
    `linear-gradient(to right, ${activeColor} ${progress}%, ${baseColor} ${progress}%)`
);

const RemoteLyricOverlay: React.FC<RemoteLyricOverlayProps> = ({
    lyrics,
    currentTime,
    duration,
    playerState,
    hasTrack,
    visible,
    baseColor,
    activeColor,
}) => {
    const { t } = useTranslation();
    /*
     * 「歌词改为纯色扁平」开关。
     *
     * 这里**自己**读、自己渲染纯色，而不是只指望 index.css 里那条全局覆盖：
     * 那条覆盖是给主界面十几种可视化渲染器准备的，它把渐变压掉之后填的是
     * `var(--text-primary, currentColor)` —— 而遥控窗口拿不到主窗口那份动态主题变量，
     * 填出来的颜色不一定读得清（扁平之后反而更糊）。整句纯色这件事这里本来就能直接做到。
     */
    const flatLyrics = useLyricFlatSettingsStore(state => state.flatLyrics);
    const [display, setDisplay] = useState<RemoteLyricDisplay>(() => resolveDisplay(lyrics, currentTime));
    const syncRef = useRef({ snapshotTime: currentTime, localTime: performance.now() });
    const displayRef = useRef(display);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const wordRefs = useRef<HTMLElement[]>([]);
    const singleLineRef = useRef<HTMLSpanElement | null>(null);
    const wordCentersRef = useRef<number[]>([]);
    const scrollMetricsRef = useRef({ containerWidth: 0, maxScroll: 0 });
    const targetScrollRef = useRef<number>(0);
    const scrollAnimationRef = useRef<number | null>(null);

    useEffect(() => {
        displayRef.current = display;
    }, [display]);

    const currentLine = display.currentLine;
    const nextLine = display.nextLine;
    const hasLyrics = Boolean(lyrics?.lines.length);
    const lineKey = getLineKey(currentLine);

    const words = useMemo(() => currentLine?.words ?? [], [currentLine]);

    const measureScrollTargets = useCallback(() => {
        const container = containerRef.current;
        if (!container) {
            wordCentersRef.current = [];
            scrollMetricsRef.current = { containerWidth: 0, maxScroll: 0 };
            return;
        }

        const containerWidth = container.clientWidth;
        const maxScroll = Math.max(0, container.scrollWidth - containerWidth);
        scrollMetricsRef.current = { containerWidth, maxScroll };
        wordCentersRef.current = wordRefs.current.map(child => child.offsetLeft + child.offsetWidth / 2);

        if (maxScroll <= 0) {
            container.scrollLeft = 0;
        }
    }, []);

    const updateLineProgress = useCallback((time: number) => {
        // 扁平模式整句就是一个纯色，没有"唱到哪个字"这回事。
        if (flatLyrics) {
            return;
        }
        const line = displayRef.current.currentLine;
        if (!line) {
            return;
        }

        if (line.words?.length) {
            line.words.forEach((word, index) => {
                const node = wordRefs.current[index];
                if (!node) {
                    return;
                }

                const progress = word.endTime > word.startTime
                    ? clampProgress(((time - word.startTime) / (word.endTime - word.startTime)) * 100)
                    : (time >= word.startTime ? 100 : 0);
                node.style.backgroundImage = buildGradient(activeColor, baseColor, progress);
            });
            return;
        }

        if (singleLineRef.current) {
            const progress = line.endTime > line.startTime
                ? clampProgress(((time - line.startTime) / (line.endTime - line.startTime)) * 100)
                : (time >= line.startTime ? 100 : 0);
            singleLineRef.current.style.backgroundImage = buildGradient(activeColor, baseColor, progress);
        }
    }, [activeColor, baseColor, flatLyrics]);

    const completeCurrentLineProgress = useCallback(() => {
        if (flatLyrics) {
            return;
        }
        const line = displayRef.current.currentLine;
        if (!line) {
            return;
        }

        if (line.words?.length) {
            line.words.forEach((_, index) => {
                const node = wordRefs.current[index];
                if (node) {
                    node.style.backgroundImage = buildGradient(activeColor, baseColor, 100);
                }
            });
            return;
        }

        if (singleLineRef.current) {
            singleLineRef.current.style.backgroundImage = buildGradient(activeColor, baseColor, 100);
        }
    }, [activeColor, baseColor, flatLyrics]);

    const animateScroll = useCallback(() => {
        const container = containerRef.current;
        if (!container) {
            scrollAnimationRef.current = null;
            return;
        }
        const { maxScroll } = scrollMetricsRef.current;
        if (maxScroll <= 0) {
            container.scrollLeft = 0;
            scrollAnimationRef.current = null;
            return;
        }

        const diff = targetScrollRef.current - container.scrollLeft;
        if (Math.abs(diff) > 0.5) {
            container.scrollLeft += diff * 0.14;
            scrollAnimationRef.current = requestAnimationFrame(animateScroll);
        } else {
            container.scrollLeft = targetScrollRef.current;
            scrollAnimationRef.current = null;
        }
    }, []);

    const updateScroll = useCallback((time: number) => {
        const container = containerRef.current;
        const line = displayRef.current.currentLine;
        const { containerWidth, maxScroll } = scrollMetricsRef.current;
        if (!container || !line || maxScroll <= 0) {
            return;
        }

        let targetScroll = maxScroll;
        if (line.words?.length) {
            const activeIndex = line.words.findIndex(word => time >= word.startTime && time <= word.endTime);
            if (activeIndex !== -1) {
                targetScroll = (wordCentersRef.current[activeIndex] ?? 0) - containerWidth / 2;
            } else if (time < line.words[0].startTime) {
                targetScroll = 0;
            }
        } else if (time >= line.startTime && time <= line.endTime && line.endTime > line.startTime) {
            targetScroll = ((time - line.startTime) / (line.endTime - line.startTime)) * maxScroll;
        } else if (time < line.startTime) {
            targetScroll = 0;
        }

        const boundedTarget = Math.max(0, Math.min(maxScroll, targetScroll));
        targetScrollRef.current = boundedTarget;

        if (playerState === PlayerState.PLAYING) {
            container.scrollLeft += (boundedTarget - container.scrollLeft) * 0.14;
        } else {
            if (!scrollAnimationRef.current) {
                scrollAnimationRef.current = requestAnimationFrame(animateScroll);
            }
        }
    }, [playerState, animateScroll]);

    const updateDisplay = useCallback((time: number) => {
        const nextDisplay = resolveDisplay(lyrics, time);
        const previous = displayRef.current;
        if (
            previous.currentLine === nextDisplay.currentLine &&
            previous.nextLine === nextDisplay.nextLine
        ) {
            return;
        }

        if (
            previous.currentLine &&
            previous.currentLine !== nextDisplay.currentLine &&
            time >= previous.currentLine.endTime
        ) {
            completeCurrentLineProgress();
        }

        displayRef.current = nextDisplay;
        setDisplay(nextDisplay);
    }, [completeCurrentLineProgress, lyrics]);

    const setContainerRef = useCallback((node: HTMLDivElement | null) => {
        containerRef.current = node;
        if (node) {
            if (wordRefs.current.length > words.length) {
                wordRefs.current.length = words.length;
            }
            requestAnimationFrame(() => {
                measureScrollTargets();
                const time = getInterpolatedTime(playerState, duration, syncRef.current);
                updateLineProgress(time);
                updateScroll(time);
            });
        }
    }, [measureScrollTargets, playerState, duration, updateLineProgress, updateScroll, words.length]);

    useEffect(() => {
        syncRef.current = { snapshotTime: currentTime, localTime: performance.now() };
        const time = getInterpolatedTime(playerState, duration, syncRef.current);
        updateDisplay(time);
        updateLineProgress(time);
        updateScroll(time);
    }, [currentTime, duration, playerState, updateDisplay, updateLineProgress, updateScroll]);

    useEffect(() => {
        return () => {
            if (scrollAnimationRef.current) {
                cancelAnimationFrame(scrollAnimationRef.current);
            }
        };
    }, []);

    useEffect(() => {
        window.addEventListener('resize', measureScrollTargets);
        return () => window.removeEventListener('resize', measureScrollTargets);
    }, [measureScrollTargets]);

    useEffect(() => {
        if (!visible || !lyrics?.lines.length) {
            return;
        }

        let frameId = 0;
        const tick = () => {
            const time = getInterpolatedTime(playerState, duration, syncRef.current);
            updateDisplay(time);
            updateLineProgress(time);
            updateScroll(time);

            if (playerState === PlayerState.PLAYING) {
                frameId = requestAnimationFrame(tick);
            }
        };

        frameId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameId);
    }, [duration, lyrics, playerState, updateDisplay, updateLineProgress, updateScroll, visible]);

    /*
     * 文字的画法只有一处不同：
     *  · 正常：背景裁到文字上，逐字把 activeColor 刷过去（updateLineProgress 负责推进）；
     *  · 扁平：整句一个纯色。
     * 扁平时刻意**不写** background-clip —— index.css 里那条全局覆盖只挑"设了它的元素"，
     * 不写就轮不到它来插一脚，颜色完全由这里说了算（那条规则还会把颜色填成
     * 遥控窗口拿不到的 var(--text-primary)，不如自己给）。
     */
    const textPaintStyle = (extra?: React.CSSProperties): React.CSSProperties => (
        flatLyrics
            ? { color: activeColor, display: 'inline-block', ...extra }
            : {
                backgroundImage: buildGradient(activeColor, baseColor, 0),
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                display: 'inline-block',
                ...extra,
            }
    );

    return (
        <motion.div
            key="lyrics-view"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.10 }}
            className="absolute inset-0 flex flex-col justify-center min-w-0"
            /*
             * 扁平歌词的作用域锚点（见 index.css 的
             * `html[data-lyric-flat='1'] [data-folia-lyric-surface]` 段）。
             *
             * 遥控窗口是**另一个 document**：那条规则认的是**本页** <html> 上的
             * `data-lyric-flat`，而它原本只在 store 模块被加载时挂一次 ——
             * 这个窗口的组件树里没人用到那个 store，于是属性从没挂上、规则从没命中，
             * 用户看到的就是「扁平开关对这个窗口无效」。
             * 属性那一半由 RemoteControlApp 的订阅负责（它同时也保证模块被加载）。
             *
             * 文字本身的纯色**不靠**这条 CSS —— 组件自己按 flatLyrics 渲染（见
             * textPaintStyle）：那条全局覆盖填充的是遥控窗口拿不到的
             * `var(--text-primary)`，颜色不一定读得清。标记留着是让"去发光"那一半
             * 也能作用到这一层。
             */
            data-folia-lyric-surface="1"
        >
            {/*
             * 换句**不能**走 AnimatePresence 的 `mode="wait"`。
             *
             * 它的语义是"旧句退场动画播完才挂新句"，于是每一句之间都有一段
             * 两边都不在的空白（0.15s 淡出 + 0.15s 淡入）。一首歌几十句，
             * 用户看到的就是「歌词放着放着突然消失，然后又淡入出现」，
             * 而且频繁到像是"有个定时器在重载"。
             *
             * 现在直接换 key 让 React 就地替换：旧句在同一帧被卸载、新句立刻挂上，
             * 不存在两边都空的那一帧；新句只做一次很轻的淡入当作过渡。
             */}
                <motion.div
                    key={`line-${lineKey}`}
                    initial={{ opacity: 0.35, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="min-w-0"
                >
                    <div
                        ref={setContainerRef}
                        className="w-full overflow-hidden whitespace-nowrap relative text-base font-bold leading-snug select-none"
                    >
                        {currentLine ? (
                            words.length > 0 ? (
                                words.map((word, index) => (
                                    <span
                                        key={`${word.startTime}-${word.endTime}-${index}`}
                                        ref={node => {
                                            if (node) {
                                                wordRefs.current[index] = node;
                                            }
                                        }}
                                        style={textPaintStyle({ marginRight: '0.25em' })}
                                    >
                                        {word.text}
                                    </span>
                                ))
                            ) : (
                                <span
                                    ref={singleLineRef}
                                    style={textPaintStyle()}
                                >
                                    {currentLine.fullText}
                                </span>
                            )
                        ) : (
                            <span style={{ color: baseColor }}>
                                {hasTrack && !hasLyrics ? t('remote.noLyrics') : ''}
                            </span>
                        )}
                    </div>
                </motion.div>
            {/* 下一句同理：`mode="wait"` 会让它跟当前句一样在换句的瞬间整块消失。 */}
                <motion.div
                    key={`next-${nextLine?.startTime ?? 'none'}-${nextLine?.fullText ?? ''}`}
                    initial={{ opacity: 0.35, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="truncate text-[11px] font-medium leading-none mt-1.5"
                    style={{ color: baseColor }}
                >
                    {nextLine?.fullText ?? ''}
                </motion.div>
        </motion.div>
    );
};

export default RemoteLyricOverlay;
