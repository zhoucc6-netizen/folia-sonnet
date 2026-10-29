// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/hdrProjection.test.ts
// 「HDR 投影」那个 5 秒倒计时。
//
// 倒计时只有一个：手动拨开关那一条，与「启动时」共用它 —— 各跑一个的话，启动那一个
// 会在用户已经拨掉之后照样翻一次屏。这几条钉的就是「谁取消都取消的是同一个」
// 以及「数完才生效」。启动时本身**不恢复**开关（见下面那一组）。
//
// 落地效果只验**看得见的那一半**：<html> 上的镜像属性、方向锁那一份落盘、以及推给
// 原生的亮度。原生那半在真机上才有，这里只验「推过去了、推的是对的值」。

const { boostCalls } = vi.hoisted(() => ({ boostCalls: [] as boolean[] }));

vi.mock('@/platform/foliaNative', () => ({
    // 替掉的是 foliaNative 整个模块，所以这里的签名是它导出的那一个（不是插件方法）。
    setDisplayBoost: async (boost: boolean) => {
        boostCalls.push(boost);
    },
    setSystemBarsAlwaysHidden: async () => undefined,
}));

const {
    applyHdrProjection,
    cancelHdrProjectionCountdown,
    disableHdrProjection,
    installHdrProjectionPreference,
    readHdrProjectionCountdown,
    readStoredHdrProjection,
    startHdrProjectionCountdown,
    writeStoredHdrProjection,
} = await import('@/services/hdrProjection');

const ORIENTATION_KEY = 'folia_android_phone_fit_orientation';

const mirrorAttr = (): string | null => document.documentElement.getAttribute('data-folia-mirror');

beforeEach(() => {
    boostCalls.length = 0;
    localStorage.clear();
    document.documentElement.removeAttribute('data-folia-mirror');
    cancelHdrProjectionCountdown();
});

afterEach(() => {
    cancelHdrProjectionCountdown();
    vi.useRealTimers();
});

describe('HDR 投影的倒计时', () => {
    it('数完才生效：这 5 秒里屏幕上什么都还没变', () => {
        vi.useFakeTimers();
        startHdrProjectionCountdown();
        expect(readHdrProjectionCountdown()).toBe(5);

        vi.advanceTimersByTime(4000);
        expect(readHdrProjectionCountdown()).toBe(1);
        expect(mirrorAttr()).toBeNull();
        expect(readStoredHdrProjection()).toBe(false);

        vi.advanceTimersByTime(1000);
        expect(readHdrProjectionCountdown()).toBe(0);
        expect(readStoredHdrProjection()).toBe(true);
        expect(mirrorAttr()).toBe('true');
        expect(localStorage.getItem(ORIENTATION_KEY)).toBe('landscape');
        expect(boostCalls).toEqual([true]);
    });

    /* 取消的是那同一个倒计时 —— 组件上那颗「取消」按的就是这个。 */
    it('取消之后到点也不会再翻屏', () => {
        vi.useFakeTimers();
        startHdrProjectionCountdown();
        cancelHdrProjectionCountdown();

        vi.advanceTimersByTime(10_000);

        expect(readStoredHdrProjection()).toBe(false);
        expect(mirrorAttr()).toBeNull();
        expect(boostCalls).toEqual([]);
    });

    /* 手动拨开关与启动时那一趟撞在一起：后起的那个顶掉前一个，不会数两遍。 */
    it('重复起倒计时只是重新数，不会叠成两个', () => {
        vi.useFakeTimers();
        startHdrProjectionCountdown();
        vi.advanceTimersByTime(3000);
        startHdrProjectionCountdown();
        expect(readHdrProjectionCountdown()).toBe(5);

        vi.advanceTimersByTime(5000);
        expect(boostCalls.filter(Boolean)).toHaveLength(1);
    });
});

describe('HDR 投影的开关两头', () => {
    /* 关掉没有倒计时：亮度顶在那儿刺眼、画面还是反的，等 5 秒毫无意义。 */
    it('关掉立刻还原，不留倒计时', () => {
        writeStoredHdrProjection(true);
        applyHdrProjection(false);

        expect(mirrorAttr()).toBe('false');
        expect(localStorage.getItem(ORIENTATION_KEY)).toBe('portrait');
        expect(readStoredHdrProjection()).toBe(true);
        expect(boostCalls).toEqual([false]);
    });

    /*
     * **不恢复**。这个开关一手管着屏幕方向、整屏镜像和窗口亮度，任何一件在某台机器上
     * 出岔子（早先的色彩模式就是把整屏压成黑的那一件），用户唯一能做的就是重启 ——
     * 一旦自动恢复，重启也回不来，等于把自己锁死在黑屏里。所以重启必须回到关。
     */
    it('启动时一律回到关：上次开着也不恢复，只把上一趟留下的收回去', () => {
        vi.useFakeTimers();
        writeStoredHdrProjection(true);
        installHdrProjectionPreference();

        expect(readStoredHdrProjection()).toBe(false);
        expect(mirrorAttr()).toBe('false');
        // 不排倒计时 —— 也就是不会自己横过去、把亮度顶上去。
        expect(readHdrProjectionCountdown()).toBe(0);

        // 但上一趟落盘的那几样得还：强制横屏那份设置，以及全局的系统亮度。
        expect(localStorage.getItem(ORIENTATION_KEY)).toBe('portrait');
        expect(boostCalls).toEqual([false]);

        vi.advanceTimersByTime(10_000);
        expect(boostCalls).toEqual([false]);
    });

    /*
     * 关掉有两条路（面板那颗开关、HDR 下点两次空白），所以收在同一个出口里 ——
     * 只做一半的话，最典型的后果就是亮度顶在那儿没人还原。
     */
    it('关掉一次做完：掐掉倒计时 + 落盘 + 横屏镜像亮度一起还原', () => {
        vi.useFakeTimers();
        startHdrProjectionCountdown();
        writeStoredHdrProjection(true);
        disableHdrProjection();

        expect(readHdrProjectionCountdown()).toBe(0);
        expect(readStoredHdrProjection()).toBe(false);
        expect(mirrorAttr()).toBe('false');
        expect(localStorage.getItem(ORIENTATION_KEY)).toBe('portrait');
        expect(boostCalls).toEqual([false]);

        // 倒计时被掐掉了，到点也不会再翻一次屏。
        vi.advanceTimersByTime(10_000);
        expect(boostCalls).toEqual([false]);
    });

    /* 用户自己原本就锁着横屏的话，关掉 HDR 该还回横屏 —— 一律按竖屏还等于改了他的设置。 */
    it('关掉时还的是打开前的方向', () => {
        localStorage.setItem(ORIENTATION_KEY, 'landscape');
        void applyHdrProjection(true);
        void applyHdrProjection(false);
        expect(localStorage.getItem(ORIENTATION_KEY)).toBe('landscape');
    });

    it('启动时上次是关着的：不排任何倒计时', () => {
        installHdrProjectionPreference();
        expect(readHdrProjectionCountdown()).toBe(0);
        expect(mirrorAttr()).toBe('false');
        expect(boostCalls).toEqual([]);
    });
});
