import { create } from 'zustand';
import { ALL_PROVIDERS_ID, isAllProvidersId } from '../collection/onlineProviderScope';

// src/library/core/state/useLibraryOnlineProviderScopeStore.ts
// 首页在线页签在看谁的数据：
// - null：跟着账户的当前平台（默认，也就是加这个开关之前的行为）；
// - ALL_PROVIDERS_ID：「全部」—— 各家已登录平台的歌单合在一起。
//
// 它只影响首页在线那一屏的数据（哪些歌单进墙、封面要不要标来源），**不改当前平台**：登录、搜索、播放、
// 私人 FM 仍按账户 controller 的 activeProviderId 走。所以这个范围是「看数据的方式」，不是「切平台」，
// 也就不进账户快照、不持久化 —— 重开应用回到「跟随当前平台」。
//
// 选真实平台时由调用方（suite 的切换器）先清掉这个范围再调 account.selectProvider，否则会出现
// 「明明选了某家、墙却是合并的」。

type LibraryOnlineProviderScopeState = {
    /** 首页在线页签的数据范围；null 为跟随当前平台。 */
    scopeProviderId: string | null;
    selectScope: (providerId: string | null) => void;
    /** 切到某个真实平台：清掉范围（调用方随后调 account.selectProvider）。 */
    clearScope: () => void;
};

export const useLibraryOnlineProviderScopeStore = create<LibraryOnlineProviderScopeState>(set => ({
    scopeProviderId: null,
    selectScope: (providerId) => set({ scopeProviderId: providerId }),
    clearScope: () => set({ scopeProviderId: null }),
}));

/** 「全部」开着没有（不订阅整个 store，只订阅这一个布尔，避免别处写入让它重渲染）。 */
export const selectIsAllProvidersScope = (state: LibraryOnlineProviderScopeState): boolean => (
    isAllProvidersId(state.scopeProviderId)
);

export { ALL_PROVIDERS_ID };
