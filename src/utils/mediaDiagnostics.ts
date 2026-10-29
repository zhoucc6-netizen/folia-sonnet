// src/utils/mediaDiagnostics.ts
//
// 播放侧的停顿现场。「歌卡一下」有两种完全不同的成因：取不到数据（网络/上游）与解码跟不上，
// 再加上我们自己改过播放位置或速率的情况 —— 三种在日志里长得一模一样，没有计数就分不开。
//
// 只记录可公开的形态：次数、时长、缓冲量、readyState / networkState。不记录音频地址、账号或凭据。

export type AudioEventKind =
    | 'waiting'
    | 'canplay'
    | 'playing'
    | 'stalled'
    | 'error'
    | 'seeking'
    | 'seeked'
    | 'ratechange'
    | 'pause'
    | 'ended';

export type MediaDiagnosticsSnapshot = {
    waitingCount: number;
    waitingTotalMs: number;
    waitingMaxMs: number;
    lastWaitingMs: number | null;
    stalledCount: number;
    errorCount: number;
    seekingCount: number;
    seekedCount: number;
    rateChangeCount: number;
    playbackRate: number | null;
    bufferedAheadSec: number | null;
    bufferedRanges: number;
    readyState: number | null;
    networkState: number | null;
    lastEvent: AudioEventKind | null;
    lastEventAt: string | null;
    /** 正在等待（waiting 已开始、还没等到 canplay/playing）时为 true。 */
    waitingNow: boolean;
    /** AudioContext 建出来时要求的缓冲：档位名（`balanced`）或秒数（`0.1s`）。见 noteAudioContext。 */
    audioContextLatencyHint: string | null;
    audioContextSampleRate: number | null;
    /** 图本身的处理延迟（秒），不含输出那一段。 */
    audioContextBaseLatencySec: number | null;
    /** 从图尾到声卡的延迟（秒）—— CPU 吃紧时它会变，缓冲够不够看它。 */
    audioContextOutputLatencySec: number | null;
    audioContextState: string | null;
    /** 这一帧的频谱从哪来：`worklet`（音频线程算好 post 出来）还是 `analyser`（主线程每帧现算 FFT）。 */
    spectrumSource: SpectrumSource;
    /** 走 `analyser` 兜底的原因；走 `worklet` 时为 null。 */
    spectrumSourceReason: string | null;
};

import type { MotionValue } from 'framer-motion';
import type { AudioBandSignals } from '../stores/motionSignals';

// 这个模块是叶子：**不 import store**（utils → stores 是反的依赖方向）。它需要两样
// 外部东西，都以参数 / 端口的形式从边上给进来：
//
//  · 「性能采样」开关的现值 —— 每个音频事件都要问一次，所以做成可注册的读值函数，
//    由启动处（src/index.tsx）把 store 的读值接上（见 setMediaDiagnosticsEnabledReader）；
//  · 频谱那一帧的读数 —— 由调用方（开发者选项的面板）把 motionSignals 传进来
//    （见 readSpectrumDiagnostics）。类型上用 `import type` 引用 stores 的签名：类型在
//    运行时不存在，跑不到那条边界上去。
//
// 顺带一提：audioBands / audioPower 住在 stores/ 只是历史 —— 那份文件里没有一个
// React state，全是进程级稳定的 MotionValue 实例。

/** 采样开关的读值函数。默认关：没接上的时候这些计数只服务于排查，不该自己跑起来。 */
let readDiagnosticsEnabled: () => boolean = () => false;

/** 由启动处接上「性能采样」开关的读值。重复注册以最后一次为准。 */
export const setMediaDiagnosticsEnabledReader = (read: () => boolean): void => {
    readDiagnosticsEnabled = read;
};

let waitingCount = 0;
let waitingTotalMs = 0;
let waitingMaxMs = 0;
let lastWaitingMs: number | null = null;
let waitingSinceMs: number | null = null;
let stalledCount = 0;
let errorCount = 0;
let seekingCount = 0;
let seekedCount = 0;
let rateChangeCount = 0;
let lastEvent: AudioEventKind | null = null;
let lastEventAt: string | null = null;

const nowMs = (): number => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
);

/** 最近一次读到过状态的那个音频元素，缓冲量与网络状态从它身上读。 */
let trackedElement: HTMLAudioElement | null = null;

/**
 * 建出来的 AudioContext 是什么样。
 *
 * 缓冲档位（latencyHint）决定音频线程一次要交多少样本：默认那档（`interactive`）只给几十
 * 毫秒，CPU 一被别的东西占满就交不上，听感就是连续的撕裂/爆音（underrun）。想知道改完到底
 * 生效没有，看 `audioContextOutputLatencySec` 与 `audioContextBaseLatencySec` 就行。
 */
let audioContextDiagnostics: {
    latencyHint: string;
    sampleRate: number | null;
    baseLatencySec: number | null;
    outputLatencySec: number | null;
    state: string | null;
} = {
    latencyHint: 'unknown',
    sampleRate: null,
    baseLatencySec: null,
    outputLatencySec: null,
    state: null,
};

const readAudioContextDiagnostics = (context: AudioContext): void => {
    audioContextDiagnostics.sampleRate = Number.isFinite(context.sampleRate) ? context.sampleRate : null;
    audioContextDiagnostics.baseLatencySec = Number.isFinite(context.baseLatency) ? context.baseLatency : null;
    audioContextDiagnostics.outputLatencySec = Number.isFinite(context.outputLatency) ? context.outputLatency : null;
    audioContextDiagnostics.state = context.state || null;
};

/**
 * 把请求的缓冲写成一个能直接摆在界面上的字符串。
 *
 * 传数字是规范里的秒数写法（见 usePlaybackAudioBridge 的 AUDIO_OUTPUT_LATENCY_HINT_DEFAULT_SEC），
 * 带上单位才不会跟 `balanced` 这类档位名混在一起读。
 */
const describeLatencyHint = (
    hint: AudioContextLatencyCategory | number | 'unknown' | undefined,
): string => {
    // 先按 `typeof` 分掉数字那一路再回落：`Number.isFinite` 不是类型守卫，写成
    // `typeof x === 'number' && Number.isFinite(x)` 之后 TS 窄不掉 `number`，
    // 下面那行 `hint || 'unknown'` 的返回类型就带上 number，跟声明的 string 对不上。
    if (typeof hint === 'number') return Number.isFinite(hint) ? `${hint}s` : 'unknown';
    return hint || 'unknown';
};

/** 记住这个 AudioContext 用的哪一档缓冲，之后一路跟着它更新延迟读数。 */
export const noteAudioContext = (
    context: AudioContext | null | undefined,
    latencyHint?: AudioContextLatencyCategory | number | 'unknown',
): void => {
    if (!context) return;
    audioContextDiagnostics.latencyHint = describeLatencyHint(latencyHint);
    readAudioContextDiagnostics(context);
    context.addEventListener('statechange', () => {
        readAudioContextDiagnostics(context);
    });
};

const settleWaiting = (): void => {
    if (waitingSinceMs === null) return;
    const durationMs = nowMs() - waitingSinceMs;
    waitingSinceMs = null;
    waitingCount += 1;
    waitingTotalMs += durationMs;
    lastWaitingMs = durationMs;
    if (durationMs > waitingMaxMs) waitingMaxMs = durationMs;
};

export const noteAudioEvent = (
    kind: AudioEventKind,
    element?: HTMLAudioElement | null,
): void => {
    // 跟「性能采样」同一个开关（开发者选项）。默认关：这些计数只服务于排查，
    // 不应该在每个用户的每次播放事件上跑。
    if (!readDiagnosticsEnabled()) return;
    if (element) trackedElement = element;
    lastEvent = kind;
    lastEventAt = new Date().toISOString();

    if (kind === 'waiting') {
        // 已经在等的时候再来一次 waiting 只更新起点，不重复计数。
        if (waitingSinceMs === null) waitingSinceMs = nowMs();
        return;
    }
    // 等到数据了就结算这一次 waiting；seeked 同样收尾（跳转引起的等待不算网络问题，
    // 但仍要把计时收掉，否则下一次 waiting 会把它一起算进去）。
    if (kind === 'seeked') {
        seekedCount += 1;
        settleWaiting();
        return;
    }
    if (kind === 'canplay' || kind === 'playing') {
        settleWaiting();
        return;
    }
    if (kind === 'stalled') stalledCount += 1;
    else if (kind === 'error') errorCount += 1;
    else if (kind === 'seeking') seekingCount += 1;
    else if (kind === 'ratechange') rateChangeCount += 1;
};

export const readMediaDiagnostics = (): MediaDiagnosticsSnapshot => {
    const element = trackedElement;
    let bufferedAheadSec: number | null = null;
    let bufferedRanges = 0;
    if (element) {
        try {
            const buffered = element.buffered;
            bufferedRanges = buffered ? buffered.length : 0;
            const currentTime = Number(element.currentTime);
            if (buffered && bufferedRanges > 0 && Number.isFinite(currentTime)) {
                let ahead = 0;
                for (let index = 0; index < bufferedRanges; index += 1) {
                    const end = buffered.end(index);
                    const start = buffered.start(index);
                    if (currentTime >= start && currentTime <= end) {
                        ahead = Math.max(ahead, end - currentTime);
                    }
                }
                bufferedAheadSec = ahead;
            }
        } catch {
            // 元素已经换歌或释放，读不到就算了。
        }
    }
    return {
        waitingCount,
        waitingTotalMs,
        waitingMaxMs,
        lastWaitingMs,
        stalledCount,
        errorCount,
        seekingCount,
        seekedCount,
        rateChangeCount,
        playbackRate: element && Number.isFinite(element.playbackRate) ? element.playbackRate : null,
        bufferedAheadSec,
        bufferedRanges,
        readyState: element ? element.readyState : null,
        networkState: element ? element.networkState : null,
        lastEvent,
        lastEventAt,
        waitingNow: waitingSinceMs !== null,
        audioContextLatencyHint: audioContextDiagnostics.latencyHint,
        audioContextSampleRate: audioContextDiagnostics.sampleRate,
        audioContextBaseLatencySec: audioContextDiagnostics.baseLatencySec,
        audioContextOutputLatencySec: audioContextDiagnostics.outputLatencySec,
        audioContextState: audioContextDiagnostics.state,
        /*
         * 频谱走哪条路 —— 这一项是「播放页掉帧」那类问题的分水岭：
         *
         *  · `worklet` —— 音频线程算完 post 出来，主线程只读最新一份，一次都不等音频线程；
         *  · `analyser` —— 每帧在主线程上现算一遍 FFT（`getByteFrequencyData` 的开销就在
         *    这里，跟输出缓冲多大没关系），表现为整页掉帧且**所有**可视化模式一起慢（卡的
         *    是取频谱这一步，不是某个模式的绘制）。
         *
         * 出现后者而 `audioContext*` 那几项都正常，去看 `spectrumSourceReason`。
         */
        spectrumSource,
        spectrumSourceReason,
    };
};

/**
 * 频谱读数 —— 专门用来分开「频谱不动」的两种成因。
 *
 * 界面上它们长得一模一样，修法却完全不同：
 *
 *  · **采集侧没有数据**：`analyserBuilt` 为 false（AudioContext 没建 / 建的时候抛了），
 *    或者建了但 `spectrumBins` / `spectrumPeak` 是 0 —— 声音没经过这张 Web Audio 图
 *    （比如播放已经搬到原生层），这时改绘制代码一点用都没有；
 *  · **采集有数据，绘制画得太小**：`spectrumPeak` 有正常数值（几十到两百多），
 *    那问题在可视化那一侧，跟谁在出声无关。
 *
 * 以前只能连着 adb 抓日志才分得开，现在摆出来一眼就能定。
 */
export type SpectrumDiagnosticsSnapshot = {
    /** AudioContext 建好、analyser 挂上过没有。建过一次就一直是 true。 */
    analyserBuilt: boolean;
    /** 频谱的频点数。0 = 这一帧没有频谱（无声 / 没建）。 */
    spectrumBins: number;
    /** 这一帧频谱的最大值，0..255。 */
    spectrumPeak: number;
    power: number;
    bass: number;
    lowMid: number;
    mid: number;
    vocal: number;
    treble: number;
};

let analyserBuilt = false;

/** 播放图建好时调一次：只想知道 analyser 到底挂上过没有。 */
export const noteAnalyser = (analyser: AnalyserNode | null | undefined): void => {
    if (analyser) {
        analyserBuilt = true;
    }
};

/** 取频谱的两条路：音频线程算（worklet），还是每帧同步等（analyser）。'unknown' 是还没试过。 */
export type SpectrumSource = 'unknown' | 'worklet' | 'analyser';

let spectrumSource: SpectrumSource = 'unknown';
let spectrumSourceReason: string | null = null;

/**
 * 频谱那条路接上（或确认没接上）时调一次。
 *
 * 这个判断以前只能靠抓日志，而掉帧的两种成因在界面上一模一样 —— 摆出来一眼就能分开。
 */
export const noteSpectrumSource = (source: SpectrumSource, reason?: unknown): void => {
    spectrumSource = source;
    spectrumSourceReason = reason === undefined ? null : String(reason);
};

/** 频谱那一路的信号，就是 motionSignals 的 audioBands 再加整体能量 audioPower。 */
export type SpectrumSignals = AudioBandSignals & { power: MotionValue<number> };

/**
 * 读这一帧的频谱。
 *
 * bin 是隔 4 个抽一个：这里只回答「有没有 / 有多大」，全扫一遍不过是白花时间。
 *
 * 信号由调用方传进来（motionSignals 的 audioBands + audioPower）—— 这个模块不自己
 * 去取，否则就成了 utils 反向依赖 stores。
 */
export const readSpectrumDiagnostics = (signals: SpectrumSignals): SpectrumDiagnosticsSnapshot => {
    const spectrum = signals.spectrum.get();
    let peak = 0;
    if (spectrum) {
        for (let index = 0; index < spectrum.length; index += 4) {
            const value = spectrum[index];
            if (value > peak) {
                peak = value;
            }
        }
    }
    return {
        analyserBuilt,
        spectrumBins: spectrum ? spectrum.length : 0,
        spectrumPeak: peak,
        power: Math.round(signals.power.get()),
        bass: Math.round(signals.bass.get()),
        lowMid: Math.round(signals.lowMid.get()),
        mid: Math.round(signals.mid.get()),
        vocal: Math.round(signals.vocal.get()),
        treble: Math.round(signals.treble.get()),
    };
};

/** 换歌时复位：上一首的停顿不该算到这一首头上。 */
export const resetMediaDiagnostics = (): void => {
    waitingCount = 0;
    waitingTotalMs = 0;
    waitingMaxMs = 0;
    lastWaitingMs = null;
    waitingSinceMs = null;
    stalledCount = 0;
    errorCount = 0;
    seekingCount = 0;
    seekedCount = 0;
    rateChangeCount = 0;
    lastEvent = null;
    lastEventAt = null;
};
