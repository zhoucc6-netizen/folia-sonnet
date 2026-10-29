// test/unit/utils/playerSwipeGesture.test.ts
// 播放页左右滑动切歌的判定。
//
// 这条手势的两种坏结果都只在真机上才看得见（该切没切 / 不该切乱切），而真机一轮
// 反馈要一次打包，所以判定抽成了纯函数在这里钉住。

import { describe, expect, it } from 'vitest';
import {
    PLAYER_SWIPE_AXIS_RATIO,
    PLAYER_SWIPE_TRIGGER_PX,
    resolvePlayerSwipe,
} from '../../../src/utils/playerSwipeGesture';

describe('resolvePlayerSwipe', () => {
    it('左滑切下一首', () => {
        expect(resolvePlayerSwipe({ x: 200, y: 400 }, { x: 100, y: 405 })).toBe('next');
    });

    it('右滑切上一首', () => {
        expect(resolvePlayerSwipe({ x: 100, y: 400 }, { x: 200, y: 395 })).toBe('prev');
    });

    it('没划够阈值不算数', () => {
        const short = PLAYER_SWIPE_TRIGGER_PX - 1;
        expect(resolvePlayerSwipe({ x: 200, y: 400 }, { x: 200 - short, y: 400 })).toBeNull();
    });

    it('正好划到阈值就算数', () => {
        expect(resolvePlayerSwipe({ x: 200, y: 400 }, { x: 200 - PLAYER_SWIPE_TRIGGER_PX, y: 400 })).toBe('next');
    });

    it('纵向为主时不算数', () => {
        // 竖着划一下看歌词，手抖带出来几 px 横向位移不该切歌。
        expect(resolvePlayerSwipe({ x: 200, y: 200 }, { x: 200 - PLAYER_SWIPE_TRIGGER_PX, y: 200 - 200 })).toBeNull();
    });

    it('斜着划但横向压过比例就算数', () => {
        const deltaY = 40;
        // 同时要压过阈值和横纵比：斜着划的时候两个条件都得成立。
        const deltaX = Math.max(PLAYER_SWIPE_TRIGGER_PX, Math.ceil(deltaY * PLAYER_SWIPE_AXIS_RATIO) + 1);
        expect(resolvePlayerSwipe({ x: 300, y: 300 }, { x: 300 - deltaX, y: 300 + deltaY })).toBe('next');
    });

    it('正上方 / 正下方纯纵向位移不算数', () => {
        expect(resolvePlayerSwipe({ x: 300, y: 300 }, { x: 300, y: 500 })).toBeNull();
        expect(resolvePlayerSwipe({ x: 300, y: 300 }, { x: 300, y: 100 })).toBeNull();
    });

    it('原地点击不算数', () => {
        expect(resolvePlayerSwipe({ x: 300, y: 300 }, { x: 300, y: 300 })).toBeNull();
    });
});
