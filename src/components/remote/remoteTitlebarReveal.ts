// src/components/remote/remoteTitlebarReveal.ts
// Pure rule for whether the remote window's top floating control bar should be shown.

export const REMOTE_TITLEBAR_REVEAL_THRESHOLD = 44;

/**
 * 这里只关心那两个开关，所以收成一个窄结构 —— `remoteWindowBridge` 那份
 * `RemoteWindowPresentation` 字段更多，结构化类型照样对得上，不必再定义一份。
 */
export interface RemoteTitlebarPresentation {
    hideTitlebar: boolean;
    clickThrough: boolean;
}

/** The bar shows only when the cursor is near the top and neither "hide bar" nor click-through is on. */
export const shouldRevealRemoteTitlebar = (
    clientY: number,
    presentation: RemoteTitlebarPresentation,
): boolean => {
    if (presentation.hideTitlebar || presentation.clickThrough) {
        return false;
    }
    return clientY <= REMOTE_TITLEBAR_REVEAL_THRESHOLD;
};
