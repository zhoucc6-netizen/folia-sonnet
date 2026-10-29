import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { PlayerState } from '../../../../types';
import type { ReplayGainInfo, ReplayGainMode, SongResult, StatusMessage } from '../../../../types';
import type { LocalSong } from '../../../../types';
import { resolveNavidromePlaybackCarrier } from '../../../../utils/appPlaybackGuards';
import { nativePlaybackEngine } from '../../../../services/playbackEngine/nativePlaybackEngine';
import { calculateReplayGain } from '../../../../utils/replayGain';
import { applyAudioEqualizerSettings, planAudioEqualizerApply } from '../../../../services/audioEqualizerGraph';
import { type AudioEffectChain } from '../../../../services/audioEffects/effectChain';
import { buildPlaybackGraph } from '../../../../services/playbackGraph';
import { createSpectrumTap } from '../../../../services/spectrumTap';
import { cachePlayedTrackAssets } from '../../../../services/playedTrackCache';
import { registerPlaybackFadeGraph } from '../../../../services/playbackFade';
import { rampGain, type AutomixDeckChain } from '../../../../services/automix/crossfadeGraph';
import { setStatusMessage as setStatusMsg } from '../../../../stores/useStatusMessageStore';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { setPlayerState } from '../../../../stores/usePlaybackStore';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { noteAnalyser, noteAudioContext } from '../../../../utils/mediaDiagnostics';
import { resolveHeardAudioEqualizerSettings } from '../../../../utils/audioEqualizerModCurve';

// src/components/app/playback/bridges/usePlaybackAudioBridge.ts

/**
 * 输出缓冲：**`balanced`** —— 掉帧与撕裂是一对矛盾，这一档是唯一两头都站住的落点。
 *
 * ⚠️ **必须两头一起看**：只看掉帧会撞上撕裂，只看撕裂会撞上掉帧。三档都上过真机：
 *
 *  · 缓冲**大**（0.1s / 0.2s，`6116eb11` / `44c34ef4`）→ **不撕裂，但播放页掉帧**
 *  · 缓冲**最小**（不指定 = `interactive`，v0.7.20 那版）→ **不掉帧，但切 app 时撕裂**：
 *    系统一把 CPU 抢走，音频线程来不及填满那么小的 buffer
 *  · **`balanced`（这里，当前取值）→ 两头都好**：不掉帧、切 app 也不撕裂（2026-10-19 实测）
 *
 * ⚠️ 关键教训：这个参数**不是单调的**，而且**同一个值在不同时候测出来的结论会互相打脸** ——
 * 「0.2 一度不卡」不代表 0.2 是对的，只是那一次碰巧。别再按「越大越稳」
 * 或「一定有个最优值」去推，实测出来什么就是什么。
 *
 * 上一轮（`44c34ef4`）我拿一段 Blink 源码断言「缓冲与掉帧无关」，据此把 0.1 抬到 0.2，
 * 还写下「别指望它治卡顿」。**源码推理推翻不了实测** —— 源码只能解释机制
 * （说得通的是音频线程抢占：缓冲越大，音频线程每次被唤醒要处理的数据块越大、
 * 占住实时优先级越久，主线程连同 rAF 被顶掉的机会越多），**但不能否定现象**。现象优先。
 *
 * ⚠️ **为什么不做「后台自动拉大」**（很自然会想到，但做不了）：
 * `latencyHint` 只能在 `new AudioContext()` 时给，**运行时改不了**；要换档就得重建 ctx，
 * 而 `createMediaElementSource(element)` 对同一个 element **只能调一次**
 * （见 `services/automix/crossfadeGraph` 的 `connectAutomixDeck`），重建会抛 `InvalidStateError`。
 * 真要绕，得改用 `element.captureStream()` + `createMediaStreamSource`（每次新建 stream），
 * 代价大且会带来新的延迟 —— 先不碰。
 *
 * ⚠️ **为什么不做「后台停频谱」来省音频线程**：`src/entries/wallpaperSurface.tsx` 那条
 * 壁纸叠层**没有自己的 AudioContext**，它的频谱是从这边 `payload.spectrum` 传过去的。
 * 而叠层恰恰要在应用退后台时照常画（画在桌面上），一停就把它一起停了。
 *
 * 顺带澄清一笔：`services/spectrumTap` 把频谱搬到音频线程是对的，它解的是
 * 「主线程每帧现算 FFT」那一笔，**跟这里无关** —— 别因为调缓冲有效就以为频谱那条无用。
 */

type UsePlaybackAudioBridgeParams = {

    audioRef: RefObject<HTMLAudioElement | null>;
    localSongs: LocalSong[];
    isLyricsLoading: boolean;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    analyserRef: MutableRefObject<AnalyserNode | null>;
    gainNodeRef: MutableRefObject<GainNode | null>;
    /** Wires both automix decks into the shared mix point. Returns false if a deck is missing. */
    connectDecks: (context: AudioContext, output: AudioNode) => boolean;
    /** The deck the app is currently listening through, for per-track loudness compensation. */
    getActiveChain: () => AutomixDeckChain | null;
    /** Set when a pause interrupted an armed transition; suppresses exactly one autoplay. */
    suppressAutoplayRef: MutableRefObject<boolean>;
    /** True while automix has the next track loaded but its blend is not due to start yet. */
    isAutoplayHeld: boolean;
    syncOutputGain: (targetVolume: number, smoothing?: number) => void;
    getTargetPlaybackVolume: () => number;
    getCoverUrl: () => string | null;
    /** Whether an automix blend can be heard now; a mod's equalizer change waits until it cannot. */
    isTransitionAudible?: () => boolean;
};

/** How often a mod's equalizer change held back for a blend checks whether the blend has ended. */
const DEFERRED_EQUALIZER_POLL_MS = 250;

// Bridges audio element setup, autoplay, replay gain, and media caching.
export function usePlaybackAudioBridge({
    audioRef,
    localSongs,
    isLyricsLoading,
    shouldAutoPlayRef,
    audioContextRef,
    analyserRef,
    gainNodeRef,
    connectDecks,
    getActiveChain,
    suppressAutoplayRef,
    isAutoplayHeld,
    syncOutputGain,
    getTargetPlaybackVolume,
    getCoverUrl,
    isTransitionAudible,
}: UsePlaybackAudioBridgeParams) {
    // Read here rather than passed in: all store fields or i18n.
    const { t } = useTranslation();
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const replayGainMode = usePlaybackStore(state => state.replayGainMode);
    const enableMediaCache = useAudioSettingsStore(state => state.enableMediaCache);

    const previousAudioSrcRef = useRef<string | null>(null);
    const replayGainLogSignatureRef = useRef<string | null>(null);
    const equalizerNodesRef = useRef<BiquadFilterNode[]>([]);
    const effectChainRef = useRef<AudioEffectChain | null>(null);
    const audioEqualizerSettings = useAudioSettingsStore(state => state.audioEqualizerSettings);
    // What is heard: the listener's own settings with a mod's curve over the gains (Folium 1.7). Worked out
    // here rather than in a selector, which would hand useSyncExternalStore a new object on every read.
    const modCurve = useAudioSettingsStore(state => state.audioEqualizerModCurve);
    const modCurveSuspended = useAudioSettingsStore(state => state.audioEqualizerModCurveSuspended);
    const equalizerOrigin = useAudioSettingsStore(state => state.audioEqualizerChangeOrigin);
    const heardEqualizerSettings = useMemo(
        () => resolveHeardAudioEqualizerSettings(audioEqualizerSettings, modCurve, modCurveSuspended),
        [audioEqualizerSettings, modCurve, modCurveSuspended],
    );
    const heardEqualizerSettingsRef = useRef(heardEqualizerSettings);
    const isTransitionAudibleRef = useRef(isTransitionAudible);
    // Read only in the equalizer effect and its timer; written in an effect, not while rendering.
    useEffect(() => {
        isTransitionAudibleRef.current = isTransitionAudible;
    }, [isTransitionAudible]);

    // Recalculates source-specific gain after the audio graph or playback settings become ready.
    const applyReplayGain = useCallback(() => {
        // 只要求「有歌」：原生出声时 gainNodeRef / audioContextRef 是空的（那张图根本没建），
        // 照旧把它们当门槛的话，原生这条路上 ReplayGain 永远算不出来。
        if (!currentSong) return;

        let replayGainInfo: ReplayGainInfo | undefined;
        const localSongId = (currentSong as SongResult & { localRef?: { songId: string } }).localRef?.songId;
        const localData = localSongId ? localSongs.find(song => song.id === localSongId) : undefined;
        if ((currentSong as SongResult & { isLocal?: boolean }).isLocal && localData) {
            replayGainInfo = {
                trackGain: typeof localData.replayGainTrackGain === 'number'
                    ? localData.replayGainTrackGain
                    : localData.replayGain,
                trackPeak: localData.replayGainTrackPeak,
                albumGain: localData.replayGainAlbumGain,
                albumPeak: localData.replayGainAlbumPeak,
            };
        }

        const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
        const navidromeReplayGain = navidromeSong?.navidromeData.replayGain;
        if (navidromeReplayGain) {
            replayGainInfo = navidromeReplayGain;
        }

        if (currentSong.sourceRef?.kind === 'online') {
            replayGainInfo = currentSong.replayGain;
        }

        const calculation = calculateReplayGain(replayGainInfo, replayGainMode);

        /*
         * 原生播放：响度补偿乘进播放器音量（见 nativePlaybackEngine.setTrackGain）。
         * 播放器只有一个音量旋钮，所以补偿与用户音量在那边相乘下发。
         */
        nativePlaybackEngine.setTrackGain(calculation.linearGain);

        try {
            // Onto the deck rather than the shared output: loudness compensation is a per-track
            // value, so during a blend the two decks legitimately need different ones.
            const context = audioContextRef.current;
            const activeChain = getActiveChain();
            if (activeChain && context) {
                rampGain(context, activeChain.replayGain, calculation.linearGain, 0.1);
            }

            const replayGainLogSignature = JSON.stringify({
                songId: currentSong.id,
                mode: replayGainMode,
                raw: calculation.gainDb,
                effective: calculation.effectiveGainDb,
                peak: calculation.peak ?? null,
            });

            if (replayGainLogSignatureRef.current !== replayGainLogSignature) {
                replayGainLogSignatureRef.current = replayGainLogSignature;
                console.log(`[AudioContext] ReplayGain mode=${replayGainMode} gain=${calculation.effectiveGainDb}dB (raw=${calculation.gainDb}dB, peak=${calculation.peak ?? 'n/a'}, linear=${calculation.linearGain.toFixed(2)})`);
            }
        } catch (error) {
            console.warn('[AudioContext] Failed to apply ReplayGain', error);
        }
    }, [audioContextRef, currentSong, gainNodeRef, getActiveChain, localSongs, replayGainMode]);

    const setupAudioAnalyzer = useCallback(() => {
        // The context is the sentinel, not the source node: a deck that failed to connect must
        // not let this run twice, because createMediaElementSource throws on a second call.
        if (!audioRef.current || audioContextRef.current) return;
        try {
            const AudioContextClass = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            // 走 'balanced'：不指定（= interactive）不掉帧但切 app 撕裂，指定秒数（0.1 / 0.2）
            // 不撕裂但掉帧 —— 只有这一档两头都站住（2026-10-19 实测）。为什么这么选、
            // 以及为什么不做「后台自动拉大」，见上面的注释。
            const ctx = new AudioContextClass({ latencyHint: 'balanced' });
            audioContextRef.current = ctx;
            noteAudioContext(ctx, 'balanced');

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.6;
            analyserRef.current = analyser;
            // 只为那张频谱读数：让它能分清「analyser 没建」和「建了但没数据」。
            noteAnalyser(analyser);

            const { gainNode, fadeNode, effectChain, decksConnected } = buildPlaybackGraph({
                context: ctx,
                analyser,
                connectDecks,
                equalizerNodesRef,
                settings: heardEqualizerSettings,
            });
            gainNodeRef.current = gainNode;
            // Hands the transport its own fade node; until this runs (or if setup fails) pause and
            // resume see no graph and fall back to plain element pause/play.
            registerPlaybackFadeGraph({ context: ctx, gain: fadeNode });
            effectChainRef.current = effectChain;
            if (!decksConnected) {
                console.warn('[AudioContext] Deck setup incomplete, automix will stay idle');
            }

            /*
             * 频谱改由音频线程抽（AudioWorklet），主线程只读最新一份 —— 见 services/spectrumTap。
             *
             * 这一步是**加成**不是依赖：走不通（没有 AudioWorklet / WebView 不让加载 Blob）
             * 它就自己返回 false，取频谱照旧走 analyser 的 getByteFrequencyData，只是那就还是
             * 每帧等一次音频线程。挂在 analyser 之后，拿到的是同一份信号。
             *
             * 但要**等这个 ctx 真的跑起来再挂**：它是上面那一行刚 new 出来的，自动播放策略下
             * 通常还停在 `suspended`（要等一次用户手势才 resume，而 resume 是异步的）。
             * `audioWorklet.addModule()` 的 Promise 在 suspended 的 context 上并不保证推进 ——
             * 挂在还没跑起来的 ctx 上，tap 就一直建不起来，取频谱永远落在 AnalyserNode 那条
             * 同步兜底上。界面上的症状是整页掉帧、而且所有可视化模式一起慢。
             */
            const attachSpectrumTap = () => {
                void createSpectrumTap(ctx, analyser, {
                    fftSize: 2048,
                    // 与上面 analyser 的平滑同一个值：换一条路不等于换一套观感。
                    smoothingTimeConstant: analyser.smoothingTimeConstant,
                });
            };

            if (ctx.state === 'running') {
                attachSpectrumTap();
            } else {
                const onContextStateChange = () => {
                    if (ctx.state !== 'running') return;
                    ctx.removeEventListener('statechange', onContextStateChange);
                    attachSpectrumTap();
                };
                ctx.addEventListener('statechange', onContextStateChange);
            }

            applyReplayGain();
            syncOutputGain(getTargetPlaybackVolume(), 0);
        } catch (error) {
            console.error('Audio Context Setup Failed:', error);
        }
    }, [analyserRef, applyReplayGain, audioContextRef, audioRef, connectDecks, gainNodeRef, getTargetPlaybackVolume, heardEqualizerSettings, syncOutputGain]);

    /**
     * Writes a fully-played track's audio and cover into the media cache.
     *
     * Takes the song and its source explicitly rather than reading `currentSong`/`audioSrc`, because
     * the automix settle path caches the track that just faded OUT - and by then the app's own state
     * already names the track that arrived. `coverUrl` is passed for the currently-displayed track
     * (which may carry a user override); left undefined - the automix path - the cover is taken from
     * the song's own metadata instead.
     *
     * The writes themselves live in `cachePlayedTrackAssets`, which is where the audio and cover
     * conditions are kept apart from each other; this only adds the setting gate, which does not
     * belong in a service.
     */
    const cacheSongAssetsFor = useCallback(async (
        song: SongResult | null,
        src: string | null,
        coverUrl?: string | null,
    ) => {
        if (!enableMediaCache) return;

        await cachePlayedTrackAssets(song, src, coverUrl);
    }, [enableMediaCache]);

    const cacheSongAssets = useCallback(
        () => cacheSongAssetsFor(currentSong, audioSrc, getCoverUrl()),
        [audioSrc, cacheSongAssetsFor, currentSong, getCoverUrl],
    );

    useEffect(() => {
        if (audioRef.current) {
            syncOutputGain(getTargetPlaybackVolume(), 0.015);
        }
    }, [audioRef, getTargetPlaybackVolume, syncOutputGain]);

    useEffect(() => {
        localStorage.setItem('local_replaygain_mode', replayGainMode);
    }, [replayGainMode]);

    useEffect(() => {
        applyReplayGain();
    }, [applyReplayGain]);

    /*
     * Writes what is heard into the graph. A mod's change waits while an automix blend can be heard and is
     * then applied as it stands by then; any later change re-runs this, which drops the wait and applies at
     * once by its own origin (planAudioEqualizerApply).
     */
    useEffect(() => {
        heardEqualizerSettingsRef.current = heardEqualizerSettings;
        const context = audioContextRef.current;
        if (!context || equalizerNodesRef.current.length === 0) {
            return;
        }
        const plan = planAudioEqualizerApply({
            origin: equalizerOrigin,
            transitionAudible: isTransitionAudibleRef.current?.() ?? false,
        });
        const apply = (settings: typeof heardEqualizerSettings) => {
            applyAudioEqualizerSettings(context, equalizerNodesRef.current, settings, plan.timeConstant);
            effectChainRef.current?.apply(settings.effects, settings.enabled);
        };
        if (!plan.defer) {
            apply(heardEqualizerSettings);
            return;
        }
        const timer = setInterval(() => {
            if (isTransitionAudibleRef.current?.()) {
                return;
            }
            clearInterval(timer);
            apply(heardEqualizerSettingsRef.current);
        }, DEFERRED_EQUALIZER_POLL_MS);
        return () => clearInterval(timer);
    }, [audioContextRef, heardEqualizerSettings, equalizerOrigin]);

    useEffect(() => () => {
        effectChainRef.current?.dispose();
        effectChainRef.current = null;
    }, []);

    useEffect(() => {
        const audioElement = audioRef.current;
        if (!audioElement) {
            previousAudioSrcRef.current = audioSrc;
            return;
        }

        if (audioSrc && previousAudioSrcRef.current && previousAudioSrcRef.current !== audioSrc) {
            audioElement.pause();
            audioElement.load();
        }

        previousAudioSrcRef.current = audioSrc;
    }, [audioRef, audioSrc]);

    useEffect(() => {
        if (audioSrc && audioRef.current) {
            // `audioRef` and `audioSrc` describe the same track almost always - but not while a
            // blend is being armed. Automix repoints the ref at the incoming deck the instant it
            // arms, and `audioSrc` keeps naming the OUTGOING track until playSong has resolved the
            // next URL, which takes an await or two. Playing in that window starts whatever the
            // incoming deck still had loaded from an earlier song AND spends the autoplay intent
            // on it, so when the real source lands there is nothing left to press play with: the
            // deck sits fully buffered at currentTime 0 in silence.
            //
            // The deck's own src attribute is written from `audioSrc`, so an exact match is the
            // whole test. Bail WITHOUT spending the intent - this effect runs again on the commit
            // that gives the deck its real source, and that run is the one meant to start it.
            if (audioRef.current.getAttribute('src') !== audioSrc) return;

            // The deck has already failed on this exact source and something else - the transcode
            // fallback - is off resolving it. play() on an element in error state cannot start
            // anything; it rejects with NotSupportedError. Pressing it here only spends the intent,
            // so when the recovered source lands there is nothing left to start the deck with.
            // Bail WITHOUT spending it, the same way the autoplay hold below does: replacing the
            // source runs this effect again, and that run is the one meant to start it.
            if (audioRef.current.error) return;

            if (shouldAutoPlayRef.current && !isLyricsLoading) {
                // The deck has its source and is buffering, but its blend is not due yet. Bail
                // WITHOUT spending the intent - this effect runs again when the hold lifts, and
                // that run is the one meant to start it.
                //
                // This is what keeps the load out of the blend. Pressing play here instead starts
                // the fade wherever loading happened to finish, which took the same second or two
                // off every transition and capped an eight second plan at three.
                if (isAutoplayHeld) {
                    // The outgoing deck is still sounding. playSong dropped the state to IDLE on
                    // its way past and nothing else puts it back until this deck starts, so left
                    // alone the transport reads "stopped" for the whole lead - and the play button
                    // it offers would start this deck early and take the blend with it.
                    setPlayerState(PlayerState.PLAYING);
                    return;
                }

                shouldAutoPlayRef.current = false;

                // Automix starts the next track seconds early, so a pause can land after the
                // advance is already in flight and too late to recall. Honour the pause instead:
                // without this the listener presses pause and the next song starts anyway.
                if (suppressAutoplayRef.current) {
                    suppressAutoplayRef.current = false;
                    setPlayerState(PlayerState.PAUSED);
                    return;
                }

                syncOutputGain(getTargetPlaybackVolume(), 0);
                const playPromise = audioRef.current.play();
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            setPlayerState(PlayerState.PLAYING);
                            setupAudioAnalyzer();
                        })
                        .catch(error => {
                            if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) {
                                setPlayerState(PlayerState.PLAYING);
                                return;
                            }

                            // A load() landing between play() and its promise aborts the play.
                            // That happens whenever the source changes again while a track is
                            // still starting - skipping during an automix transition is the
                            // reliable way to see it - and the autoplay flag was spent before
                            // play() was ever called, so nothing would press play again and the
                            // app sits silent. Put the intent back for the next run.
                            if (error.name === 'AbortError') {
                                shouldAutoPlayRef.current = true;
                                return;
                            }

                            if (error.name === 'NotAllowedError') {
                                setStatusMsg({ type: 'info', text: t('status.clickToPlay') });
                                setPlayerState(PlayerState.PAUSED);
                            }
                        });
                }
            }
        }
    }, [audioRef, audioSrc, getTargetPlaybackVolume, isAutoplayHeld, isLyricsLoading, setPlayerState, setStatusMsg, setupAudioAnalyzer, shouldAutoPlayRef, suppressAutoplayRef, syncOutputGain, t]);

    // Tells this bridge that the active deck ALREADY holds `src` and is sounding it, so the next time
    // `audioSrc` settles on that value the reload effect above treats it as a no-op instead of calling
    // load(). Used when a transition is cancelled back onto the deck still playing the outgoing track:
    // that deck has the song loaded and playing, and reloading it would run the whole song-change
    // shape - a fresh load, a visible hitch - for a track that never actually left.
    const adoptActiveDeckSource = useCallback((src: string) => {
        previousAudioSrcRef.current = src;
    }, []);

    return {
        setupAudioAnalyzer,
        cacheSongAssets,
        cacheSongAssetsFor,
        adoptActiveDeckSource,
    };
}
