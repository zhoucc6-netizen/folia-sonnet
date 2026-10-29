import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { findLatestActiveLineIndex } from '../../../../utils/appPlaybackHelpers';
import { PlayerState } from '../../../../types';
import { setCurrentLineIndex, setHandoffLineIndex, setPlayerState } from '../../../../stores/usePlaybackStore';
import { selectDisplayLyrics, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { readLatestSpectrum } from '../../../../services/spectrumTap';
import {
    audioBands,
    audioPower,
    currentTime,
    handoffLyricCurrentTime,
    handoffProgress,
    lyricCurrentTime,
} from '../../../../stores/motionSignals';
import { getTransitionHandoffProgress } from '../../../../services/automix/transitionCue';
import { tickBeatFx } from '../../../../services/beatFx/beatFxLive';
import { useBeatFxTrack } from '../../../../hooks/useBeatFxTrack';
import { nativePlaybackEngine } from '../../../../services/playbackEngine/nativePlaybackEngine';
import { omni } from '../../../../services/onlineMusic/omni';
import { readIncomingLyricClock } from './incomingLyricClock';
import { isBackgroundLyricHeld, setHeldLyricTime, useBackgroundLyricHoldStore } from '../../backgroundThrottling/backgroundLyricHoldStore';

// src/components/app/playback/bridges/usePlaybackVisualizerBridge.ts

/**
 * How often the loop runs while 后台节流 holds the lyric animation. Only the clocks are kept then (the
 * progress bar, stage end, mods' playback time), and a timer keeps them going in a hidden window,
 * where frames stop.
 */
const HELD_TICK_MS = 250;

type UsePlaybackVisualizerBridgeParams = {

    audioRef: MutableRefObject<HTMLAudioElement | null>;
    analyserRef: MutableRefObject<AnalyserNode | null>;
    animationFrameRef: MutableRefObject<number>;
    effectiveLoopMode: 'off' | 'all' | 'one' | 'shuffle';
    isNowPlayingStageActive: boolean;
    isPlayerCapStageActive: boolean;
    stageActiveEntryKind: string | null;
    stageLyricsSession: unknown;
    stageLyricsClockRef: MutableRefObject<{
        startTimeSec: number;
        endTimeSec: number;
        baseTimeSec: number;
        startedAtMs: number | null;
    }>;
    getSyntheticStageLyricsTime: () => number;
    syncStageLyricsClock: (timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec?: number) => void;
    getNowPlayingDisplayTime: () => number;
    getPlayerCapDisplayTime: () => number;
    syncNowPlayingClock: (progressSec: number, durationSec: number, paused: boolean) => void;
    lyricTimelineOffsetMs: number;
    /**
     * The incoming track's own lyric offset during a blend (`lyricTimelineOffsetMs` is the displayed
     * track's): its clock is read against it, so it runs on unchanged when the settle makes it the
     * displayed track's. Left out, the displayed track's.
     */
    incomingLyricTimelineOffsetMs?: number;
    /** True while an automix handover is in progress and a deck other than the active one sounds. */
    isTransitionAudible: () => boolean;
    /**
     * The deck the on-screen track is playing on while a transition holds the picture, else null.
     *
     * The clock below has to follow whatever is on screen. From the moment a blend arms, the
     * active deck is seconds into the NEXT track while the title, cover and lyrics still belong to
     * the one finishing - so reading the active deck here puts the progress bar and the lyric
     * read-head near zero under a song that is three minutes in.
     */
    getDisplayElement?: () => HTMLAudioElement | null;
};

/**
 * 兜底那条路（AnalyserNode）隔多久取一次频谱。
 *
 * ⚠️ 只有**兜底**才用得上它：音频线程抽的那条（services/spectrumTap）拿的是人家已经算好的
 * 一份，读它一次都不等，每一帧都能取，间隔对它不起作用。
 *
 * 兜底为什么不能每帧取：`getByteFrequencyData()` 的开销是**在主线程上现算一遍 FFT**（外加
 * 一次与音频线程互踢的锁），而播放页的 rAF 每帧跑一次 updateLoop —— 等于每秒在主线程上做
 * 六十次 2048 点 FFT，整页掉帧就是这么来的，且**所有**可视化模式一起慢（卡的是取频谱这一步，
 * 不是某个模式的绘制）。
 *
 * 降到 ~30Hz：频谱本来就过了一遍 `smoothingTimeConstant`（0.6）的平滑，少一半采样看不出来，
 * 但把这笔开销砍掉了一半以上。中间那些帧不写信号，可视化自然沿用上一帧的读数。
 */
const SPECTRUM_READ_INTERVAL_MS = 33;
/** 空频谱：反复 `new Uint8Array(0)` 只会给堆添垃圾，也白唤醒一遍订阅者。 */
const EMPTY_SPECTRUM = new Uint8Array(0);

// Runs the requestAnimationFrame loop for audio-reactive visuals and lyric timing.
export function usePlaybackVisualizerBridge({
    audioRef,
    analyserRef,
    animationFrameRef,
    effectiveLoopMode,
    isNowPlayingStageActive,
    isPlayerCapStageActive,
    stageActiveEntryKind,
    stageLyricsSession,
    stageLyricsClockRef,
    getSyntheticStageLyricsTime,
    syncStageLyricsClock,
    getNowPlayingDisplayTime,
    getPlayerCapDisplayTime,
    syncNowPlayingClock,
    lyricTimelineOffsetMs,
    incomingLyricTimelineOffsetMs = lyricTimelineOffsetMs,
    isTransitionAudible,
    getDisplayElement,
}: UsePlaybackVisualizerBridgeParams) {
    // Read here rather than passed in: store fields and the module-level motion signals.
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const playerState = usePlaybackStore(state => state.playerState);
    const duration = usePlaybackStore(state => state.duration);
    // The lyrics on screen, matching the deck getDisplayElement points at.
    const lyrics = usePlaybackStore(selectDisplayLyrics);
    // The live lyrics, which during a blend are the incoming track's (null until they load).
    const incomingLyrics = usePlaybackStore(state => state.lyrics);

    const currentLineIndexRef = useRef(-1);
    // 上一帧真的去问频谱是什么时候。只为那个 ~30Hz 的降频服务（见 SPECTRUM_READ_INTERVAL_MS）。
    const spectrumReadAtMsRef = useRef(0);
    // 智能动感模式: loads the track's beats while it is on; the clock is stepped below. A ref, so
    // switching it does not rebuild the frame loop.
    const beatFxWantedRef = useRef(false);
    beatFxWantedRef.current = useBeatFxTrack();
    const handoffLineIndexRef = useRef(-1);
    // The lyric offsets as the loop reads them. The settle moves the displayed one onto the incoming
    // track's as it copies that track's clock: the prop catches up a render later, and a frame read in
    // between against the outgoing track's offset would move the line by the difference.
    const displayOffsetMsRef = useRef(lyricTimelineOffsetMs);
    const incomingOffsetMsRef = useRef(incomingLyricTimelineOffsetMs);
    useEffect(() => {
        displayOffsetMsRef.current = lyricTimelineOffsetMs;
    }, [lyricTimelineOffsetMs]);
    useEffect(() => {
        incomingOffsetMsRef.current = incomingLyricTimelineOffsetMs;
    }, [incomingLyricTimelineOffsetMs]);

    // A preview clip may start somewhere inside its song: the read-head is the deck's own clock plus
    // that start. Cached per URL until the registry changes, since the frame loop asks every frame.
    const clipStartSecRef = useRef(new Map<string, number>());
    const clipStartVersionRef = useRef(-1);
    const lyricClipStartSec = useCallback((element: HTMLAudioElement | null | undefined): number => {
        const src = element?.currentSrc;
        if (!src) return 0;
        const version = omni.audioSourceMetadataVersion();
        if (clipStartVersionRef.current !== version) {
            clipStartSecRef.current.clear();
            clipStartVersionRef.current = version;
        }
        const known = clipStartSecRef.current.get(src);
        if (known !== undefined) return known;
        const seconds = omni.previewClipStartMsOfAudioSource(src) / 1000;
        const starts = clipStartSecRef.current;
        starts.set(src, seconds);
        if (starts.size > 8) {
            const oldest = starts.keys().next().value;
            if (oldest !== undefined) starts.delete(oldest);
        }
        return seconds;
    }, []);

    // The ends of a blend, written as the store changes rather than on the next frame: the visualizer
    // renders from that same change, and a frame late it would draw the incoming track's lyrics from
    // the outgoing track's clock and line (or the last blend's finished hand-off at the next one's start).
    useEffect(() => usePlaybackStore.subscribe((state, previous) => {
        if (state.transitionDisplay === previous.transitionDisplay) return;
        if (previous.transitionDisplay === null) {
            handoffProgress.set(0);
            handoffLineIndexRef.current = -1;
            setHandoffLineIndex(-1);
            return;
        }
        if (state.transitionDisplay !== null) return;
        // Handed over: the picture is now the incoming track, and its clock runs on from its own deck.
        // Only the session knows which way the blend went. A cancel keeps the outgoing deck's clock, and
        // a skip mid-blend loads some other track onto the deck that was incoming, so both are left to
        // the ordinary song change. Read from the deck here rather than from the frame loop's last
        // hand-off: that loop does not run while the window is hidden.
        // The hand-off itself is left where it stood: what plays along it (the background change, the
        // Monet cover) lets go of it at a settle or a cancel and plays the rest from there on the clock,
        // and a set here would snap it to the end first.
        const incoming = audioRef.current;
        if (state.transitionEnd !== 'handedOver' || !incoming) return;
        const clock = readIncomingLyricClock(
            incoming.currentTime + lyricClipStartSec(incoming),
            incomingOffsetMsRef.current,
            state.lyrics?.lines,
        );
        displayOffsetMsRef.current = incomingOffsetMsRef.current;
        currentTime.set(incoming.currentTime);
        lyricCurrentTime.set(clock.lyricTimeSec);
        currentLineIndexRef.current = clock.lineIndex;
        setCurrentLineIndex(clock.lineIndex);
    }), [audioRef, lyricClipStartSec]);

    // The frame loop moves the read-head only while the deck plays. A deck that loads or seeks while
    // paused - a restored session, above all a restored preview clip, which starts somewhere inside
    // its song - would leave it where the song change put it (useLyricReadHead: the top of the whole
    // song), while the remote window and OBS, which read the deck's position, show the line it is
    // really at; pressing play would then jump the main read-head forward on its first frame. So the
    // read-head is also set from those two events, and a paused deck costs nothing per frame.
    // Listened for on the document in the capture phase (media events do not bubble, but they are
    // captured), so the listener follows whichever deck is active without re-binding at a deck swap.
    // Only the main player's own clock: a stage or PlayerCap clock is written by its own branch below.
    const pausedDeckSyncRef = useRef({ ownsClock: false, lyrics });
    pausedDeckSyncRef.current = {
        ownsClock: activePlaybackContext === 'main' && !isNowPlayingStageActive && !isPlayerCapStageActive,
        lyrics,
    };
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const syncPausedDeck = (event: Event) => {
            const element = audioRef.current;
            if (!element || event.target !== element || !element.paused) return;
            const { ownsClock, lyrics: displayedLyrics } = pausedDeckSyncRef.current;
            // While a blend holds the picture this deck is the incoming track, not the one on screen.
            if (!ownsClock || getDisplayElement?.()) return;
            const clock = readIncomingLyricClock(
                element.currentTime + lyricClipStartSec(element),
                displayOffsetMsRef.current,
                displayedLyrics?.lines,
            );
            lyricCurrentTime.set(clock.lyricTimeSec);
            if (displayedLyrics && clock.lineIndex !== currentLineIndexRef.current) {
                currentLineIndexRef.current = clock.lineIndex;
                setCurrentLineIndex(clock.lineIndex);
            }
        };
        document.addEventListener('loadedmetadata', syncPausedDeck, true);
        document.addEventListener('seeked', syncPausedDeck, true);
        return () => {
            document.removeEventListener('loadedmetadata', syncPausedDeck, true);
            document.removeEventListener('seeked', syncPausedDeck, true);
        };
    }, [audioRef, getDisplayElement, lyricClipStartSec]);

    const updateLoop = useCallback(() => {
        // 后台节流 holds the lyric animation while the window is minimised or hidden: the clocks below
        // keep running, while the lyric read-head, the line and the audio bands stay where they are
        // until the window is back on screen (the pass that lets go catches them up).
        const backgroundHold = isBackgroundLyricHeld();
        setHeldLyricTime(null);
        const showLyricTime = (seconds: number) => {
            if (backgroundHold) setHeldLyricTime(seconds);
            else lyricCurrentTime.set(seconds);
        };
        const showLine = (index: number) => {
            if (backgroundHold || index === currentLineIndexRef.current) return;
            currentLineIndexRef.current = index;
            setCurrentLineIndex(index);
        };

        // Normally the active deck; the outgoing one for as long as a blend holds the picture on
        // the track it is finishing, so that clock and picture never describe different songs.
        const audioElement = getDisplayElement?.() ?? audioRef.current;
        // 原生播放（P1）：元素是空的，它的 currentTime 恒为 0，而歌词与进度条都从下面
        // 那个 `time` 走 —— 所以这时候改从引擎读插值后的位置。
        //
        // ⚠️ 判据是 `ownsPlayback`（原生手上有没有歌），**不是** `isPlaying`：
        // 缓冲、切后台、焦点被抢都会让 isPlaying 短暂为 false，跟着它走的结果就是
        // 「进度条和歌词时走时停、一停一冲」—— 用户说的抽搐。位置该不该前进由引擎的
        // 插值决定（停着的时候它本来就给同一个值）。
        const usesNativeClock = nativePlaybackEngine.ownsPlayback();
        const nativeTime = usesNativeClock ? nativePlaybackEngine.getPositionSec() : null;
        const isActuallyPlaying = usesNativeClock
            ? nativePlaybackEngine.isPlaying()
            : Boolean(audioElement && !audioElement.paused && !audioElement.ended);
        // Mid-handover a deck can be loading while the other one is still sounding. The analyser
        // is downstream of both, so it has real signal: dropping to the idle breath here would put
        // a visible stutter at exactly the moment meant to be seamless.
        const hasAudibleSignal = isActuallyPlaying || isTransitionAudible();
        /*
         * 频谱有两条路，能用哪条用哪条：
         *
         *  · **音频线程抽的那条**（services/spectrumTap）—— 拿到的是人家已经算好的一份，读它
         *    **一次都不等音频线程**，所以每一帧都能用，不必降频；
         *  · **AnalyserNode 那条**（兜底）—— `getByteFrequencyData` 的开销是**在主线程上现算
         *    一遍 FFT**，一帧一次太贵，所以降到 ~30Hz（SPECTRUM_READ_INTERVAL_MS）。它跟输出
         *    缓冲多大**没有关系**，别照着「缓冲越大等得越久」那条旧结论去调 latencyHint。
         *
         * 第一条接不上（没有 AudioWorklet、或 WebView 不给加载）时自动落到第二条。
         *
         * ⚠️ 原生出声（原生播放）时这条**没有数据**：抽头挂在 Web Audio 图上，而
         * `createMediaElementSource` 单向不可逆 —— 图一断它就再也不会有新帧。那时
         * `readLatestSpectrum()` 依然会返回非 null（冻住的最后一帧，通常全 0），
         * 下游拿到的是一份趴着的频谱。原生接管时不另采数据（每秒 20 帧过桥的代价是
         * 界面周期性卡一下），就让它趴着。
         */
        const tapped = readLatestSpectrum();
        // 取成局部变量：ref 上的 .current 进不了分支条件的窄化，后面要直接用它。
        const analyser = analyserRef.current;
        // 只有第二条才需要这个间隔。
        const nowMsValue = performance.now();
        const spectrumDue = nowMsValue - spectrumReadAtMsRef.current >= SPECTRUM_READ_INTERVAL_MS;
        const process = (value: number, boost = 2) => {
            const normalized = value / 255;
            return Math.pow(normalized, boost) * 255;
        };

        // 三态，不是二态：有信号但这一帧不该读频谱时**什么都不写** —— 沿用上一次的读数。
        // 写成 if/else 会让这些帧掉进 idle breath，律动就在真频谱和呼吸之间每帧来回跳。
        if (!hasAudibleSignal || (!tapped && !analyser)) {
            const time = Date.now() / 2000;
            const breath = (Math.sin(time) + 1) * 20;
            audioPower.set(breath);
            audioBands.bass.set(breath);
            audioBands.lowMid.set(breath);
            audioBands.mid.set(breath);
            audioBands.vocal.set(breath);
            audioBands.treble.set(breath);
            // 同一份空数组反复 set 没有意义，也会白唤醒订阅者。
            audioBands.spectrum?.set(EMPTY_SPECTRUM);
        } else if (tapped) {
            audioBands.spectrum?.set(tapped.spectrum);
            audioPower.set(process((tapped.bass + tapped.lowMid) / 2, 3));
            audioBands.bass.set(process(tapped.bass, 1.8));
            audioBands.lowMid.set(process(tapped.lowMid, 2));
            audioBands.mid.set(process(tapped.mid, 2));
            audioBands.vocal.set(process(tapped.vocal, 1.5));
            audioBands.treble.set(process(tapped.treble, 2));
        } else if (analyser && spectrumDue) {
            // 记在真正去读之前：这次同步等待算进间隔里，缓冲大也不会把节奏挤成一帧一次。
            spectrumReadAtMsRef.current = nowMsValue;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyser.getByteFrequencyData(dataArray);
            audioBands.spectrum?.set(dataArray);

            const getEnergy = (minHz: number, maxHz: number): number => {
                const start = Math.floor(minHz / 21.5);
                const end = Math.floor(maxHz / 21.5);
                let sum = 0;
                for (let index = start; index <= end; index += 1) {
                    sum += dataArray[index];
                }
                const count = end - start + 1;
                return count > 0 ? sum / count : 0;
            };

            const bass = getEnergy(20, 150);
            const lowMid = getEnergy(150, 400);
            const mid = getEnergy(400, 1200);
            const vocal = getEnergy(1000, 3500);
            const treble = getEnergy(3500, 12000);

            audioPower.set(process((bass + lowMid) / 2, 3));
            audioBands.bass.set(process(bass, 1.8));
            audioBands.lowMid.set(process(lowMid, 2));
            audioBands.mid.set(process(mid, 2));
            audioBands.vocal.set(process(vocal, 1.5));
            audioBands.treble.set(process(treble, 2));
        }

        // 原生这一路不看 isActuallyPlaying：暂停时引擎给的是停住的位置，照样要写进去
        // （不写的话进度条与歌词会停在「上一次还活着」的地方，等下次 events 才跳一次）。
        const clockTime = usesNativeClock
            ? (nativeTime as number)
            : (isActuallyPlaying && audioElement ? audioElement.currentTime : null);

        if (clockTime !== null) {
            const time = clockTime;
            currentTime.set(time);

            const effectiveLyricTime = time + lyricClipStartSec(audioElement) - displayOffsetMsRef.current / 1000;
            showLyricTime(effectiveLyricTime);

            if (lyrics) {
                showLine(findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime));
            }
        } else if (isNowPlayingStageActive) {
            const nextTime = getNowPlayingDisplayTime();
            const hasReachedEnd = playerState === PlayerState.PLAYING && duration > 0 && nextTime >= duration;

            currentTime.set(nextTime);

            const effectiveLyricTime = nextTime - displayOffsetMsRef.current / 1000;
            showLyricTime(effectiveLyricTime);
            showLine(lyrics ? findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime) : -1);

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncNowPlayingClock(0, duration, false);
                    currentTime.set(0);
                    if (lyrics) {
                        showLine(findLatestActiveLineIndex(lyrics.lines, 0));
                    }
                } else {
                    syncNowPlayingClock(duration, duration, true);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        } else if (isPlayerCapStageActive) {
            // PlayerCap: clock extrapolated from progress×duration; a passive source, looping/ending is driven by the external player, so no end/loop handling here.
            const nextTime = getPlayerCapDisplayTime();
            currentTime.set(nextTime);

            const effectiveLyricTime = nextTime - displayOffsetMsRef.current / 1000;
            showLyricTime(effectiveLyricTime);
            showLine(lyrics ? findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime) : -1);
        } else if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && stageLyricsSession && lyrics) {
            const nextTime = getSyntheticStageLyricsTime();
            const clock = stageLyricsClockRef.current;
            const hasReachedEnd = playerState === PlayerState.PLAYING && nextTime >= clock.endTimeSec;

            currentTime.set(nextTime);

            showLine(findLatestActiveLineIndex(lyrics.lines, nextTime));

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncStageLyricsClock(clock.startTimeSec, clock.endTimeSec, PlayerState.PLAYING, clock.startTimeSec);
                    currentTime.set(clock.startTimeSec);
                    showLine(findLatestActiveLineIndex(lyrics.lines, clock.startTimeSec));
                } else {
                    syncStageLyricsClock(clock.endTimeSec, clock.endTimeSec, PlayerState.PAUSED, clock.startTimeSec);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        }

        if (beatFxWantedRef.current) {
            // 原生播放时元素是空的：节拍那套补偿（beatFx）读的是元素与 AudioContext 的延迟，
            // 这时候两边都没有意义，传 null 让它待着。
            tickBeatFx(isActuallyPlaying && !usesNativeClock ? audioElement : null, analyserRef.current?.context);
        }

        // While a blend holds the picture, the active deck is the incoming track: its hand-off, clock
        // and line for the visualizer, off this same frame rather than a second loop.
        const heldElement = getDisplayElement?.() ?? null;
        const incomingElement = heldElement ? audioRef.current : null;
        if (!backgroundHold && incomingElement && incomingElement !== heldElement) {
            handoffProgress.set(getTransitionHandoffProgress());
            const incomingClock = readIncomingLyricClock(
                incomingElement.currentTime + lyricClipStartSec(incomingElement),
                incomingOffsetMsRef.current,
                incomingLyrics?.lines,
            );
            handoffLyricCurrentTime.set(incomingClock.lyricTimeSec);
            if (incomingClock.lineIndex !== handoffLineIndexRef.current) {
                handoffLineIndexRef.current = incomingClock.lineIndex;
                setHandoffLineIndex(incomingClock.lineIndex);
            }
        }
    }, [
        activePlaybackContext,
        analyserRef,
        audioBands,
        audioPower,
        audioRef,
        currentTime,
        duration,
        effectiveLoopMode,
        getNowPlayingDisplayTime,
        getPlayerCapDisplayTime,
        getSyntheticStageLyricsTime,
        isNowPlayingStageActive,
        isPlayerCapStageActive,
        lyrics,
        incomingLyrics,
        playerState,
        setCurrentLineIndex,
        setPlayerState,
        stageActiveEntryKind,
        stageLyricsClockRef,
        stageLyricsSession,
        syncNowPlayingClock,
        syncStageLyricsClock,
        lyricCurrentTime,
        lyricClipStartSec,
        isTransitionAudible,
        getDisplayElement,
    ]);

    // Every frame normally; while 后台节流 holds the lyrics, a slow timer that keeps only the clocks. The
    // moment the hold lets go, one pass runs at once, so the lyrics have caught up before anything reads them.
    useEffect(() => {
        let heldTimer: number | undefined;
        const tick = () => {
            updateLoop();
            schedule();
        };
        const schedule = () => {
            if (isBackgroundLyricHeld()) {
                heldTimer = window.setTimeout(tick, HELD_TICK_MS);
            } else {
                animationFrameRef.current = requestAnimationFrame(tick);
            }
        };
        const cancel = () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = 0;
            }
            window.clearTimeout(heldTimer);
        };

        schedule();
        const unsubscribeHold = useBackgroundLyricHoldStore.subscribe((state, previous) => {
            if (state.held === previous.held) return;
            // A song change while held set the line in the store (-1) behind this loop's back; compare
            // against that, or a new song's first line that happens to match the held one is never written.
            if (!state.held) currentLineIndexRef.current = usePlaybackStore.getState().currentLineIndex;
            cancel();
            tick();
        });
        return () => {
            unsubscribeHold();
            cancel();
            setHeldLyricTime(null);
        };
    }, [animationFrameRef, updateLoop]);

}
