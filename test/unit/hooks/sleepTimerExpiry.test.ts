import { describe, expect, it, vi } from 'vitest';
import { runSleepTimerExpiryAction } from '../../../src/hooks/sleepTimerExpiry';

// test/unit/hooks/sleepTimerExpiry.test.ts

describe('sleep timer expiry action', () => {
    it('pauses through the fallback when no desktop quit bridge exists', async () => {
        const onFallback = vi.fn();

        await runSleepTimerExpiryAction({ endAction: 'pause', onFallback });

        expect(onFallback).toHaveBeenCalledOnce();
    });

    /*
     * 退出之前一定先暂停：安卓上 exitApp 只是销毁 Activity，前台服务还活着，
     * 直接退就是「界面没了歌还在放」。所以这条断言的是「暂停过了，并且真的退了」。
     */
    it('pauses before quitting when the desktop app accepts the quit request', async () => {
        const onFallback = vi.fn();
        const quitApp = vi.fn(async () => true);

        await runSleepTimerExpiryAction({
            endAction: 'quit',
            quitApp,
            onFallback,
        });

        expect(onFallback).toHaveBeenCalledOnce();
        expect(quitApp).toHaveBeenCalledOnce();
    });

    it('falls back to pausing when quitting is rejected or fails', async () => {
        const rejectedFallback = vi.fn();
        const failedFallback = vi.fn();

        await runSleepTimerExpiryAction({
            endAction: 'quit',
            quitApp: vi.fn(async () => false),
            onFallback: rejectedFallback,
        });
        await runSleepTimerExpiryAction({
            endAction: 'quit',
            quitApp: vi.fn(async () => { throw new Error('ipc unavailable'); }),
            onFallback: failedFallback,
        });

        expect(rejectedFallback).toHaveBeenCalledOnce();
        expect(failedFallback).toHaveBeenCalledOnce();
    });
});
