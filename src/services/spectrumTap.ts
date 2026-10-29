import { noteSpectrumSource } from '../utils/mediaDiagnostics';
import { SPECTRUM_WORKLET_NAME, SPECTRUM_WORKLET_SOURCE } from './spectrumWorkletSource';

// src/services/spectrumTap.ts
// 播放页取频谱的**另一条路**：音频线程算、主线程只读。
//
// 原来那一条是每帧同步调 `analyser.getByteFrequencyData()`：它的开销是**在主线程上现算一遍
// FFT**（外加一次与音频线程互踢的锁），一帧一次、一秒六十次，播放页整页掉帧就是这么来的，
// 而且**所有**可视化模式一起慢 —— 卡的是取频谱这一步，不是某个模式的绘制。
//
// ⚠️ 别混两件事：这里拿掉的是「主线程每帧现算一遍 FFT」那一笔；输出缓冲（latencyHint）大小
// **另外**也影响掉帧，但机制是音频线程抢占，跟这里无关 —— 见 usePlaybackAudioBridge 的注释。
//
// 这里把算的那一步搬进 AudioWorklet：processor 在音频线程里做完 FFT 和平滑，把结果 post
// 出来；主线程只保存最新一份，rAF 读它的时候**不碰任何 Web Audio 方法**，一次都不等。
//
// 走不通（没有 AudioWorklet / addModule 失败 / WebView 不给加载 Blob）就返回 false，调用方
// 照旧用 AnalyserNode —— 这条路是**加成**，不是依赖。

/**
 * `addModule` 的最长等待。
 *
 * 它的 Promise 有可能**既不 resolve 也不 reject**（挂在还没跑起来的 context 上就是那样），
 * 那就既没有警告也没有 tap —— 取频谱一路落在同步兜底上，而日志上什么都看不出来。
 * 规定一个上限，过了就当这条路走不通，把原因写进诊断。
 */
const ADD_MODULE_TIMEOUT_MS = 4000;

const addModuleWithTimeout = async (context: AudioContext, url: string): Promise<void> => {
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(
            () => reject(new Error(`addModule 超过 ${ADD_MODULE_TIMEOUT_MS}ms 没有完成`)),
            ADD_MODULE_TIMEOUT_MS,
        );
    });
    try {
        await Promise.race([context.audioWorklet.addModule(url), timeout]);
    } finally {
        if (timer !== undefined) window.clearTimeout(timer);
    }
};

/** 音频线程交出来的一份频谱。读它不需要等任何东西。 */
export type SpectrumSnapshot = {
    /*
     * 与 `getByteFrequencyData` 同格式的整条频谱。
     *
     * 泛型要写明 `ArrayBuffer`：光写 `Uint8Array` 在 TS 5.7 之后等于
     * `Uint8Array<ArrayBufferLike>`，比 motionSignals 里那条 `MotionValue`
     * 装的 `Uint8Array<ArrayBuffer>` 宽，写回去会被判类型不符。运行时这里
     * 本来就是 `new Uint8Array(ArrayBuffer)`，标窄才是对的。
     */
    spectrum: Uint8Array<ArrayBuffer>;
    bass: number;
    lowMid: number;
    mid: number;
    vocal: number;
    treble: number;
    /** 这份数据到手的时间（`Date.now()`）。 */
    at: number;
};

type Tap = {
    latest: SpectrumSnapshot | null;
    dispose: () => void;
};

/**
 * FFT 的默认节拍（每多少帧做一次 2048 点 FFT）。
 *
 * `hop = 1024` 在 48kHz 下约合 47 次/秒 —— 正好够播放页按帧读，观感不丢。
 */
const SPECTRUM_DEFAULT_HOP = 1024;
/**
 * 缓冲偏大时改用这个节拍：把「一次输出回调里的 FFT 次数」砍半。
 *
 * 代价是频谱更新掉到约 23 次/秒，只在缓冲真的很大时才付。
 */
const SPECTRUM_RELAXED_HOP = 2048;
/** `outputLatency` 超过这个值就算「缓冲偏大」（`balanced` 够不到，0.1/0.2 那两档一定超）。 */
const SPECTRUM_LARGE_BUFFER_LATENCY_SEC = 0.04;

/**
 * 频谱 FFT 的节拍按**输出缓冲**自适应 —— 「大缓冲就掉帧」那条链的解药。
 *
 * 机制（`AudioWorkletProcessor.process()` 永远按 128 帧调一次）：
 * 底层一次输出回调里要连着跑 `framesPerBuffer / 128` 次 `process()`，缓冲越大，
 * 那几十次就越是**一整块**落在实时优先级线程上；而我们每 `hop` 帧做一次 2048 点
 * FFT，于是「一次回调里的 FFT 次数」= `framesPerBuffer / hop`：
 *
 *   · `balanced`（几十毫秒级）→ 每次回调 1~2 次，随便跑；
 *   · `latencyHint: 0.2`（9600 帧）→ 每次回调 9 次，一整块 4~5ms 的实时线程突发，
 *     正好顶掉 120Hz 下主线程那 8.3ms 的帧预算 → 播放页掉帧（实测过的现象）。
 *
 * ⚠️ 这是**保险**，不是当前问题的解药：现在取的是 `balanced`，`outputLatency` 够不到
 * 阈值，hop 一步都不会变。它的意义是「以后谁想把缓冲拉大，不会再把掉帧带回来」。
 *
 * ⚠️ `outputLatency` 只有在 ctx 真的跑起来之后才有意义，所以这个值必须等
 * `state === 'running'` 之后再算（`createSpectrumTap` 本来就只在那一刻被调用）。
 */
const tapHopFor = (context: AudioContext): number => {
    const latency = typeof context.outputLatency === 'number' ? context.outputLatency : 0;
    return latency >= SPECTRUM_LARGE_BUFFER_LATENCY_SEC ? SPECTRUM_RELAXED_HOP : SPECTRUM_DEFAULT_HOP;
};

let active: Tap | null = null;

/** 最新一份频谱，没接上或还没到手就是 null。调用方拿不到就退回 AnalyserNode。 */
export const readLatestSpectrum = (): SpectrumSnapshot | null => active?.latest ?? null;

/** 这一路接上没有。只想问「有没有」而不是取数据时用它。 */
export const hasSpectrumTap = (): boolean => active !== null;

export const disposeSpectrumTap = (): void => {
    active?.dispose();
    active = null;
    // 换歌 / 重建图会走到这里：新的那条还没接上，先退回"还不知道"，别把上一首的结果留着。
    noteSpectrumSource('unknown');
};

/**
 * 把频谱抽取挂到 `source` 上（图里挂在 analyser 之后，拿到的就是同一份信号）。
 *
 * 返回 false 表示这条路没走通 —— 已经把自己收拾干净，调用方照旧用 AnalyserNode 就行。
 */
export const createSpectrumTap = async (
    context: AudioContext,
    source: AudioNode,
    options?: { fftSize?: number; smoothingTimeConstant?: number; hop?: number },
): Promise<boolean> => {
    if (typeof AudioWorkletNode === 'undefined' || !context.audioWorklet) {
        noteSpectrumSource('analyser', '这台机器上没有 AudioWorklet');
        // 这一条以前只写诊断不进日志，界面没开开发者选项就完全看不见 —— 而它恰恰是
        // 「取频谱一直在等音频线程」的另一半原因，必须留痕。
        console.warn('[SpectrumTap] 这台机器上没有 AudioWorklet，退回 AnalyserNode');
        return false;
    }

    let url: string | null = null;
    let node: AudioWorkletNode | null = null;
    let mute: GainNode | null = null;
    try {
        // Blob 而不是打包出来的文件：addModule 要的是加载时就能跑的脚本，走打包器那条路在
        // 安卓 WebView 上拿到的经常是没编译过的 URL。见 spectrumWorkletSource 的注释。
        url = URL.createObjectURL(new Blob([SPECTRUM_WORKLET_SOURCE], { type: 'application/javascript' }));
        await addModuleWithTimeout(context, url);

        // 缓冲多大决定 hop（见 tapHopFor）；顺手把它记下来 —— 这条日志一出，
        // 「现在跑在哪一档、一次回调里攒几次 FFT」就不用猜了。
        const hop = options?.hop ?? tapHopFor(context);
        const outputLatencySec = typeof context.outputLatency === 'number' ? context.outputLatency : 0;

        node = new AudioWorkletNode(context, SPECTRUM_WORKLET_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
                fftSize: options?.fftSize ?? 2048,
                smoothingTimeConstant: options?.smoothingTimeConstant ?? 0.6,
                hop,
            },
        });
        // processor 本来就不写输出（静音），再串一个零增益是双保险：这一路只抽频谱。
        mute = context.createGain();
        mute.gain.value = 0;
        source.connect(node);
        node.connect(mute);
        mute.connect(context.destination);

        const tap: Tap = { latest: null, dispose: () => undefined };
        node.port.onmessage = (event: MessageEvent) => {
            const data = event.data as { spectrum?: ArrayBuffer; bands?: ArrayBuffer } | null;
            if (!data?.spectrum || !data.bands) return;
            const bands = new Float32Array(data.bands);
            tap.latest = {
                spectrum: new Uint8Array(data.spectrum),
                bass: bands[0] ?? 0,
                lowMid: bands[1] ?? 0,
                mid: bands[2] ?? 0,
                vocal: bands[3] ?? 0,
                treble: bands[4] ?? 0,
                at: Date.now(),
            };
        };
        tap.dispose = () => {
            try {
                node?.port.postMessage('stop');
            } catch {
                // 音频线程已经不在了。
            }
            node?.disconnect();
            mute?.disconnect();
            node = null;
            mute = null;
        };

        // 换歌 / 重建图时可能已经有上一个：先收拾旧的，别让两个 processor 一起跑。
        disposeSpectrumTap();
        active = tap;
        noteSpectrumSource('worklet');
        /*
         * 留一条日志：这条路只有**失败**时才会出声（下面那个 catch），成功是静默的 ——
         * 于是翻日志的人分不清「接上了」和「addModule 的 Promise 卡在 suspended 的
         * context 上、既没成也没败」。后者正是播放页掉帧的样子。
         */
        console.info(
            '[SpectrumTap] 频谱由音频线程抽，主线程不再等音频线程',
            `(hop ${hop} ≈ ${Math.round((context.sampleRate / hop) * 10) / 10} 次/秒,`,
            `outputLatency ${Math.round(outputLatencySec * 1000)}ms)`,
        );
        return true;
    } catch (error) {
        // 记进诊断再 warn：这一条决定了播放页是不是会掉帧，光靠日志看不出来。
        noteSpectrumSource('analyser', error);
        console.warn('[SpectrumTap] 音频线程取频谱这条路没走通，退回 AnalyserNode：', error);
        node?.disconnect();
        mute?.disconnect();
        return false;
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
};
