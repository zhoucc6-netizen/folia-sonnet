import {
  checkForAppUpdate,
  downloadUpdateApk,
  installUpdateApk,
  type AppUpdateCheckResult,
} from './appUpdate';
import { watchUpdateDownloadProgress } from '../platform/foliaNative';

// src/services/appUpdateCenter.ts
// 应用内更新的**唯一一份状态**：版本清单的检查结果 + 下载阶段，以及「忽略此版本」的记号。
//
// 做成模块级单例而不是 hook 内部 state，是因为状态现在有两个宿主：
//   ① 设置 → 帮助页里的更新卡片；② 启动时自动弹出的更新提示。
// 两边做的是同一件事（拉清单 → 原生下载 → 系统安装器），各拿一份 state 就会分叉：
// 弹窗里点下下载、再到设置页看进度条却是 0%，或者反过来在两个地方同时开两个下载。
// 下载本身是原生的（带进度事件），与应用里哪个界面开着无关，所以状态也应该是跨界面的。
//
// 平台判断不在这里做 —— 桌面端没有这套原生桥，由调用方决定要不要挂载。

/** 「忽略此版本」的记号。只存一个版本号：忽略了 0.7.19，出 0.7.20 时照样会提示。 */
const IGNORED_VERSION_STORAGE_KEY = 'folia_ignored_update_version';

/** 下载阶段。 */
export type UpdateDownloadPhase =
    | { kind: 'idle' }
    | { kind: 'downloading'; receivedBytes: number; totalBytes: number; percent: number }
    | { kind: 'downloaded'; path: string }
    | { kind: 'failed'; message: string };

export type UpdateInstallNotice = 'none' | 'permission-required';

export type UpdateCenterState = {
    /** 最近一次检查结果；从没查过为 null。 */
    result: AppUpdateCheckResult | null;
    isChecking: boolean;
    phase: UpdateDownloadPhase;
    /** `permission-required`：已经把「允许来自此来源的应用」设置页拉起来了。 */
    installNotice: UpdateInstallNotice;
    /** 用户跳过过的版本号；为 null 表示当前没有忽略任何版本。 */
    ignoredVersion: string | null;
};

const readIgnoredVersion = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem(IGNORED_VERSION_STORAGE_KEY);
    } catch {
        // 隐私模式下 localStorage 会直接抛；忽略功能降级成「这次不弹」即可，不该连累整个更新面板。
        return null;
    }
};

let state: UpdateCenterState = {
    result: null,
    isChecking: false,
    phase: { kind: 'idle' },
    installNotice: 'none',
    ignoredVersion: readIgnoredVersion(),
};

const listeners = new Set<() => void>();

/** 快照对象整体替换 —— useSyncExternalStore 靠引用变了才重渲染，局部改字段它会看不见。 */
const setState = (patch: Partial<UpdateCenterState>): void => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
};

export const subscribeUpdateCenter = (listener: () => void): (() => void) => {
    listeners.add(listener);
    ensureProgressWatcher();
    return () => {
        listeners.delete(listener);
    };
};

export const getUpdateCenterState = (): UpdateCenterState => state;

/*
 * 进度监听整个进程只装一次，且装了就不摘 —— 原生那边的下载不会因为某个界面关掉而停，
 * 摘掉监听会让「切到设置页看进度」变成看不到。这里不 retry：桌面端/插件不可用时
 * 下载会失败并给出原因，进度条只是锦上添花。
 */
let progressWatcherInstalled = false;
const ensureProgressWatcher = (): void => {
    if (progressWatcherInstalled) return;
    progressWatcherInstalled = true;
    void watchUpdateDownloadProgress((progress) => {
        // 只在 downloading 阶段收：下完之后原生可能再补一帧旧字节数，会把「下载完成」冲掉。
        if (state.phase.kind !== 'downloading') return;
        setState({
            phase: {
                kind: 'downloading',
                receivedBytes: progress.receivedBytes,
                totalBytes: progress.totalBytes,
                percent: progress.percent,
            },
        });
    }).catch(() => {
        // 桌面端 / 插件不可用：进度条退化成「下载中」。
    });
};

/** 当前清单里那个可安装的包；没有可用更新时为 null。 */
const currentApkTarget = (): { downloadUrl: string; version: string; sizeBytes: number } | null => {
    const result = state.result;
    if (!result || result.status !== 'update-available') return null;
    const apk = result.release.apk;
    if (!apk) return null;
    return { downloadUrl: apk.downloadUrl, version: result.release.version, sizeBytes: apk.sizeBytes };
};

// ---- 检查 ----

/**
 * 在飞的请求只有一个：启动时的自动检查和用户在设置页手点，谁先到谁用同一个结果，
 * 不会把同一份清单拉两遍。
 */
let checkingPromise: Promise<AppUpdateCheckResult> | null = null;

export const requestUpdateCheck = (): Promise<AppUpdateCheckResult> => {
    if (checkingPromise) return checkingPromise;
    const run = async (): Promise<AppUpdateCheckResult> => {
        setState({ isChecking: true });
        try {
            const next = await checkForAppUpdate();
            setState({ result: next, isChecking: false });
            return next;
        } catch (error) {
            setState({ isChecking: false });
            throw error;
        }
    };
    checkingPromise = run().finally(() => {
        checkingPromise = null;
    });
    return checkingPromise;
};

/**
 * 手动「检查更新」。
 *
 * 比自动检查多一步：先把上一次的下载结果清掉 —— 版本已经可能变了，上次那个
 * 「下载完成」不该继续指向旧包。
 */
export const refreshUpdateCheck = async (): Promise<AppUpdateCheckResult> => {
    resetDownloadState();
    return requestUpdateCheck();
};

// ---- 下载 / 安装 ----

export const startUpdateDownload = async (): Promise<void> => {
    const target = currentApkTarget();
    if (!target) return;
    setState({
        installNotice: 'none',
        phase: { kind: 'downloading', receivedBytes: 0, totalBytes: target.sizeBytes, percent: 0 },
    });
    try {
        const outcome = await downloadUpdateApk(target.downloadUrl, target.version);
        setState({ phase: { kind: 'downloaded', path: outcome.path } });
    } catch (error) {
        setState({ phase: { kind: 'failed', message: error instanceof Error ? error.message : 'download-failed' } });
    }
};

export const installDownloadedUpdate = async (): Promise<void> => {
    const phase = state.phase;
    if (phase.kind !== 'downloaded') return;
    try {
        const outcome = await installUpdateApk(phase.path);
        setState({ installNotice: outcome.status === 'permission-required' ? 'permission-required' : 'none' });
    } catch (error) {
        setState({ phase: { kind: 'failed', message: error instanceof Error ? error.message : 'download-failed' } });
    }
};

export const resetDownloadState = (): void => {
    setState({ phase: { kind: 'idle' }, installNotice: 'none' });
};

// ---- 忽略某个版本 ----

/** 这个版本有没有被用户跳过去。只比版本号：出了更新的版本就重新提示。 */
export const isUpdateVersionIgnored = (version: string | null | undefined): boolean => (
    Boolean(version) && state.ignoredVersion === version
);

export const ignoreUpdateVersion = (version: string): void => {
    if (typeof window !== 'undefined') {
        try {
            window.localStorage.setItem(IGNORED_VERSION_STORAGE_KEY, version);
        } catch {
            // 存不下也得让「这次关掉」生效，所以下面的 setState 无论如何都做。
        }
    }
    setState({ ignoredVersion: version });
};
