import { useCallback, useEffect, useState } from 'react';
import { isCapacitorAndroid } from '../platform/runtime';
import {
  getUpdateCenterState,
  ignoreUpdateVersion,
  isUpdateVersionIgnored,
  requestUpdateCheck,
} from '../services/appUpdateCenter';

// src/hooks/useStartupUpdatePrompt.ts
// 启动后的自动更新提示：拉一次版本清单，有新版本就弹窗让用户下载 / 安装。
//
// 只在安卓跑 —— 桌面端那套走 electron-updater（主进程里查、下载、重启安装），
// 用不着这里；这里的清单下载 / 原生下载 / 系统安装器全是 Capacitor 那条路。
//
// 三个刻意的选择：
//   · 启动先缓 STARTUP_DELAY_MS 一拍。刚起来那一下网络可能还没就绪（WebView 冷启动 +
//     MediaStore 扫描在抢），立刻查容易拿到一个假的失败；也避免和后面的引导弹窗一起糊上来。
//   · 有别的大弹窗开着就等。博物馆里同时开两个 alert 只会让人不知道该先关谁 ——
//     判定直接看 DOM 上有没有 ThemedDialog 的遮罩，比在几个 hook 之间传状态简单也准。
//   · 失败静默。检查不到更新是常态（CDN 抽风、离线），这个时候弹个错误属于添堵 ——
//     「没有更新」和「查不到更新」对用户是同一个结果，想查的人去设置页手点。
//
// 「忽略此版本」写 localStorage：忽略了 0.7.19，出 0.7.20 时照样会提示。
// 它只关自动提示，设置页里那个卡片仍然能手动装。

const STARTUP_DELAY_MS = 4_000;
const BUSY_RETRY_MS = 1_500;
const MAX_BUSY_RETRIES = 20;

export const useStartupUpdatePrompt = () => {
    const [isPromptOpen, setIsPromptOpen] = useState(false);

    useEffect(() => {
        if (!isCapacitorAndroid()) return undefined;
        let disposed = false;
        let timer: number | undefined;

        const evaluate = (version: string | null) => {
            if (!version) return;
            if (isUpdateVersionIgnored(version)) return;
            setIsPromptOpen(true);
        };

        const run = async () => {
            try {
                const snapshot = getUpdateCenterState();
                // 用户在设置页已经手点过检查了（在延迟窗口内），就别再拉一遍清单。
                const result = snapshot.result ?? await requestUpdateCheck();
                if (disposed) return;
                if (result.status !== 'update-available') return;
                evaluate(result.release.version);
            } catch {
                // 失败不弹窗，理由见文件头。
            }
        };

        const tick = (attempt: number) => {
            if (disposed || attempt > MAX_BUSY_RETRIES) return;
            if (typeof document !== 'undefined' && document.querySelector('[data-folia-themed-overlay="true"]')) {
                timer = window.setTimeout(() => tick(attempt + 1), BUSY_RETRY_MS);
                return;
            }
            void run();
        };

        timer = window.setTimeout(() => tick(0), STARTUP_DELAY_MS);
        return () => {
            disposed = true;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, []);

    const closePrompt = useCallback(() => setIsPromptOpen(false), []);

    /** 「忽略此版本」：记下版本号，之后这个版本不再自动提示。 */
    const ignoreVersion = useCallback(() => {
        const result = getUpdateCenterState().result;
        if (result && result.status === 'update-available') {
            ignoreUpdateVersion(result.release.version);
        }
        setIsPromptOpen(false);
    }, []);

    return { isPromptOpen, closePrompt, ignoreVersion };
};
