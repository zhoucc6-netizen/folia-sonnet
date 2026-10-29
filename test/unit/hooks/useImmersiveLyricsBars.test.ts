import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/hooks/useImmersiveLyricsBars.test.ts
// 系统栏的规则：**默认显示，只有可视化歌词页面隐藏。**
// 锁两件事：① 只有 player 视图才隐藏；② 非 Capacitor Android 运行时完全不碰原生桥。

const setNativeImmersiveMock = vi.hoisted(() => vi.fn(async (_immersive: boolean) => { }));
const isCapacitorAndroidMock = vi.hoisted(() => vi.fn(() => true));

// 与既有 hook 测试同一套路：不引入 testing-library，把 useEffect 变成同步执行。
vi.mock('react', () => ({
    useEffect: (effect: () => void) => {
        effect();
    },
}));

vi.mock('@/platform/foliaNative', () => ({
    setNativeImmersive: (immersive: boolean) => setNativeImmersiveMock(immersive),
}));

vi.mock('@/platform/runtime', () => ({
    isCapacitorAndroid: () => isCapacitorAndroidMock(),
}));

const useImmersiveLyricsBars = (await import('@/hooks/useImmersiveLyricsBars')).useImmersiveLyricsBars;

describe('useImmersiveLyricsBars', () => {
    beforeEach(() => {
        setNativeImmersiveMock.mockClear();
        isCapacitorAndroidMock.mockReturnValue(true);
    });

    it('播放页隐藏系统栏', () => {
        useImmersiveLyricsBars('player');
        expect(setNativeImmersiveMock).toHaveBeenCalledWith(true);
    });

    it('离开播放页就把状态栏放回来', () => {
        useImmersiveLyricsBars('home');
        expect(setNativeImmersiveMock).toHaveBeenCalledWith(false);
    });

    it('拼贴墙同样是显示状态栏', () => {
        useImmersiveLyricsBars('lattice');
        expect(setNativeImmersiveMock).toHaveBeenCalledWith(false);
    });

    it('非 Capacitor Android 上完全不调用原生桥', () => {
        isCapacitorAndroidMock.mockReturnValue(false);
        useImmersiveLyricsBars('player');
        expect(setNativeImmersiveMock).not.toHaveBeenCalled();
    });
});
