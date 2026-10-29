// src/hooks/sleepTimerExpiry.ts
// Runs the platform-specific one-shot expiry action with a playback fallback.

import type { SleepTimerEndAction } from '../services/sleepTimerPlan';

type SleepTimerExpiryOptions = {
    /** 到点之后要干什么。`quit` 之外一律暂停（含不支持退出的平台）。 */
    endAction: SleepTimerEndAction;
    quitApp?: () => Promise<boolean>;
    onFallback: () => void;
};

export const runSleepTimerExpiryAction = async ({ endAction, quitApp, onFallback }: SleepTimerExpiryOptions) => {
    // 「暂停播放」是唯一一定有出路的动作；web 上没有退出这条路，选了退出也退到这里。
    if (endAction !== 'quit' || !quitApp) {
        onFallback();
        return;
    }

    // 退出之前必须先把播放停掉：安卓那边 exitApp 只是销毁 Activity，前台服务还在，
    // 不停的话就是「界面没了歌还在放」。onFallback 正好干这个（顺带弹一条提示）。
    onFallback();

    try {
        await quitApp();
    } catch {
        // 退不出去也已经暂停过了，再走一遍 onFallback 只会把提示刷成「已暂停」的重复版本。
    }
};
