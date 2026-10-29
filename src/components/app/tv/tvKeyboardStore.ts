import { create } from 'zustand';

// src/components/app/tv/tvKeyboardStore.ts
// 电视虚拟键盘要往哪个输入框里打字。
//
// 只放一个目标元素在 store 里，键盘组件自己去读它的 value 与光标位置 —— 输入框自己的状态仍归
// 输入框的宿主组件所有，这里不复制一份 text，否则两边会不同步（受控组件尤其明显）。

export type TvKeyboardTarget = HTMLInputElement | HTMLTextAreaElement;

export type TvKeyboardState = {
    /** 当前正在为哪个输入框打字；`null` 表示键盘收着。 */
    target: TvKeyboardTarget | null;
    open: (target: TvKeyboardTarget) => void;
    close: () => void;
};

export const useTvKeyboardStore = create<TvKeyboardState>(set => ({
    target: null,
    open: target => set({ target }),
    close: () => set({ target: null }),
}));
