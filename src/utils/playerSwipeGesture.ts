// src/utils/playerSwipeGesture.ts
// 歌词页左右滑动切歌的几何常量与判定。
//
// 抽成纯函数只有一个理由：这条手势最容易出的问题是「该切没切」和「不该切乱切」，
// 两种都只有真机上才看得见，而真机反馈一轮要一次打包。判定不依赖 DOM 也不依赖
// React，放在这里就能直接单测（vitest 只收 test/unit/**/*.test.ts，组件层测不到）。

/** 触发阈值，px。划够这么远就切，不用等松手。 */
export const PLAYER_SWIPE_TRIGGER_PX = 56;

/**
 * 横向主导比例。横向位移必须比纵向大这么多倍才算数。
 *
 * 歌词页里 Monet 的歌词轨是纵向 touchmove（它自己 touchAction: none），
 * 没有这个约束的话「竖着划一下看歌词」会在手抖时切歌。
 */
export const PLAYER_SWIPE_AXIS_RATIO = 1.2;

/** 一次手势里最多触发一次，之后手指再怎么动都不管。 */
export type PlayerSwipeDirection = 'next' | 'prev';

export interface PlayerSwipePoint {
    x: number;
    y: number;
}

/**
 * 左滑（手指往左，deltaX < 0）→ 下一首；右滑 → 上一首。
 * 与队列的顺序一致：往左是「往后面的歌走」。
 */
export function resolvePlayerSwipe(start: PlayerSwipePoint, end: PlayerSwipePoint): PlayerSwipeDirection | null {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    if (Math.abs(deltaX) < PLAYER_SWIPE_TRIGGER_PX) return null;
    if (Math.abs(deltaX) <= Math.abs(deltaY) * PLAYER_SWIPE_AXIS_RATIO) return null;
    return deltaX < 0 ? 'next' : 'prev';
}
