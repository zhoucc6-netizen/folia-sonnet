import type { LocalSong } from '../types';
import { ensureLocalSongCoverAsset } from './localMusicService';

// src/services/localCoverBackfill.ts
// 给列表上还没抽出封面的歌补一次。
//
// 为什么要补：本地歌的内嵌封面原本只在两个时机抽 —— 导入那一刻，以及播放前
// （ensureLocalSongCoverAsset 的调用点全在播放链路上）。从来没播过、也没打开过的歌单，
// 它的歌就没有 localCoverAssetId，卡片封面只能是空白；用户点开一次（走播放那条路）之后
// 才有。于是「没打开过的歌单没有封面」。
//
// 补的活按三件事收着：同一首歌有冷却窗口（抽不出来就别反复抽）、串行跑（不跟
// 播放抢 IO）、只取文件头部（见 nativeAudioFile 的 preferHeadBytes）。

/**
 * 同一首歌多久之内不再重新去文件里抽封面。
 *
 * 原来是「一次会话里只试一遍」的永久 Set。抽内嵌封面是 IO，确实不该反复做；但这里
 * 抽不出来还要接联网那条路（见下面的 fallbackToOnline），而联网那边也有自己的冷却，
 * 两边都永久记住的话「用户后来又翻到这一屏」就永远不会再试 —— 正是「不会自动更新」的观感。
 */
const RETRY_COOLDOWN_MS = 10 * 60 * 1000;

const attemptedAt = new Map<string, number>();

const recentlyAttempted = (songId: string): boolean => {
    const at = attemptedAt.get(songId);
    return at !== undefined && Date.now() - at < RETRY_COOLDOWN_MS;
};
let queue: Promise<void> = Promise.resolve();

/** 抽到封面后通知界面重建 —— 与 localCoverAssetService 里那条同一个事件。 */
const announceLibraryUpdate = (): void => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('folia-local-music-updated'));
};

/**
 * 排队补齐这批歌的封面。同步返回，不等结果 —— 首屏不该被它拖住。
 *
 * `limit` 是这一次最多碰多少首，防止一次开屏对着几百首歌发请求。
 *
 * `fallbackToOnline`（默认关）：文件里抽不出内嵌封面的歌，转交给联网那条路。
 * 关着是因为调用方有两个 —— 建队列那处（playbackAdapters）每次建队都会过一遍，
 * 让它顺带联网搜就太吵了；只有用户真在看的资料库首页才开。
 */
export const backfillLocalCovers = (
    songs: LocalSong[],
    limit: number,
    options?: { fallbackToOnline?: boolean; onlineLimit?: number },
): void => {
    const pending = songs
        .filter(song => !song.localCoverAssetId && !recentlyAttempted(song.id))
        .slice(0, Math.max(0, limit));
    if (pending.length === 0) return;
    const now = Date.now();
    pending.forEach(song => attemptedAt.set(song.id, now));

    queue = queue
        .then(async () => {
            let recovered = 0;
            const stillMissing: LocalSong[] = [];
            for (const song of pending) {
                try {
                    const updated = await ensureLocalSongCoverAsset(song, { preferHeadBytes: true });
                    if (updated.localCoverAssetId) {
                        recovered += 1;
                        continue;
                    }
                } catch {
                    // 一首失败不该挡住后面的。
                }
                /*
                 * 文件里没有内嵌封面 —— 本地这条路对它就到头了。
                 *
                 * 原来到这里就完了，于是「文件里没封面、导入那一刻联网又没匹配上」的歌
                 * 永远是占位色：联网那条路（localCoverAutoFetch）只挂在导入/扫描上，
                 * 平时打开资料库根本不跑。这里把它接上。
                 */
                if (options?.fallbackToOnline) stillMissing.push(song);
            }
            if (recovered > 0) announceLibraryUpdate();
            if (stillMissing.length === 0) return;
            const onlineLimit = options?.onlineLimit ?? stillMissing.length;
            // force：这几首是刚刚确认过「文件里没有内嵌封面」的，联网那边的冷却不该挡它们。
            void import('./localCoverAutoFetch')
                .then(module => module.fetchOnlineCoversForImportedSongs(
                    stillMissing.slice(0, Math.max(0, onlineLimit)),
                    { force: true },
                ))
                .catch(() => undefined);
        })
        .catch(() => undefined);
};
