/**
 * 频谱抽取 worklet 的源码（纯 JS，运行时以 Blob URL 加载）。
 *
 * 为什么是字符串而不是一个 `.worklet.ts` 文件：`audioWorklet.addModule()` 要的是一个
 * **加载时就能跑**的脚本 —— 打包器对 worker 的那套处理（new URL + ?worker）是给
 * `new Worker()` 用的，对 addModule 没有等价的稳妥路径，安卓 WebView 上尤其容易拿到
 * 一个没被编译过的 URL。做成字符串 + Blob 就不依赖任何打包配置，代价只是里面不能写 TS。
 *
 * 这个 processor 干的事和 AnalyserNode 内部完全一样（Blackman 窗 → FFT → 幅度 → 时域平滑
 * → dB → 0..255），连默认参数都照抄（-100..-30 dB、smoothingTimeConstant 从外面传），
 * 好让切过来之后可视化的**观感不变** —— 换一条路不等于换一套亮度。
 *
 * 关键差别只有一处：它在**音频线程**里算完，把结果 post 出来；主线程那一侧只是读走最新
 * 的一份，永远不调用任何会等音频线程的 Web Audio 方法。
 */
export const SPECTRUM_WORKLET_SOURCE = `
const BANDS = [[20, 150], [150, 400], [400, 1200], [1000, 3500], [3500, 12000]];

class SpectrumTapProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const given = (options && options.processorOptions) || {};
        this.fftSize = given.fftSize || 2048;
        this.tau = typeof given.smoothingTimeConstant === 'number' ? given.smoothingTimeConstant : 0.6;
        this.hop = given.hop || 1024;
        this.minDb = -100;
        this.maxDb = -30;

        const n = this.fftSize;
        this.n = n;
        this.half = n >> 1;
        this.re = new Float32Array(n);
        this.im = new Float32Array(n);
        this.ring = new Float32Array(n);
        this.write = 0;
        this.sinceLast = 0;
        this.smoothed = new Float32Array(this.half);

        // Blackman（Blink 的 RealtimeAnalyser 用的就是它）。
        const alpha = 0.16;
        const a0 = 0.5 * (1 - alpha);
        const a1 = 0.5;
        const a2 = 0.5 * alpha;
        const window = new Float32Array(n);
        for (let i = 0; i < n; i += 1) {
            window[i] = a0
                - a1 * Math.cos((2 * Math.PI * i) / n)
                + a2 * Math.cos((4 * Math.PI * i) / n);
        }
        this.window = window;

        this.bitrev = this.buildBitRev(n);
        // 每个频点代表多少赫兹：可视化的频段划分按 Hz 写，得换算成频点下标。
        this.binWidth = sampleRate / n;
        this.bands = BANDS;
        this.alive = true;
        this.port.onmessage = (event) => {
            if (event.data === 'stop') this.alive = false;
        };
    }

    buildBitRev(n) {
        const bits = Math.round(Math.log(n) / Math.LN2);
        const rev = new Uint32Array(n);
        for (let i = 0; i < n; i += 1) {
            let r = 0;
            for (let b = 0; b < bits; b += 1) r = (r << 1) | ((i >> b) & 1);
            rev[i] = r;
        }
        return rev;
    }

    fft(re, im) {
        const n = this.n;
        const rev = this.bitrev;
        for (let i = 0; i < n; i += 1) {
            const j = rev[i];
            if (i < j) {
                let t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const ang = (-2 * Math.PI) / len;
            const wr = Math.cos(ang);
            const wi = Math.sin(ang);
            const half = len >> 1;
            for (let i = 0; i < n; i += len) {
                let cr = 1;
                let ci = 0;
                for (let k = 0; k < half; k += 1) {
                    const ar = re[i + k];
                    const ai = im[i + k];
                    const br = re[i + k + half];
                    const bi = im[i + k + half];
                    const vr = br * cr - bi * ci;
                    const vi = br * ci + bi * cr;
                    re[i + k] = ar + vr;
                    im[i + k] = ai + vi;
                    re[i + k + half] = ar - vr;
                    im[i + k + half] = ai - vi;
                    const ncr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = ncr;
                }
            }
        }
    }

    analyse() {
        const n = this.n;
        const half = this.half;
        const re = this.re;
        const im = this.im;
        const ring = this.ring;
        const window = this.window;
        // 环形缓冲里最老的那个样本在 write 处，按时间顺序铺进 FFT 输入。
        for (let i = 0; i < n; i += 1) {
            re[i] = ring[(this.write + i) % n] * window[i];
            im[i] = 0;
        }
        this.fft(re, im);

        const scale = 1 / n;
        const smoothed = this.smoothed;
        const tau = this.tau;
        for (let i = 0; i < half; i += 1) {
            const magnitude = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * scale;
            smoothed[i] = tau * smoothed[i] + (1 - tau) * magnitude;
        }

        const bytes = new Uint8Array(half);
        const range = this.maxDb - this.minDb;
        for (let i = 0; i < half; i += 1) {
            const db = 20 * Math.log10(smoothed[i] + 1e-12);
            const scaled = (255 * (db - this.minDb)) / range;
            bytes[i] = scaled < 0 ? 0 : scaled > 255 ? 255 : scaled;
        }

        const out = new Float32Array(this.bands.length);
        for (let b = 0; b < this.bands.length; b += 1) {
            let start = Math.floor(this.bands[b][0] / this.binWidth);
            let end = Math.floor(this.bands[b][1] / this.binWidth);
            if (start < 0) start = 0;
            if (end > half - 1) end = half - 1;
            let sum = 0;
            let count = 0;
            for (let i = start; i <= end; i += 1) {
                sum += bytes[i];
                count += 1;
            }
            out[b] = count > 0 ? sum / count : 0;
        }

        this.port.postMessage(
            { spectrum: bytes.buffer, bands: out.buffer, bins: half },
            [bytes.buffer, out.buffer],
        );
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return this.alive;
        const channel = input[0];
        if (!channel) return this.alive;

        let peak = 0;
        for (let i = 0; i < channel.length; i += 1) {
            const v = channel[i];
            const a = v < 0 ? -v : v;
            if (a > peak) peak = a;
        }
        // 静音（暂停 / 这一段没有信号）：直接回去，别白烧音频线程 —— 一秒四十几次 2048 点
        // FFT 不算便宜，而没人看频谱的时候它一文不值。
        if (peak < 1e-6) return this.alive;

        for (let i = 0; i < channel.length; i += 1) {
            this.ring[this.write] = channel[i];
            this.write = (this.write + 1) % this.n;
            this.sinceLast += 1;
            if (this.sinceLast >= this.hop) {
                this.sinceLast = 0;
                this.analyse();
            }
        }
        // 输出保持静音：这一路只是抽频谱，不该往扬声器等一份声音。
        return this.alive;
    }
}

registerProcessor('folia-spectrum-tap', SpectrumTapProcessor);
`;

/** 与 AudioWorkletNode 那边的 registerProcessor 名字对应。 */
export const SPECTRUM_WORKLET_NAME = 'folia-spectrum-tap';
