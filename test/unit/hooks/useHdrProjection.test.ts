// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/hooks/useHdrProjectionExit.test.ts
// HDR 投影下「点空白收起界面」的二次确认。
//
// 投到挡风玻璃上时屏幕是反着看的，误触概率比平时高得多，而界面一收反射里就只剩一块
// 黑 —— 连该点哪儿把它叫回来都看不出来。所以那档里要点两次。
//
// 顺带钉住一件事：**确认不铺遮罩**。它只是弹一条提示条，指针事件仍然归视觉层，
// 歌词页的滑动切歌（横向）与拖歌词轨（纵向）都不受影响 —— 这个前提不成立的话，
// 那句「所有滑动的方向不受影响」就废了。这里是行为测试，手势那条路靠不铺任何
// 元素来保证，见 hook 顶上的说明。

const { messages } = vi.hoisted(() => ({ messages: [] as string[] }));

vi.mock('@/stores/useStatusMessageStore', () => ({
    setStatusMessage: (message: { text: string }) => {
        messages.push(message.text);
    },
}));

const { useHdrExitConfirm } = await import('@/hooks/useHdrProjection');
const { HDR_EXIT_CONFIRM_WINDOW_MS } = await import('@/services/hdrProjection');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HINT = '再点一次退出';

let container: HTMLDivElement;
let root: Root;
let confirm: ((action: () => void) => void) | null = null;

const Probe = ({ enabled }: { enabled: boolean }) => {
    confirm = useHdrExitConfirm({ enabled, hint: HINT });
    return null;
};

const mount = async (enabled: boolean) => {
    await act(async () => {
        root.render(createElement(Probe, { enabled }));
    });
};

const tap = (done: { count: number }) => {
    act(() => {
        confirm?.((() => {
            done.count += 1;
        }));
    });
};

beforeEach(() => {
    messages.length = 0;
    confirm = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    container.remove();
    vi.useRealTimers();
});

describe('HDR 投影的二次确认', () => {
    it('HDR 关着：点一次就收，不弹提示', async () => {
        await mount(false);
        const done = { count: 0 };
        tap(done);

        expect(done.count).toBe(1);
        expect(messages).toEqual([]);
    });

    it('HDR 开着：第一次只弹提示，第二次才真的收', async () => {
        await mount(true);
        const done = { count: 0 };

        tap(done);
        expect(done.count).toBe(0);
        expect(messages).toEqual([HINT]);

        tap(done);
        expect(done.count).toBe(1);
        /* 收完就解除 —— 下一次点是新的一轮，不会再顺着「已提示」直接执行。 */
        tap(done);
        expect(done.count).toBe(1);
        expect(messages).toEqual([HINT, HINT]);
    });

    /* 手机在颠、屏幕又是反的：那一下多半是误触，过了窗口就回到「第一次点」。 */
    it('过了确认窗口，第三下又变成「第一次」', async () => {
        vi.useFakeTimers();
        await mount(true);
        const done = { count: 0 };

        tap(done);
        await act(async () => {
            vi.advanceTimersByTime(HDR_EXIT_CONFIRM_WINDOW_MS + 1);
        });
        tap(done);

        expect(done.count).toBe(0);
        expect(messages).toEqual([HINT, HINT]);
    });

    /* 窗口期内连点两下只执行一次：第二下是「确认」，不是又一轮的第一下。 */
    it('窗口期内的第二下不会又攒起一轮', async () => {
        vi.useFakeTimers();
        await mount(true);
        const done = { count: 0 };

        tap(done);
        tap(done);
        expect(done.count).toBe(1);

        await act(async () => {
            vi.advanceTimersByTime(HDR_EXIT_CONFIRM_WINDOW_MS + 1);
        });
        tap(done);
        expect(done.count).toBe(1);
    });
});
