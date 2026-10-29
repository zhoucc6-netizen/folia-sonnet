import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { PlayerState } from '../../types';
import { idleVideoExportState } from '../../types/videoExport';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import {
    syncLyricFlatAttribute,
    useLyricFlatSettingsStore,
} from '../../stores/useLyricFlatSettingsStore';
import RemoteCardSurface, { type RemoteBackgroundMode } from './RemoteCardSurface';
import RemoteCoverTile from './RemoteCoverTile';
import RemoteLyricOverlay from './RemoteLyricOverlay';
import RemotePresetSelector from './RemotePresetSelector';
import RemoteProgressSlider from './RemoteProgressSlider';
import RemoteTitlebarTools from './RemoteTitlebarTools';
import RemoteTrackHeading from './RemoteTrackHeading';
import RemoteTransparentControls from './RemoteTransparentControls';
import RemoteTransportBar from './RemoteTransportBar';
import RemoteVideoExportPanel from './RemoteVideoExportPanel';
import { shouldRevealRemoteTitlebar } from './remoteTitlebarReveal';
import {
    REMOTE_NO_DRAG_STYLE,
    sendRemoteCommand,
    useRemoteSnapshot,
    useRemoteWindowPresentation,
} from './remoteWindowBridge';
import { useRemoteCoverArt } from './useRemoteCoverArt';
import { useRemoteExportDraft } from './useRemoteExportDraft';
import { useRemoteIdle } from './useRemoteIdle';
import { useRemoteSleeve } from './useRemoteSleeve';
import { useRemoteTrackHandoff } from './useRemoteTrackHandoff';

// src/components/remote/RemoteControlApp.tsx
// Electron-only companion window for controlling the single real player instance.
// 这个文件只做编排：把主进程推来的快照、窗口自己的几个开关、指针在不在窗口里这几件事
// 合成「卡片现在该是什么样子」，再把具体的块（背景 / 封面 / 标题 / 进度 / 控制 / 面板）
// 拼起来。每一块在它自己的文件里。
//
// 两种样子：指针在窗口里时是控制行；离开一会儿后控制行让位给歌词，若设置里的
// 「展开封面」开着，卡片底下还会把封面整张铺开（见 RemoteCardSurface）。

const REMOTE_CONTROL_DOCUMENT_TITLE = 'Folia Remote';
const REMOTE_BACKGROUND_MODE_STORAGE_KEY = 'remote_background_mode';

type RemotePanelMode = 'playback' | 'export' | 'transparent-controls';

const SWITCH_PANEL_TRANSITION = { duration: 0.15 } as const;

const readStoredBackgroundMode = (): RemoteBackgroundMode => {
    if (typeof window !== 'undefined') {
        const stored = window.localStorage.getItem(REMOTE_BACKGROUND_MODE_STORAGE_KEY);
        if (stored === 'cover' || stored === 'transparent' || stored === 'default') {
            return stored;
        }
    }
    return 'default';
};

const RemoteControlApp: React.FC = () => {
    const { t } = useTranslation();
    const reduceMotion = useReducedMotionFor('uiMicroMotion');
    const snapshot = useRemoteSnapshot();
    const presentation = useRemoteWindowPresentation();
    const draft = useRemoteExportDraft();

    const [backgroundMode, setBackgroundMode] = useState<RemoteBackgroundMode>(readStoredBackgroundMode);
    const [pendingSeek, setPendingSeek] = useState<number | null>(null);
    const [activePanel, setActivePanel] = useState<RemotePanelMode>('playback');
    const [windowControlsRevealed, setWindowControlsRevealed] = useState(false);
    const [hoverNavSide, setHoverNavSide] = useState<'prev' | 'next' | null>(null);

    const isDraggingRef = useRef(false);
    const lastSeekTimeRef = useRef(0);
    const cardRef = useRef<HTMLDivElement | null>(null);

    /*
     * 扁平歌词的开关。
     *
     * 遥控窗口是**另一个 document**（BrowserWindow），用户在主窗口里拨的那个开关
     * 写的是主窗口的 localStorage，而扁平那条 CSS 认的是**本页** <html> 上的
     * `data-lyric-flat` —— 这个窗口必须先加载那个 store，属性才会挂上。
     * 而本窗口的组件树里本来没有任何地方用到它，模块也就从没被加载过，
     * 所以必须在这里显式订阅一次（见下面那个 effect）。
     * 只加载还不够：歌词容器那边还要有 `[data-folia-lyric-surface]` 标记，
     * 两半缺一不可（见 RemoteLyricOverlay）。
     */
    const flatLyrics = useLyricFlatSettingsStore(state => state.flatLyrics);

    useEffect(() => {
        document.body.style.backgroundColor = 'transparent';
        document.documentElement.style.backgroundColor = 'transparent';
        document.body.style.overflow = 'visible';
        document.title = REMOTE_CONTROL_DOCUMENT_TITLE;
    }, []);

    // 把扁平开关挂到本页的 <html> 上（遥控窗口是独立 document，要自己挂一份）。
    useEffect(() => {
        syncLyricFlatAttribute(flatLyrics);
    }, [flatLyrics]);

    useEffect(() => {
        window.localStorage.setItem(REMOTE_BACKGROUND_MODE_STORAGE_KEY, backgroundMode);
    }, [backgroundMode]);

    // A click-through window stops receiving mouse events, so mouseleave may never arrive: drop hover state explicitly.
    useEffect(() => {
        if (presentation.hideTitlebar || presentation.clickThrough) {
            setWindowControlsRevealed(false);
        }
        if (presentation.clickThrough) {
            setHoverNavSide(null);
        }
    }, [presentation]);

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            const nextRevealed = shouldRevealRemoteTitlebar(event.clientY, presentation);
            setWindowControlsRevealed(prev => (prev === nextRevealed ? prev : nextRevealed));
        };
        const handleMouseLeave = () => setWindowControlsRevealed(false);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseleave', handleMouseLeave);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, [presentation]);

    /*
     * 拖动进度条结束后 800ms 内的快照不清掉待跳转的时间。
     *
     * 快照每 500ms 推一次，头几帧带的还是跳转前的进度；一发 seek 就清的话，
     * 进度条会先往回跳一下再追上。原先这段挂在快照订阅里，改用 bridge 的
     * useRemoteSnapshot 之后挪到这里，判据照旧。
     */
    useEffect(() => {
        if (!isDraggingRef.current && Date.now() - lastSeekTimeRef.current > 800) {
            setPendingSeek(null);
        }
    }, [snapshot]);

    const isPlaying = snapshot.playerState === PlayerState.PLAYING;
    const duration = Number.isFinite(snapshot.duration) && snapshot.duration > 0 ? snapshot.duration : 0;
    const progressValue = duration > 0 ? Math.max(0, Math.min(pendingSeek ?? snapshot.currentTime, duration)) : 0;
    const progressPercent = duration > 0 ? (progressValue / duration) * 100 : 0;
    const primaryDisabled = snapshot.controlsDisabled || !snapshot.hasTrack;
    const likeDisabled = primaryDisabled || snapshot.canLike === false;
    const likeUnavailableReason = snapshot.likeUnavailableProvider
        ? t('status.providerLikeUnavailable', { provider: snapshot.likeUnavailableProvider })
        : undefined;
    const title = snapshot.title || 'Folia';
    const artist = snapshot.artist || (snapshot.hasTrack ? 'Unknown artist' : 'No active track');
    const isDaylight = Boolean(snapshot.isDaylight);
    const exportState = snapshot.exportState ?? idleVideoExportState();

    const handoff = useRemoteTrackHandoff({ snapshot, title, artist, isPlaying });

    const { coverColors, getCachedCoverColors } = useRemoteCoverArt({
        backgroundMode,
        trackKey: snapshot.trackKey,
        coverUrl: handoff.currentCoverUrl,
        prevTrackKey: snapshot.prevTrackKey,
        prevTrackCoverUrl: snapshot.prevTrackCoverUrl,
        nextTrackKey: snapshot.nextTrackKey,
        nextTrackCoverUrl: snapshot.nextTrackCoverUrl,
    });

    // 交接过半就把背景换成下一首的配色，剩下的交给背景本身 700ms 的颜色过渡。
    // 取色按曲目标识缓存，换歌那一刻预读结果照样命中，不会先退回上一首的配色。
    const isIncomingBackground = handoff.isHandoffActive && handoff.isIncomingDominant;
    const activeCoverColors = getCachedCoverColors(
        isIncomingBackground ? handoff.incomingTrackKey : snapshot.trackKey,
        isIncomingBackground ? handoff.incomingCoverUrl : handoff.currentCoverUrl,
    ) ?? coverColors;

    const {
        isIdle,
        setHasKeyboardFocus,
    } = useRemoteIdle({
        clickThrough: presentation.clickThrough,
        panelIsPlayback: activePanel === 'playback',
    });

    /*
     * 闲置 + 「展开封面」= 卡片底下铺开一整张封面（没有封面就没什么可展开的）。
     * useRemoteSleeve 只在降低动态效果时出手：那会儿 CSS 过渡被全局关掉，卡片会直接从
     * 一种样子跳到另一种，它就先把整张卡淡出、换完样子再淡入，盖住那一下跳变。
     */
    const isSleeve = useRemoteSleeve(
        isIdle && Boolean(handoff.currentCoverUrl) && presentation.expandCover,
        reduceMotion,
        cardRef,
    );

    // 面板切走后，原来聚焦的那个按钮跟着卸载，blur 不会来；不清的话窗口会一直当作「有人在用」。
    useEffect(() => {
        if (activePanel !== 'playback' && !document.activeElement?.matches(':focus-visible')) {
            setHasKeyboardFocus(false);
        }
    }, [activePanel, setHasKeyboardFocus]);

    const navigateTrack = (direction: 'prev' | 'next') => {
        handoff.recordNavIntent(direction);
        sendRemoteCommand({ type: direction === 'prev' ? 'previous' : 'next' });
    };

    const previewTitle = hoverNavSide === 'prev' && snapshot.canGoPrevious
        ? snapshot.prevTrackTitle
        : hoverNavSide === 'next' && snapshot.canGoNext
            ? snapshot.nextTrackTitle
            : null;

    /*
     * 歌词里「正在唱的那一句」的填充色。
     *
     * 以前直接复用黑白对比色（深色下就是纯白），于是逐字推进看起来就是一条
     * **白色进度条**，而唱完之后那一句归到"已唱"、反而带上颜色 ——
     * 用户报的正是「正在放的那一句渐变进度是纯白的，放完它后面的又变成有颜色的」。
     * 高亮色要的是这首歌的配色，而不是"文字和背景的对比色"：
     * 优先用封面主色（和主窗口背景取的是同一路配色来源），
     * 拿不到封面取色时再退回原来的黑白。
     */
    const activeColor = isDaylight ? '#1c1917' : '#ffffff';
    const lyricAccentColor = activeCoverColors[0] || activeColor;
    /*
     * 歌词里已唱/未唱的底色。封面铺满整卡时歌词压在封面上，
     * 白天那套"黑字"会压在可能很暗的封面上，所以一律走白。
     */
    const lyricBaseColor = isSleeve
        ? 'rgba(255, 255, 255, 0.4)'
        : isDaylight ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.35)';
    const transitionGlowColor = isDaylight ? 'rgba(28, 25, 23, 0.45)' : 'rgba(255, 255, 255, 0.8)';

    const backToPlayback = () => {
        setActivePanel('playback');
        draft.setPresetSelectorOpen(false);
    };

    const lastStatusRef = useRef(exportState.status);
    useEffect(() => {
        if (exportState.status !== 'idle' && lastStatusRef.current === 'idle') {
            setActivePanel('export');
        }
        lastStatusRef.current = exportState.status;
    }, [exportState.status]);

    return (
        <main
            className={`h-screen w-screen bg-transparent p-1 select-none transition-colors duration-300 ${isDaylight ? 'text-zinc-900' : 'text-white'
                }`}
            onFocus={event => setHasKeyboardFocus(event.target.matches(':focus-visible'))}
            onBlur={() => setHasKeyboardFocus(false)}
        >
            <div
                ref={cardRef}
                className={`relative flex h-full w-full rounded-[20px] border p-4 items-center justify-center overflow-hidden transition-colors duration-300 ${backgroundMode === 'transparent' ? 'border-transparent' : (isDaylight ? 'border-black/10' : 'border-white/10')
                    }`}
            >
                <RemoteCardSurface
                    backgroundMode={backgroundMode}
                    isDaylight={isDaylight}
                    coverColors={activeCoverColors}
                    titlebarRevealed={windowControlsRevealed}
                    isSleeve={isSleeve}
                    coverUrl={handoff.currentCoverUrl}
                />

                <RemoteTitlebarTools
                    backgroundMode={backgroundMode}
                    isDaylight={isDaylight}
                    revealed={windowControlsRevealed}
                    onKeepRevealed={() => setWindowControlsRevealed(true)}
                    isSleeve={isSleeve}
                    onCycleBackgroundMode={() => setBackgroundMode(previous => (
                        previous === 'default' ? 'cover' : previous === 'cover' ? 'transparent' : 'default'
                    ))}
                />

                <div className="w-full flex items-center" style={REMOTE_NO_DRAG_STYLE}>
                    {/*
                     * 封面铺满整卡时，左边那一格塌到 0：小封面已经淡出让位，
                     * 塌掉之后右栏的字正好落在整张卡的中间偏左，看着才像压在封面上。
                     * grid-template-columns 可以插值，所以这一下是滑过去而不是跳过去。
                     */}
                    <div
                        className="grid w-full items-center transition-[grid-template-columns,gap] duration-[620ms] ease-out"
                        style={{
                            gridTemplateColumns: isSleeve ? '0px 1fr' : '112px 1fr',
                            gap: isSleeve ? '0px' : '16px',
                        }}
                    >
                        {/* Left Column: Cover Art with Hover Back Overlay */}
                        <RemoteCoverTile
                            isDaylight={isDaylight}
                            coverUrl={handoff.currentCoverUrl}
                            coverFaces={handoff.coverFaces}
                            hasIncomingCoverFace={handoff.hasIncomingCoverFace}
                            isHandoffActive={handoff.isHandoffActive}
                            handoffIncomingOpacity={handoff.handoffIncomingOpacity}
                            handoffOutgoingOpacity={handoff.handoffOutgoingOpacity}
                            trackEnterOffset={handoff.trackEnterOffset}
                            showBack={activePanel !== 'playback'}
                            onBack={backToPlayback}
                            countdown={exportState.status === 'countdown' ? exportState.countdown : null}
                            isSleeve={isSleeve}
                        />

                        {/* Right Column: Track details & controls (Playback or Export) */}
                        <div className="flex flex-col justify-between min-h-[112px] min-w-0">
                            <RemoteTrackHeading
                                isDaylight={isDaylight}
                                isSleeve={isSleeve}
                                faces={handoff.faces}
                                isHandoffActive={handoff.isHandoffActive}
                                handoffIncomingOpacity={handoff.handoffIncomingOpacity}
                                handoffOutgoingOpacity={handoff.handoffOutgoingOpacity}
                                trackEnterOffset={handoff.trackEnterOffset}
                                previewTitle={previewTitle}
                            />

                            {/* Dynamic Panel with Framer Motion transitions */}
                            <div className="relative min-h-[70px] w-full">
                                <AnimatePresence mode="wait">
                                    {activePanel === 'playback' ? (
                                        <motion.div
                                            key="playback-panel"
                                            initial={{ opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -5 }}
                                            transition={SWITCH_PANEL_TRANSITION}
                                            className="w-full flex flex-col justify-between h-[70px]"
                                        >
                                            {/* Progress Slider (Always Visible) */}
                                            <RemoteProgressSlider
                                                isDaylight={isDaylight}
                                                isSleeve={isSleeve}
                                                progressValue={progressValue}
                                                duration={duration}
                                                progressPercent={progressPercent}
                                                isTransitionGlowActive={handoff.isTransitionGlowActive}
                                                glowColor={transitionGlowColor}
                                                disabled={primaryDisabled}
                                                pendingSeek={pendingSeek}
                                                onPendingSeek={setPendingSeek}
                                                isDraggingRef={isDraggingRef}
                                                lastSeekTimeRef={lastSeekTimeRef}
                                            />

                                            {/* Toggle area for controls+timestamps or lyrics */}
                                            <div className="flex-1 min-h-0 w-full relative">
                                                <AnimatePresence mode="wait">
                                                    {!isIdle ? (
                                                        <motion.div
                                                            key="controls-view"
                                                            initial={{ opacity: 0, y: 5 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: -5 }}
                                                            transition={SWITCH_PANEL_TRANSITION}
                                                            className="absolute inset-0"
                                                        >
                                                            <RemoteTransportBar
                                                                isDaylight={isDaylight}
                                                                snapshot={snapshot}
                                                                isPlaying={isPlaying}
                                                                primaryDisabled={primaryDisabled}
                                                                likeDisabled={likeDisabled}
                                                                likeUnavailableReason={likeUnavailableReason}
                                                                progressValue={progressValue}
                                                                duration={duration}
                                                                isExporting={exportState.status === 'recording'}
                                                                onHoverNavSideChange={setHoverNavSide}
                                                                onNavigate={navigateTrack}
                                                                onOpenTransparentControls={() => {
                                                                    draft.setPresetSelectorOpen(false);
                                                                    setActivePanel('transparent-controls');
                                                                }}
                                                                onOpenExport={() => setActivePanel('export')}
                                                            />
                                                        </motion.div>
                                                    ) : (
                                                        <RemoteLyricOverlay
                                                            lyrics={snapshot.lyrics}
                                                            currentTime={snapshot.currentTime - (snapshot.lyricOffsetMs || 0) / 1000}
                                                            duration={snapshot.duration}
                                                            playerState={snapshot.playerState}
                                                            hasTrack={snapshot.hasTrack}
                                                            visible
                                                            baseColor={lyricBaseColor}
                                                            activeColor={lyricAccentColor}
                                                        />
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        </motion.div>
                                    ) : activePanel === 'export' ? (
                                        <motion.div
                                            key="export-panel"
                                            initial={{ opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -5 }}
                                            transition={SWITCH_PANEL_TRANSITION}
                                            className="w-full flex flex-col"
                                        >
                                            <RemoteVideoExportPanel
                                                exportState={exportState}
                                                selectedPreset={draft.selectedPreset}
                                                startMode={draft.startMode}
                                                primaryDisabled={primaryDisabled}
                                                isDaylight={isDaylight}
                                                onOpenPresetSelector={() => draft.setPresetSelectorOpen(true)}
                                                onStartModeChange={draft.setStartMode}
                                                sendCommand={sendRemoteCommand}
                                            />
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="transparent-controls-panel"
                                            initial={{ opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -5 }}
                                            transition={SWITCH_PANEL_TRANSITION}
                                            className="w-full flex flex-col"
                                        >
                                            <RemoteTransparentControls
                                                isDaylight={isDaylight}
                                                snapshot={snapshot}
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Root-Level Preset Selector Overlay Modal */}
                <AnimatePresence>
                    {draft.presetSelectorOpen && (
                        <RemotePresetSelector
                            isDaylight={isDaylight}
                            draft={draft}
                            onClose={() => draft.setPresetSelectorOpen(false)}
                        />
                    )}
                </AnimatePresence>
            </div>
        </main>
    );
};

export default RemoteControlApp;
