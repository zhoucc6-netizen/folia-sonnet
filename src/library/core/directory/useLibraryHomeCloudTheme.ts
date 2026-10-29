import { useCallback, useEffect, useRef } from 'react';
import type { HomeViewTab } from '../../../types';
import { AI_THEME_COLLECTION_ID, type CloudGridViewCollectionDescriptor } from '../collection/collection.contract';
import { collectionKey } from '../collection/collectionIdentity';
// getActiveGridViewCollection 与导航 store 同住（stores/useCollectionNavigationStore），
// 不在 collection/collectionNavigation 里 —— 那边只有 push / pop / trail 这些纯判定。
import { getActiveGridViewCollection, subscribeCollectionPop, useCollectionNavigationStore } from '../../../stores/useCollectionNavigationStore';
import { useSearchNavigationStore } from '../../../stores/useSearchNavigationStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';

// src/library/core/bindings/useLibraryHomeCloudTheme.ts
// 首页「AI 主题」那一屏的入口。
//
// 云端缓存里只有**歌名**（谁为哪首歌生成过主题就记一个名字），没有歌单、没有专辑 —— 所以
// 这一屏不该先给一面「歌单墙」让人再点一次：点页签就**直接进曲目列表**，那一屏自己会先把
// 云端总条数铺成占位行、再一条一条把歌搜出来填进去（见 core/services/cloudThemeCollection）。

/** 「AI 主题」那一个集合的描述（云端整个缓存就是这一屏，所以只有一个）。 */
export const buildCloudThemeCollection = (name: string): CloudGridViewCollectionDescriptor => ({
    source: 'cloud',
    id: AI_THEME_COLLECTION_ID,
    type: 'playlist',
    name,
});

/** 这一屏的集合身份键（只有一个，且不含随名字变的字段 —— 名字是翻译，会随语言变）。 */
const AI_THEME_KEY = collectionKey({
    source: 'cloud',
    id: AI_THEME_COLLECTION_ID,
    type: 'playlist',
});

/*
 * 进这一屏之前停在哪个页签：返回时还回去（还没有就回「歌单」）。
 *
 * 放在模块层而不是组件的 ref 里，原因与下面那个订阅一样：开这一屏的那个组件在弹栈那一刻
 * 多半已经不在了，组件里的东西读不到。
 */
let lastNonCloudTab: HomeViewTab = 'playlist';

/*
 * 这一屏被弹掉（应用内返回、浏览器后退）时把首页页签还回去。
 *
 * ⭐ 订阅写在**模块层**，不能写在组件的 effect 里：这一屏是「页签 = cloud」时自动开的根集合，
 * 弹栈那一刻开它的那个组件往往已经不在了（进了集合页首页就卸载了），组件里的订阅根本收不到 ——
 * 于是页签停在 cloud，首页按 cloud 渲染（那一层本来就是空的），看上去就是「返回按了没用」；
 * 等首页重挂，栈里又没有这一屏，于是又开一遍、那句「云缓存」的提示也就跟着再出现一次。
 *
 * 页签直接写 store 而不是回调给宿主：这条还原必须发生在**没有宿主的时候**（上面那句），
 * 有回调也无人来接。写 homeViewTab 的那条副带动作（让模组的首页页面让开）本来就在
 * useFoliumHomeNavigation 里盯着这个字段，不会漏。
 */
let popSubscription: (() => void) | null = null;

const subscribeCloudThemePop = (): void => {
    if (popSubscription) return;
    popSubscription = subscribeCollectionPop((from, to) => {
        const active = getActiveGridViewCollection(from);
        if (!active || collectionKey(active) !== AI_THEME_KEY) return;
        // 只是从更深的某一层退回这一屏：这一屏还开着，页签当然还要停在 cloud。
        if (to?.stack.some(collection => collectionKey(collection) === AI_THEME_KEY)) return;
        const navigation = useSearchNavigationStore.getState();
        if (navigation.homeViewTab !== 'cloud') return;
        navigation.setHomeViewTab(lastNonCloudTab);
    });
};

/**
 * 切到「AI 主题」页签就打开那一屏，并说一句这一屏是什么。
 *
 * ⭐ 打开这件事必须**幂等**，判据存在 store 而不是组件里。
 *
 * 它是个根集合（navigateToCollection → openRoot），每开一次就往浏览器历史压一条记录。
 * 而它又是切页签时由 effect 自动开的 —— 于是首页一重挂（切 view 回来、切 suite、弹层开合导致的
 * 重挂载），ref 就归零、就再压一条。栈里堆着好几层一模一样的 AI 主题，点返回落到的是**上一个
 * AI 主题**：画面纹丝不动，看上去就是「返回按了没用、退不到主界面」。
 *
 * 所以判据读导航栈本身（它跨重挂载活着）：已经在看这一屏就直接不做。
 */
export const useLibraryHomeCloudThemeEntry = ({
    tab,
    enabled = true,
    onOpenCollection,
    label,
    notice,
}: {
    tab: HomeViewTab;
    /** 首页此刻能不能交互（有弹层盖着时不开）。 */
    enabled?: boolean;
    onOpenCollection: (collection: CloudGridViewCollectionDescriptor) => void;
    /** 已翻译的页签名（渲染这一层的组件自己翻，别在这里再走一遍 i18n 的类型）。 */
    label: string;
    /** 已翻译的那句「这一屏是什么」。 */
    notice: string;
}): void => {
    const openedRef = useRef(false);
    const open = useCallback(() => {
        // 已经在看这一屏就什么都不做：再开一次等于再压一层历史（后果见上面的说明）。
        const active = getActiveGridViewCollection(useCollectionNavigationStore.getState().snapshot);
        if (active && collectionKey(active) === AI_THEME_KEY) return;
        setStatusMessage({ type: 'info', text: notice });
        onOpenCollection(buildCloudThemeCollection(label));
    }, [label, notice, onOpenCollection]);

    // 记下「进 cloud 之前停在哪个页签」，并保证弹栈还原的订阅一直在（见模块顶部的说明）。
    useEffect(() => {
        subscribeCloudThemePop();
        if (tab !== 'cloud') lastNonCloudTab = tab;
    }, [tab]);

    useEffect(() => {
        if (tab !== 'cloud') {
            openedRef.current = false;
            return;
        }
        if (!enabled || openedRef.current) return;
        openedRef.current = true;
        open();
    }, [enabled, open, tab]);
};
