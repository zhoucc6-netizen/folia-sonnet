import type { SongResult } from '../../../../types';
import type { MediaId, ProviderCollection, ProviderPage } from '../../../../types/onlineMusic';
import type {
    LibraryHomeFeedOwner,
    LibraryHomeFeedResource,
    LibraryHomeFeedSnapshot,
    LibraryHomeRadioFeed,
} from '../homeModel.contract';

// src/library/core/home/online/onlineHomeFeeds.service.ts
// 在线首页的两份数据：收藏专辑（翻完所有页）与电台 feed（私人 FM、每日推荐、推荐歌单）。原先是 Grid3D 里的
// 组件状态，加载 effect 排在「切 provider 清空」的 effect 前面，切 provider 后新 provider 的列表一直不加载；
// 晚到的应答也没有归属检查。这里每份数据是一个资源：归属（provider + 账户）由调用方显式设置，
// 每次读取领一个 generation，换归属 / 重新读取让旧读取作废，晚到的结果直接丢掉。
//
// 归属是**一组**而不是一个：首页「全部」那一屏要把各家登录着的平台合在一起看，收藏专辑与电台
// 都得一家一家问过去（单个归属时就是原来那一条路）。上游调用经注入的 deps（默认装配在
// onlineHomeFeedDeps，单测不经过它），所以每个接口都把 providerId 显式传进来。

/** 收藏专辑每页取多少（与原 Grid3D 相同）。 */
export const FAVORITE_ALBUMS_PAGE_SIZE = 50;
/** 电台页签的推荐歌单数（与原 Grid3D 相同）。 */
export const HOME_FEED_RECOMMENDATION_LIMIT = 35;

export type OnlineHomeFeedDeps = {
    getUserAlbums(providerId: string, userId: MediaId, page: { limit: number; offset: number }): Promise<ProviderPage<ProviderCollection>>;
    getHomeFeed(providerId: string, limit: number): Promise<{
        personalFm: SongResult[];
        dailySongs: SongResult[];
        recommendedCollections: ProviderCollection[];
        partial?: true;
    }>;
    songCoverUrl(song: SongResult | undefined, providerId: string): string | undefined;
    supportsDailySongs?(providerId: string): boolean;
};

const NO_OWNERS: readonly LibraryHomeFeedOwner[] = [];

const sameOwners = (a: readonly LibraryHomeFeedOwner[], b: readonly LibraryHomeFeedOwner[]): boolean => (
    a === b || (a.length === b.length && a.every((entry, index) => (
        entry.providerId === b[index].providerId && String(entry.userId) === String(b[index].userId)
    )))
);

// omni 在 provider 切换后会以 AbortError 拒绝旧 provider 的应答；那是预期的作废，不当错误记。
const isAbortError = (error: unknown) => (
    typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
);

/**
 * 通用的首页数据资源。`load` 收到归属（可能多家）与 `isCurrent`（这次读取是否仍有效，分页读取可以据此提前停下）。
 * 失败时保留已有数据、状态记为 error；ensure 只在这一组归属下还没成功读过时才读。
 * isComplete 判为不完整的结果照常显示，但不算「读过」，下次 ensure 再读一遍。
 */
export const createHomeFeedResource = <TData>({
    label,
    empty,
    load,
    isComplete,
}: {
    label: string;
    empty: TData;
    load: (owners: readonly LibraryHomeFeedOwner[], isCurrent: () => boolean) => Promise<TData>;
    isComplete?: (data: TData) => boolean;
}): LibraryHomeFeedResource<TData> => {
    let owners: readonly LibraryHomeFeedOwner[] = NO_OWNERS;
    let snapshot: LibraryHomeFeedSnapshot<TData> = { owners: NO_OWNERS, status: 'idle', loaded: false, data: empty };
    let generation = 0;
    const listeners = new Set<() => void>();

    const commit = (next: LibraryHomeFeedSnapshot<TData>) => {
        snapshot = next;
        listeners.forEach(listener => listener());
    };

    const run = async () => {
        const reading = owners;
        if (reading.length === 0) return;
        const ticket = ++generation;
        const isCurrent = () => ticket === generation;
        commit({ ...snapshot, status: 'loading' });
        try {
            const data = await load(reading, isCurrent);
            if (!isCurrent()) return;
            commit({ owners: reading, status: 'ready', loaded: isComplete ? isComplete(data) : true, data });
        } catch (error) {
            if (!isCurrent()) return;
            if (!isAbortError(error)) console.error(`[LibraryHome] Failed to load ${label}`, error);
            commit({ ...snapshot, status: 'error' });
        }
    };

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        setOwners: (next) => {
            const list = next.length === 0 ? NO_OWNERS : next.map(owner => ({ ...owner }));
            if (sameOwners(list, owners)) return;
            generation += 1;
            owners = list;
            commit({ owners: list, status: 'idle', loaded: false, data: empty });
        },
        ensure: () => {
            if (owners.length === 0 || snapshot.loaded || snapshot.status === 'loading') return Promise.resolve();
            return run();
        },
        reload: () => run(),
    };
};

/**
 * 按页读完一组账户的收藏专辑（先家后页，同一家内部照上游顺序）。上游说没有更多、
 * 或下一页的 offset 不再前进时停；读取作废（换了归属）时不再请求后面的页。
 *
 * 一家读失败只是这一家没有专辑，不该把别家已经读到的也拖没 —— 所以每家单独兜住，
 * 只有作废（AbortError）往上抛（那是换了归属，整次读取都要作数）。
 */
export const loadAllFavoriteAlbums = async (
    deps: Pick<OnlineHomeFeedDeps, 'getUserAlbums'>,
    owners: readonly LibraryHomeFeedOwner[],
    isCurrent: () => boolean = () => true,
    pageSize = FAVORITE_ALBUMS_PAGE_SIZE,
): Promise<ProviderCollection[]> => {
    const albums: ProviderCollection[] = [];
    for (const owner of owners) {
        let offset = 0;
        let hasMore = true;
        while (hasMore && isCurrent()) {
            let page: ProviderPage<ProviderCollection>;
            try {
                page = await deps.getUserAlbums(owner.providerId, owner.userId, { limit: pageSize, offset });
            } catch (error) {
                if (isAbortError(error) || !isCurrent()) throw error;
                console.warn('[LibraryHome] Favorite albums failed for a provider', {
                    providerId: owner.providerId,
                    message: error instanceof Error ? error.message : String(error),
                });
                break;
            }
            // 合并视图里「这家来的」是唯一的身份信息（角标、取曲目、卡片 id 去重），缺了就补上。
            albums.push(...page.items.map(collection => (
                collection.providerId ? collection : { ...collection, providerId: owner.providerId }
            )));
            hasMore = page.hasMore && page.nextOffset > offset;
            offset = page.nextOffset;
        }
        if (!isCurrent()) return albums;
    }
    return albums;
};

/** 收藏专辑资源。 */
export const createFavoriteAlbumsFeed = (
    deps: Pick<OnlineHomeFeedDeps, 'getUserAlbums'>,
): LibraryHomeFeedResource<ProviderCollection[]> => createHomeFeedResource<ProviderCollection[]>({
    label: 'favorite albums',
    empty: [],
    load: (owners, isCurrent) => loadAllFavoriteAlbums(deps, owners, isCurrent),
});

/**
 * 电台 feed 资源：私人 FM 与每日推荐只取封面与数量（卡片由 core/home/homeCards 组装）。
 *
 * 多家时合起来看：FM 与每日推荐的封面取第一个有内容的（「全部」视图里它们各只有一张卡），
 * 每日推荐的数量是各家之和，推荐歌单按家拼在一起、各自标上来自哪家。
 * 一家没读到只让结果标成 partial（照常显示读到的部分、下次再读），全都没读到才算失败。
 */
export const createRadioFeed = (
    deps: Pick<OnlineHomeFeedDeps, 'getHomeFeed' | 'songCoverUrl' | 'supportsDailySongs'>,
): LibraryHomeFeedResource<LibraryHomeRadioFeed | null> => createHomeFeedResource<LibraryHomeRadioFeed | null>({
    label: 'radio feed',
    empty: null,
    load: async (owners, isCurrent) => {
        const settled = await Promise.allSettled(
            owners.map(owner => deps.getHomeFeed(owner.providerId, HOME_FEED_RECOMMENDATION_LIMIT)),
        );
        let partial = false;
        const feeds: { owner: LibraryHomeFeedOwner; feed: Awaited<ReturnType<OnlineHomeFeedDeps['getHomeFeed']>> }[] = [];
        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                feeds.push({ owner: owners[index], feed: result.value });
                if (result.value.partial) partial = true;
                return;
            }
            if (isAbortError(result.reason)) throw result.reason;
            partial = true;
            console.warn('[LibraryHome] Radio feed failed for a provider', {
                providerId: owners[index].providerId,
                message: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
        });
        if (feeds.length === 0) {
            throw (settled[0] as PromiseRejectedResult | undefined)?.reason ?? new Error('radio feed unavailable');
        }

        let personalFmCoverUrl: string | undefined;
        // 只要有一家给了私人 FM 的歌，FM 卡就出现（平台没有可拿来起电台的歌时不出现）。
        let hasPersonalFm = false;
        let dailyCoverUrl = '';
        let dailyCount = 0;
        const recommended: ProviderCollection[] = [];
        feeds.forEach(({ owner, feed }) => {
            if (!personalFmCoverUrl) personalFmCoverUrl = deps.songCoverUrl(feed.personalFm[0], owner.providerId);
            if (!hasPersonalFm) hasPersonalFm = feed.personalFm.length > 0;
            if (!dailyCoverUrl) dailyCoverUrl = deps.songCoverUrl(feed.dailySongs[0], owner.providerId) || '';
            dailyCount += feed.dailySongs.length;
            recommended.push(...feed.recommendedCollections.map(collection => (
                collection.providerId ? collection : { ...collection, providerId: owner.providerId }
            )));
        });

        return {
            ...(partial ? { partial: true as const } : {}),
            personalFmCoverUrl,
            hasPersonalFm,
            dailyCoverUrl,
            dailyCount,
            // 只要有一家还支持每日推荐，那张卡就留着（各家的内容已经合进同一张）。
            supportsDailySongs: feeds.some(({ owner }) => deps.supportsDailySongs?.(owner.providerId) ?? true),
            recommended,
        };
    },
    // 有一块没读到时照常显示读到的部分，但下次进电台页再读一遍（以前整份失败，下次进来也会重读）。
    isComplete: feed => !feed?.partial,
});
