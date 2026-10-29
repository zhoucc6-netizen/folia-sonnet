// src/utils/renderPixelRatio.ts
// 渲染分辨率上限：把 `window.devicePixelRatio` 夹到一个档位，让画布的后备缓冲区按更少的物理
// 像素分配 —— 低配机与高分屏上这是最直接的一刀。
//
// 播放页的可视化、歌词层、海报墙、书架舞台的 canvas 全部按 devicePixelRatio 算后备缓冲区尺寸
// （见 useMediaQuery、fume / pendolo / cadenza 各自的 stage、lattice 的运行时），所以在窗口这
// 一层夹住它，等于给「渲染分辨率」装了一个总闸：2× 屏上从 2 降到 1，像素数直接少四分之三。
//
// 只影响 JS 侧读到的 devicePixelRatio。窗口自身的 CSS 尺寸、系统截图、视频导出要的是真实设备
// 像素比，那些地方走 `getNativeDevicePixelRatio()`，不受这里的限制影响。
//
// 和 frameRateLimiter 一样是模块级单例：canvas 每帧都要读它，没有理由让它们订阅 store。

import type { RenderPixelRatio } from '../types';

export const RENDER_PIXEL_RATIO_STORAGE_KEY = 'render_pixel_ratio';

/**
 * 可选上限。
 *
 * `1` 是「按物理像素画」：高分屏默认就是 2×，所以选 1 已经把画布像素砍到四分之一；
 * `0.5` / `0.75` 留给真的画不动的机器（字会变软，但先能跑）；`1.25` / `1.5` / `2` 是
 * 「只想省一点」和「3× 手机屏压到 2×」的中间档。
 */
export const RENDER_PIXEL_RATIO_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const satisfies readonly RenderPixelRatio[];

/** 打开开关时落在哪一档：1× 在 2× 屏上立刻能看到像素数少四分之三，是「省性能」最直观的一档。 */
export const DEFAULT_RENDER_PIXEL_RATIO: RenderPixelRatio = 1;

export const isRenderPixelRatio = (value: unknown): value is RenderPixelRatio => (
    typeof value === 'number' && (RENDER_PIXEL_RATIO_OPTIONS as readonly number[]).includes(value)
);

/** 没存过（或存坏了）表示「跟随屏幕」：不夹，直接用真实 dpr。 */
export const parseRenderPixelRatio = (value: string | null): RenderPixelRatio | null => {
    if (!value || value === 'off') {
        return null;
    }

    const parsed = Number(value);
    return isRenderPixelRatio(parsed) ? parsed : null;
};

export const readStoredRenderPixelRatio = (): RenderPixelRatio | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        return parseRenderPixelRatio(window.localStorage.getItem(RENDER_PIXEL_RATIO_STORAGE_KEY));
    } catch {
        return null;
    }
};

/** 夹过之后的像素比：只会变小，不会变大。 */
export const resolveRenderPixelRatio = (nativePixelRatio: number, limit: RenderPixelRatio | null): number => {
    const native = Number.isFinite(nativePixelRatio) && nativePixelRatio > 0 ? nativePixelRatio : 1;
    return limit === null ? native : Math.min(native, limit);
};

// 模块级状态：画布每帧都要读 dpr，没有理由让它们订阅 store 或事件。
let renderPixelRatioLimit: RenderPixelRatio | null = null;
/** 原生属性如果本来就在 window 上，关掉开关时要原样装回去（见 removePatchedGetter）。 */
let nativeOwnDescriptor: PropertyDescriptor | null = null;
let nativeDevicePixelRatio: (() => number) | null = null;
let patchedGetter: (() => number) | null = null;
let lastEffectiveRatio = 0;

/**
 * 真实 dpr 的读取器。
 *
 * 夹过之后 `window.devicePixelRatio` 是我们自己的属性，不能再把它当「真实值」，所以装补丁之前
 * 先在 window 上收好原生 getter（Chromium 把它装成自有访问器）。找不到原生 getter（非浏览器
 * 环境）就退回调用那一刻的数值 —— 那种情况下 dpr 本来也不会随显示器变化。
 */
const captureNativeDevicePixelRatioGetter = (): (() => number) => {
    // Chromium 把 devicePixelRatio 装成 window 自己的访问器，所以先看自有属性 —— 装上补丁之后
    // 自有属性就是我们自己，这条分支自然跳过，不会把自己当原生值。
    const own = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    if (own && typeof own.get === 'function' && own.get !== patchedGetter) {
        nativeOwnDescriptor = own;
        const getter = own.get;
        return () => {
            const value = getter.call(window);
            return Number.isFinite(value) && value > 0 ? value : 1;
        };
    }

    for (let proto = Object.getPrototypeOf(window); proto; proto = Object.getPrototypeOf(proto)) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'devicePixelRatio');
        if (typeof descriptor?.get === 'function') {
            const getter = descriptor.get;
            return () => {
                const value = getter.call(window);
                return Number.isFinite(value) && value > 0 ? value : 1;
            };
        }
    }

    // 装补丁前一定先收好了原生 getter；真走到这里说明环境里压根没有 devicePixelRatio 访问器，
    // 此时读 window.devicePixelRatio 只会读到自己（无限递归），所以直接退回 1。
    if (patchedGetter) {
        return () => 1;
    }

    const captured = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    return () => captured;
};

const readNativeDevicePixelRatio = (): number => {
    nativeDevicePixelRatio ??= captureNativeDevicePixelRatioGetter();
    return nativeDevicePixelRatio();
};

/**
 * 真实设备像素比，夹过之后仍然拿得到。
 *
 * 视频导出、原生截图、窗口物理尺寸这类要按屏幕真实像素算的地方用它：它们算的是窗口的外框，
 * 和「画多少像素」无关，跟着上限走会得到错的尺寸。
 */
export const getNativeDevicePixelRatio = (): number => (
    typeof window === 'undefined' ? 1 : readNativeDevicePixelRatio()
);

/** 当前的限制档位；null = 跟随屏幕。 */
export const getRenderPixelRatioLimit = (): RenderPixelRatio | null => renderPixelRatioLimit;

/** 当前实际生效的像素比（已经夹过）。 */
export const getEffectiveRenderPixelRatio = (): number => (
    typeof window === 'undefined' ? 1 : resolveRenderPixelRatio(readNativeDevicePixelRatio(), renderPixelRatioLimit)
);

const listeners = new Set<() => void>();

/** 档位变化后通知：`useDevicePixelRatio` 用它重读像素比，靠它重排 canvas 的消费者才能跟上。 */
export const subscribeRenderPixelRatio = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const installPatchedGetter = () => {
    if (patchedGetter) {
        return;
    }

    // 先收好原生 getter，再覆盖：覆盖之后 window 上的就是我们的属性了。
    nativeDevicePixelRatio ??= captureNativeDevicePixelRatioGetter();
    patchedGetter = () => resolveRenderPixelRatio(readNativeDevicePixelRatio(), renderPixelRatioLimit);
    Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        get: patchedGetter,
    });
};

/** 只动自己的属性：OBS 图层那一套页面也会改写这个 getter，不能顺手把人家的删了。 */
const removePatchedGetter = () => {
    if (!patchedGetter) {
        return;
    }

    if (Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')?.get === patchedGetter) {
        if (nativeOwnDescriptor) {
            // 原生属性本来就在 window 上：删掉补丁等于把 window.devicePixelRatio 变成
            // undefined（原型链上没有兜底的 getter），所以要把原生描述符原样装回去。
            Object.defineProperty(window, 'devicePixelRatio', nativeOwnDescriptor);
        } else {
            Reflect.deleteProperty(window, 'devicePixelRatio');
        }
    }
    patchedGetter = null;
};

const notifyRenderPixelRatioChanged = () => {
    listeners.forEach(listener => {
        try {
            listener();
        } catch (error) {
            console.error('[RenderPixelRatio] listener failed:', error);
        }
    });
    // 直接读 `window.devicePixelRatio` 的画布（fume、pendolo、cadenza、lattice……）在 resize
    // 里按新 dpr 重算后备缓冲区 —— 这是唯一能通知到它们的信号，别删。
    window.dispatchEvent(new Event('resize'));
};

/**
 * 换档：立即生效，只做「比真值更小」这一件事。
 *
 * 档位没让实际像素比发生变化时不广播 resize：1× 屏上把上限从 2 调到 1.5 什么都没变，没有必要
 * 让整页重排一次。
 */
export const setGlobalRenderPixelRatio = (limit: RenderPixelRatio | null) => {
    if (typeof window === 'undefined') {
        return;
    }

    if (limit === null && !patchedGetter) {
        renderPixelRatioLimit = null;
        lastEffectiveRatio = getEffectiveRenderPixelRatio();
        return;
    }

    renderPixelRatioLimit = limit;
    if (limit === null) {
        removePatchedGetter();
    } else {
        installPatchedGetter();
    }

    const effective = getEffectiveRenderPixelRatio();
    if (effective === lastEffectiveRatio) {
        return;
    }
    lastEffectiveRatio = effective;
    notifyRenderPixelRatioChanged();
};

/** 启动时按存储里记下的档位装上；没记档位就什么都不做（跟随屏幕）。 */
export const installRenderPixelRatioLimit = () => {
    if (typeof window === 'undefined') {
        return;
    }

    const limit = readStoredRenderPixelRatio();
    if (limit === null) {
        return;
    }

    renderPixelRatioLimit = limit;
    lastEffectiveRatio = getEffectiveRenderPixelRatio();
    installPatchedGetter();
};
