import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState, type SongResult } from '@/types';
import type { PlaybackFailure } from '@/types/playbackFailure';

// test/unit/playback/backgroundFailureSkip.test.ts
// 后台播放出错的两条纪律：
//   1. 不排倒计时 —— 后台的 timer 会被节流甚至整页冻结，「5 秒后自动跳过」可能永远不来。
//   2. 系统气泡要说清原因 —— 界面那会儿没人看，提示条要等回前台才显示。

const showNativeToast = vi.fn();
const showNativeOverlayNotice = vi.fn();
// 悬浮窗有没有「画在别的应用上面」的授权：false 就是用户没给，提示要走系统 Toast。
const overlay = { available: false };
vi.mock('@/platform/foliaNative', () => ({
    showNativeToast: (text: string, options?: { long?: boolean }) => {
        showNativeToast(text, options);
        return Promise.resolve();
    },
    showNativeOverlayNotice: (text: string, options?: { durationMs?: number }) => {
        showNativeOverlayNotice(text, options);
        return Promise.resolve(overlay.available);
    },
}));

const background = { suspended: false };
vi.mock('@/utils/backgroundRenderGate', () => ({
    isBackgroundRenderSuspended: () => background.suspended,
}));

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: { getProviderLabel: () => 'QQ 音乐' },
}));

const { presentPlaybackFailure } = await import('@/components/app/playback/presentPlaybackFailure');
const { resetBackgroundPlaybackNoticeDedupe } = await import('@/services/playbackRecovery/backgroundFailureNotice');

const failure = (reason: PlaybackFailure['reason']): PlaybackFailure => ({ reason, stage: 'resolve-url' });
// 报告里的那首歌（Folium 的 playback.failed）：后台没人看提示条，模组与统计只认这一份报告。
const song: SongResult = { id: '1', name: 'Song 1', artists: [], album: { id: '', name: '' }, durationMs: 1000 };

/**
 * 提示是「先试悬浮条、挂不上再退系统 Toast」，中间隔着一个 await：断言前要把这个
 * 微任务放掉，否则看到的是「还在问悬浮条」那一瞬间。
 */
const settleNotices = (): Promise<void> => new Promise(resolve => {
    setTimeout(resolve, 0);
});

const createHarness = () => {
    const setStatusMsg = vi.fn();
    const setPlayerState = vi.fn();
    const showTimedSkipPrompt = vi.fn();
    const notifyFailure = vi.fn();
    const audio = { pause: vi.fn() };
    const deps = {
        t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key),
        setStatusMsg,
        setPlayerState,
        audioRef: { current: audio },
        shouldAutoPlayRef: { current: true },
        setIsLyricsLoading: vi.fn(),
        showTimedSkipPrompt,
        maxAutoSkipCount: 4,
        notifyFailure,
    };
    return { deps, setStatusMsg, setPlayerState, showTimedSkipPrompt, audio, notifyFailure };
};

describe('presentPlaybackFailure while the interface is in the background', () => {
    beforeEach(() => {
        showNativeToast.mockClear();
        showNativeOverlayNotice.mockClear();
        overlay.available = false;
        background.suspended = true;
        resetBackgroundPlaybackNoticeDedupe();
    });

    it('skips at once instead of starting a countdown, and says why in a toast', async () => {
        const { deps, showTimedSkipPrompt, notifyFailure } = createHarness();
        const skip = vi.fn();
        presentPlaybackFailure({
            failure: failure('preview-only'),
            song,
            context: 'play',
            isCurrent: () => true,
            skipCount: 0,
            skip,
        }, deps);

        expect(skip).toHaveBeenCalledTimes(1);
        expect(showTimedSkipPrompt).not.toHaveBeenCalled();
        // 当场跳走也算「会自动跳」：模组那边只关心这首歌放没放成、接下来会不会换歌。
        expect(notifyFailure).toHaveBeenCalledWith({ song, reason: 'preview-only', phase: 'play', willAutoSkip: true });
        await settleNotices();
        // 没授权时退回系统 Toast：换更好看的通道不该让这句话反而说不出口。
        expect(showNativeOverlayNotice).toHaveBeenCalledTimes(1);
        expect(showNativeToast).toHaveBeenCalledTimes(1);
        expect(showNativeToast.mock.calls[0][0]).toContain('status.songPreviewOnly');
        expect(showNativeToast.mock.calls[0][0]).toContain('status.autoSkippedNext');
    });

    it('says it in the floating bar instead of a system toast when the overlay is allowed', async () => {
        overlay.available = true;
        const { deps } = createHarness();
        const skip = vi.fn();
        presentPlaybackFailure({
            failure: failure('preview-only'),
            song,
            context: 'play',
            isCurrent: () => true,
            skipCount: 0,
            skip,
        }, deps);

        await settleNotices();
        expect(showNativeOverlayNotice).toHaveBeenCalledTimes(1);
        expect(showNativeOverlayNotice.mock.calls[0][0]).toContain('status.songPreviewOnly');
        // 悬浮条挂上去了就不再弹系统 Toast —— 同一句话不该说两遍。
        expect(showNativeToast).not.toHaveBeenCalled();
    });

    it('skips for whole-platform failures too (a preview-only account still wants the next song)', async () => {
        for (const reason of ['not-signed-in', 'session-expired', 'network', 'timeout', 'service-unavailable', 'rate-limited'] as const) {
            showNativeToast.mockClear();
            const { deps } = createHarness();
            const skip = vi.fn();
            presentPlaybackFailure({
                failure: failure(reason),
                song,
                context: 'play',
                isCurrent: () => true,
                skipCount: 0,
                skip,
            }, deps);
            expect(skip, reason).toHaveBeenCalledTimes(1);
            await settleNotices();
            expect(showNativeToast, reason).toHaveBeenCalledTimes(1);
        }
    });

    it('stops after the one-song budget of a whole-platform failure', async () => {
        const { deps, setPlayerState, notifyFailure } = createHarness();
        const skip = vi.fn();
        presentPlaybackFailure({
            failure: failure('session-expired'),
            song,
            context: 'play',
            isCurrent: () => true,
            skipCount: 1,
            skip,
        }, deps);

        // 没登录时跳一首就够了，再跳是在后台一首接一首地空转。
        expect(skip).not.toHaveBeenCalled();
        expect(setPlayerState).toHaveBeenCalledWith(PlayerState.IDLE);
        // 停下来了也要说一声，否则用户连「为什么没声了」都不知道。
        await settleNotices();
        expect(showNativeToast).toHaveBeenCalledTimes(1);
        // 报告同样发一次，但这次不跳 —— 停播与「跳走」对模组是两回事。
        // 报告给模组用的是对外那份代号（OnlineFailureCaseId）：「没登录」与「会话过期」都是 sign-in-needed。
        expect(notifyFailure).toHaveBeenCalledWith({ song, reason: 'sign-in-needed', phase: 'play', willAutoSkip: false });
    });

    it('keeps going through several broken songs when each one is its own problem', () => {
        const { deps } = createHarness();
        const skip = vi.fn();
        presentPlaybackFailure({
            failure: failure('preview-only'),
            song,
            context: 'play',
            isCurrent: () => true,
            skipCount: 3,
            skip,
        }, deps);
        expect(skip).toHaveBeenCalledTimes(1);
    });

    it('does not skip a request that has already been superseded', () => {
        const { deps, notifyFailure } = createHarness();
        const skip = vi.fn();
        presentPlaybackFailure({
            failure: failure('preview-only'),
            song,
            context: 'play',
            isCurrent: () => false,
            skipCount: 0,
            skip,
        }, deps);
        expect(skip).not.toHaveBeenCalled();
        // 陈旧请求同样不报告：用户没看到这次失败。
        expect(notifyFailure).not.toHaveBeenCalled();
    });

    it('does not repeat the same message within the dedupe window', async () => {
        const skip = vi.fn();
        const input = { failure: failure('preview-only'), song, context: 'play' as const, isCurrent: () => true, skipCount: 0, skip };
        presentPlaybackFailure(input, createHarness().deps);
        presentPlaybackFailure(input, createHarness().deps);
        await settleNotices();
        expect(showNativeToast).toHaveBeenCalledTimes(1);
        expect(showNativeOverlayNotice).toHaveBeenCalledTimes(1);
    });
});

describe('presentPlaybackFailure while the interface is visible', () => {
    beforeEach(() => {
        showNativeToast.mockClear();
        showNativeOverlayNotice.mockClear();
        overlay.available = false;
        background.suspended = false;
        resetBackgroundPlaybackNoticeDedupe();
    });

    it('counts down and leaves the toast alone', async () => {
        const { deps, showTimedSkipPrompt, setPlayerState } = createHarness();
        const skip = vi.fn();
        presentPlaybackFailure({
            failure: failure('preview-only'),
            song,
            context: 'play',
            isCurrent: () => true,
            skipCount: 0,
            skip,
        }, deps);

        expect(showTimedSkipPrompt).toHaveBeenCalledTimes(1);
        expect(skip).not.toHaveBeenCalled();
        await settleNotices();
        expect(setPlayerState).not.toHaveBeenCalled();
        expect(showNativeToast).not.toHaveBeenCalled();
        expect(showNativeOverlayNotice).not.toHaveBeenCalled();
    });
});
