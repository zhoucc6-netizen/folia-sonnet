import { showNativeOverlayNotice, showNativeToast } from '../../platform/foliaNative';
import { isBackgroundRenderSuspended } from '../../utils/backgroundRenderGate';

// src/services/playbackRecovery/backgroundFailureNotice.ts
// 后台播放出错的「说一声」通道：界面没人看时，把失败原因画成一条悬浮提示。
//
// 为什么非要原生这条路：Web 层的提示条是页面里的一个节点，退到后台后那块画面根本没渲染
// （rAF 被总闸拦掉），回到前台才会看到一条迟到的消息 —— 用户在那之前只感觉到「放着放着
// 就没声了」。
//
// 首选是**自己画**的悬浮条（FoliaOverlayNotice）：它照着 Web 那条提示的样子来 —— 圆角、
// 一行字、贴屏幕下边（画在别的应用上面时，压住别人顶部的状态栏比压住底部手势条更碍事）。
// 走系统 Toast 是退路：Android 11 起后台只让弹纯文本的 Toast，画不出上面那副样子；
// 而悬浮窗要先有「显示在其他应用上层」的授权，没给就退回 Toast。
//
// 只有 Android 上、且界面确实不可见时才弹。前台照旧走页面里的提示条，那是更安静的选择。

/** 同样一句话在这个窗口内不重复弹：连着几首都放不出来时，气泡不该一次盖一次地刷屏。 */
const DEDUPE_WINDOW_MS = 4000;

/** 悬浮条挂多久。与去重窗口同长：这句话在窗口内不会再弹，正好占满它。 */
const OVERLAY_DURATION_MS = 4000;

let lastText = '';
let lastShownAt = 0;

/**
 * 界面现在是不是没人看。
 *
 * 两个来源取或：`document.visibilityState` 覆盖桌面端切标签页与安卓上的兜底；渲染总闸的
 * 状态覆盖安卓原生那条路（Activity onStop —— 下拉通知栏、切多任务时画面还露着，那时不算
 * 后台，不该走气泡）。
 */
export const isPlaybackInterfaceHidden = (): boolean => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
    return isBackgroundRenderSuspended();
};

/**
 * 后台弹一条提示。不在后台、不是安卓、或这句话刚弹过：什么都不做。
 *
 * 先试悬浮条，挂不上去（没授权 / 老包 / 桥没起来）再退回系统 Toast —— 换更好看的通道
 * 不该让「放不出来」这件事反而说不出口。两条都失败就静默：提示没弹出来不该影响播放
 * 本身，更不该把一次错误处理变成一次异常。
 *
 * 不带按钮：后台是**自动**跳过，屏幕上没有手可以点它。
 */
const presentNotice = async (text: string): Promise<void> => {
    const shown = await showNativeOverlayNotice(text, { durationMs: OVERLAY_DURATION_MS });
    if (shown) return;
    await showNativeToast(text, { long: true });
};

export const notifyBackgroundPlaybackNotice = (text: string): void => {
    if (!text) return;
    if (!isPlaybackInterfaceHidden()) return;
    const now = Date.now();
    if (text === lastText && now - lastShownAt < DEDUPE_WINDOW_MS) return;
    lastText = text;
    lastShownAt = now;
    void presentNotice(text);
};

/** 测试用：清掉去重记录。 */
export const resetBackgroundPlaybackNoticeDedupe = (): void => {
    lastText = '';
    lastShownAt = 0;
};
