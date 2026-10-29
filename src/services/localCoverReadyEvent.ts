/**
 * 「这首歌现在有封面了」的广播。
 *
 * 为什么要单独一个模块：广播方有两个 —— `localMusicService` 从文件里抽出内嵌封面，
 * `localSongMatchSelectionService` 写入在线封面 —— 而它们互相不能 import。
 * 依赖是 `localCoverAutoFetch → localSongMatchSelectionService`，而 `localMusicService`
 * 又 import 了 `localCoverAutoFetch`：直接互相引用就是一条环（playbackAdapters 那边
 * 已经因为同样的理由把 backfill 改成动态 import 了）。常量放在这里，两边都能拿。
 */
export const LOCAL_COVER_READY_EVENT = 'folia-local-cover-ready';

/** 与 `localMusicService` 的 LOCAL_MUSIC_UPDATED_EVENT 同一个事件；这里不 import 那个模块，免得成环。 */
const LOCAL_MUSIC_UPDATED_EVENT = 'folia-local-music-updated';

/**
 * 封面到达之后顺带通知「曲库变了」的等待时间。
 *
 * 资料库那两面墙（bravais 首页卡、集合磁贴）都是**按 `localSongs` 现算**封面的，
 * 而 `localSongs` 只在 `folia-local-music-updated` 时重读。封面是异步补的（导入之后
 * 才联网搜、播到才抽文件），那一下通知早在这一刻之前就发过了 —— 于是封面进了库，
 * 墙上还是占位色，看着就是「不会自动更新」。
 *
 * 一首一通知会让整面墙在导入后连着整表重读几十次，所以攒一攒：这段时间内到达的
 * 封面合并成一次通知。
 */
const LIBRARY_UPDATE_DEBOUNCE_MS = 500;

let libraryUpdateTimer: number | undefined;

const scheduleLibraryUpdate = (): void => {
    if (typeof window === 'undefined') return;
    if (libraryUpdateTimer !== undefined) window.clearTimeout(libraryUpdateTimer);
    libraryUpdateTimer = window.setTimeout(() => {
        libraryUpdateTimer = undefined;
        window.dispatchEvent(new CustomEvent(LOCAL_MUSIC_UPDATED_EVENT));
    }, LIBRARY_UPDATE_DEBOUNCE_MS);
};

export type LocalCoverReadyDetail = {
    songId: string;
    /** 内嵌封面：只给资源 id，收的一方自己换成 URL（不同尺寸的 URL 不一样）。 */
    assetId?: string;
    /** 在线封面：可直接用的 URL。 */
    coverUrl?: string;
};

/**
 * 广播一次封面就绪。
 *
 * 为什么必须有它：队列（Lattice 铺的就是它）里的 `album.coverUrl` 是**建队那一刻**
 * 烤进去的快照，之后歌曲记录上的封面字段再怎么变它都看不见。没有这个事件，
 * 「后来才有的封面」永远进不了磁贴墙 —— 播放页有封面、磁贴墙一片空白。
 *
 * 顺带排一次「曲库变了」：按记录现算的那两面墙（bravais 首页卡 / 集合磁贴）要它才会重读。
 */
export const announceLocalCoverReady = (detail: LocalCoverReadyDetail): void => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(LOCAL_COVER_READY_EVENT, { detail }));
    scheduleLibraryUpdate();
};
