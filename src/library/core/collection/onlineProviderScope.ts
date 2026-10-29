import type { OnlineProviderId, ProviderAccountSummary, ProviderCollection } from '../../../types/onlineMusic';
import type { LibraryHomeFeedOwner } from '../home/homeModel.contract';

// src/library/core/model/onlineProviderScope.ts
// 首页在线页签「看谁的数据」的两种范围：跟着当前平台（默认），或「全部」—— 把各家已登录平台的歌单合在一起看。
// 「全部」不是一家平台：它是列表顶部的一行，选了之后当前平台不变（登录、搜索、播放仍按当前平台走），
// 只有首页歌单那一屏的数据换成合并结果，所以每张封面要标出它来自哪家（sourceProviderId → 封面右下角的图标）。

/**
 * 「全部」这个虚拟来源的 id。真实 providerId 是各家自己的标识（netease / qq / kugou / bodian / feiniu，
 * 以及 Folium mod 源自己的 id），这里取一个它们都不会用到的值（带下划线），免得撞车。
 */
export const ALL_PROVIDERS_ID = '__all__';

export const isAllProvidersId = (providerId: string | null | undefined): boolean => providerId === ALL_PROVIDERS_ID;

/**
 * 这家平台此刻有没有能合进「全部」的歌单：已配置、且已登录（或压根不需要账户 —— Folium mod 源），
 * 并且真读到了歌单。「未登录」「读失败」「还在读」的平台不进，合进去只会多一片空墙。
 */
const hasUsableCollections = (provider: ProviderAccountSummary): boolean => (
    provider.availability.configured
    && (provider.status === 'authenticated' || provider.requiresAccount === false)
    && provider.collections.length > 0
);

/**
 * 各家的歌单按平台顺序拼在一起（同一家内部的顺序照旧，也就是各 provider 给的顺序）。
 * 每条都盖上自己那家的 providerId：provider 摘要里理论上已经带了，但「哪家来的」是合并视图唯一的
 * 身份信息（封面角标与打开歌单都靠它），宁可在这里补一次也别让下游猜。
 */
export const mergeProviderCollections = (
    providers: readonly ProviderAccountSummary[],
): ProviderCollection[] => providers
    .filter(hasUsableCollections)
    .flatMap(provider => provider.collections.map(collection => (
        collection.providerId ? collection : { ...collection, providerId: provider.providerId }
    )));

/**
 * 收藏专辑与电台的归属：各家**已登录**、并且这一项它真的支持的「平台 + 账户」。
 *
 * 与歌单那份同理（未登录 / 读失败 / 还在读的平台不进），区别在能力：歌单看的是
 * `playlists`，专辑看 `userAlbums`、电台看 `recommendations` —— 一家支持歌单不代表
 * 它支持收藏专辑，混在一起会让不支持的那家白跑一次请求、还把结果标成 partial。
 *
 * 能力按平台现读（`omni.getProviderCapabilities`），所以放在 model 之外：这里只认
 * 已经算好的能力，由调用方读好传进来。
 */
export const mergeProviderFeedOwners = (
    providers: readonly ProviderAccountSummary[],
    /** 每家平台的能力（调用方现读：provider 可能刚被 mod 移除，读不到要按不支持处理）。 */
    capabilitiesOf: (providerId: string) => { userLibrary?: boolean; userAlbums?: boolean; recommendations?: boolean },
): {
    albums: LibraryHomeFeedOwner[];
    radio: LibraryHomeFeedOwner[];
} => {
    const usable = providers
        .filter(provider => (
            provider.availability.configured
            && (provider.status === 'authenticated' || provider.requiresAccount === false)
            && provider.user?.id !== undefined && provider.user?.id !== null
        ))
        // 与歌单那份一致：整墙按「有内容才进」，这里按「有账户」。
        .map(provider => ({ providerId: provider.providerId, userId: provider.user!.id! }));
    return {
        albums: usable.filter(({ providerId }) => {
            const capabilities = capabilitiesOf(providerId);
            return Boolean(capabilities.userLibrary && capabilities.userAlbums);
        }),
        radio: usable.filter(({ providerId }) => capabilitiesOf(providerId).recommendations),
    };
};

/** 合并视图里有多少家平台真的贡献了歌单（「全部」那一行上可以显示它）。 */
export const countMergeableProviders = (providers: readonly ProviderAccountSummary[]): number => (
    providers.filter(hasUsableCollections).length
);

/** 卡片 id 在合并视图里的唯一化前缀：不同平台的歌单 id 会撞（都是数字），按平台分开。 */
export const scopeCardId = (providerId: OnlineProviderId | string | null | undefined, id: string | number): string => (
    providerId ? `${providerId}:${id}` : String(id)
);
