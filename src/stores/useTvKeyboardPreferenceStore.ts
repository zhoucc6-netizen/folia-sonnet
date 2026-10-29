import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

// src/stores/useTvKeyboardPreferenceStore.ts
// 电视上输入走哪一套：应用内虚拟键盘（默认）还是电视自己的输入法。
//
// 为什么需要一个开关：一部分安卓电视（尤其国产 ROM）自带能用的输入法，甚至带语音——那种机器上
// 我们的键盘反而把系统输入法挡掉了。反过来，没有输入法的电视必须用我们这层，否则输入框点了没反应。
// 默认走应用内键盘，因为「没有输入法」是更常见的坏情况；有输入法的人可以在设置里换回来。

const TV_KEYBOARD_OFF_KEY = 'folia_tv_keyboard_off';

export type TvKeyboardPreferenceState = {
    /** true = 用电视系统输入法，不弹应用内键盘。 */
    useSystemIme: boolean;
    setUseSystemIme: (value: boolean) => void;
};

export const useTvKeyboardPreferenceStore = create<TvKeyboardPreferenceState>(set => ({
    useSystemIme: getStoredBoolean(TV_KEYBOARD_OFF_KEY, false),
    setUseSystemIme: (value) => {
        setStoredBoolean(TV_KEYBOARD_OFF_KEY, value);
        set({ useSystemIme: value });
    },
}));
