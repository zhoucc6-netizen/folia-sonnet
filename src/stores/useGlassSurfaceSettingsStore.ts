import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

// src/stores/useGlassSurfaceSettingsStore.ts
// 界面上的毛玻璃：搜索框、侧栏、命令面板、弹层那一类 backdrop-blur 的半透明面板。
//
// 关掉之后它们变成不透明实色。留这个开关有两层理由：一是好看不好看各有所好，二是毛玻璃
// 真的贵 —— 每个带模糊的面板都要把身后的画面整份抓出来再糊一遍，播放页上同时挂着十几层，
// 中低端机上就是掉帧的主要来源。

const GLASS_SURFACES_DISABLED_KEY = 'folia_glass_surfaces_disabled';

export type GlassSurfaceSettingsState = {
    glassSurfacesDisabled: boolean;
    setGlassSurfacesDisabled: (disabled: boolean) => void;
};

export const useGlassSurfaceSettingsStore = create<GlassSurfaceSettingsState>((set) => ({
    // 默认开（毛玻璃保留）：这是界面原本的样子，开关只是给不想要的人留的出口。
    glassSurfacesDisabled: getStoredBoolean(GLASS_SURFACES_DISABLED_KEY, false),
    setGlassSurfacesDisabled: (disabled) => {
        setStoredBoolean(GLASS_SURFACES_DISABLED_KEY, disabled);
        set({ glassSurfacesDisabled: disabled });
    },
}));

/**
 * 写到 `<html data-glass="off">`，由 CSS 一次性覆盖全站那一百多处毛玻璃。
 *
 * 没有逐个组件去加判断：面板散落在各处，还有不少是第三方组件自带的，枚举一遍必然漏；
 * 而这里要的效果本来就只是「别模糊 + 底色压实」，一条属性选择器足够。
 */
const syncGlassAttribute = (disabled: boolean): void => {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (disabled) {
        document.documentElement.setAttribute('data-glass', 'off');
    } else {
        document.documentElement.removeAttribute('data-glass');
    }
};

syncGlassAttribute(useGlassSurfaceSettingsStore.getState().glassSurfacesDisabled);
useGlassSurfaceSettingsStore.subscribe(state => syncGlassAttribute(state.glassSurfacesDisabled));
