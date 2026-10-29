import type { DualTheme } from '../types';

// src/services/aiThemeApplyBridge.ts
// 把「应用一份主题」这件事递给面板上那颗云同步按钮。
//
// 面板那条链路是 App → PlayerPanel → UnifiedPanel → ControlsTab → ThemeNameRow 一层层
// 往下传 props 的，为这一颗按钮再开一路要动五个文件。而这个动作天然是全局唯一的 ——
// 整个应用只有一份主题控制器，而它就在 App 里 —— 所以这里改成单点登记：
// App 挂上来，面板那颗按钮取走用。没挂上来时（比如还没渲染到 App）返回 false，
// 调用方照常提示，不会静默失败。

type AiThemeApplier = (dualTheme: DualTheme) => void;

let applier: AiThemeApplier | null = null;
let provider: (() => DualTheme | null) | null = null;

export const registerAiThemeApplier = (next: AiThemeApplier | null): void => {
    applier = next;
};

/**
 * 这一侧「当前生效的 AI 主题」从哪来。
 *
 * 要把本机这版**整个**（浅色 + 深色两份）推上去，而面板那一行拿到的只有按当前明暗
 * 挑出来的那一半 —— 推一半上去，别人拉到的就只剩白天或只剩晚上。
 */
export const registerAiThemeProvider = (next: (() => DualTheme | null) | null): void => {
    provider = next;
};

export const readCurrentAiTheme = (): DualTheme | null => {
    try {
        return provider?.() ?? null;
    } catch {
        return null;
    }
};

/** 应用一份主题。返回 false = 这一侧还没人接管（调用方要自己提示）。 */
export const applyAiThemeFromOutside = (dualTheme: DualTheme): boolean => {
    if (!applier) {
        return false;
    }
    applier(dualTheme);
    return true;
};
