import { useState } from 'react';
import { useLingering, useRemotePointerInside } from './remoteWindowBridge';

// src/components/remote/useRemoteIdle.ts
// 遥控窗口「有没有人在用」的判据：指针在窗口里，或者刚离开不久，或者键盘正停在某个控件上。
// 闲置时控制行让位给歌词；再叠上设置里的「展开封面」，卡片才展开成大封面。

/** 指针离开窗口后，还当作「亮着」这么久。fork 原先在控制区上用 800ms 计时，沿用这个节奏。 */
const IDLE_LINGER_MS = 800;

export type UseRemoteIdleParams = {
    /** 鼠标穿透的窗口只是一块显示屏：既不点亮，也不展开封面。 */
    clickThrough: boolean;
    /** 导出 / 透明控制这类面板是「正在操作」，不能闲置。 */
    panelIsPlayback: boolean;
};

export type RemoteIdleState = {
    /** 指针在窗口里、或键盘停在某个控件上。 */
    isLit: boolean;
    /** 没有人操作，卡片可以收成闲置的样子。 */
    isIdle: boolean;
    hasKeyboardFocus: boolean;
    setHasKeyboardFocus: (focused: boolean) => void;
};

/**
 * 判「指针在不在窗口里」走主进程，而不是页面自己的 mouseenter。
 *
 * 整张卡片是拖拽区，Windows 上拖拽区不往页面投鼠标事件 —— 页面自己听的话，
 * 指针停在卡片大部分区域时会被判成「不在窗口里」，控制行凭空消失。
 * 主进程比的是光标屏幕坐标与窗口矩形，不受拖拽区影响。
 */
export const useRemoteIdle = ({ clickThrough, panelIsPlayback }: UseRemoteIdleParams): RemoteIdleState => {
    const pointerInside = useRemotePointerInside(clickThrough);
    const pointerLingers = useLingering(pointerInside, IDLE_LINGER_MS);
    const [hasKeyboardFocus, setHasKeyboardFocus] = useState(false);

    const isDisplayOnly = clickThrough;
    const isLit = !isDisplayOnly && (pointerLingers || hasKeyboardFocus);
    const isIdle = !isLit && panelIsPlayback;

    return { isLit, isIdle, hasKeyboardFocus, setHasKeyboardFocus };
};
