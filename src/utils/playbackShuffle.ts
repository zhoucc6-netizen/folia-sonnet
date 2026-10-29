import { getPlaybackSongKey } from './appPlaybackGuards';
import type { SongResult } from '../types';

// src/utils/playbackShuffle.ts
// 随机播放的排序。
//
// 「随机播放」不另存一份顺序表，而是**直接把队列重排一遍**：当前这首留在首位，剩下的
// Fisher-Yates 打乱。好处是队列面板看到的顺序就是真正会播的顺序，上一首 / 下一首也不用
// 另算一套下标 —— 现成的 handlePrevTrack / handleNextTrack / 队列面板照旧工作。
//
// 走到最后一首时再调一次，就是用户要的「后面重新打乱一遍」：当前这首变成新队首，后面
// 那些重新洗一遍接着播，于是随机播放不会停在队尾（见 usePlaybackQueueController）。
//
// 同一首歌在队列里出现两次时不能按 key 过滤 —— 那样两首会一起被滤掉，队列凭空少一首。
// 所以按**下标**把当前那一个摘出来，其余照旧参与打乱。

export const buildShuffledQueue = (
    playQueue: SongResult[],
    currentSongKey: string | null,
): SongResult[] => {
    if (playQueue.length <= 1) {
        return [...playQueue];
    }

    const pool = [...playQueue];
    const currentIndex = currentSongKey
        ? pool.findIndex(song => getPlaybackSongKey(song) === currentSongKey)
        : -1;
    // 正在播的那首不参与打乱，否则按下「随机」正在听的就被换掉了 —— 那看起来像 bug。
    // 它固定留在新队列第一位，下一首顺位就是第二位。
    const first = currentIndex >= 0 ? pool.splice(currentIndex, 1)[0] : null;

    for (let index = pool.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [pool[index], pool[randomIndex]] = [pool[randomIndex], pool[index]];
    }

    return first ? [first, ...pool] : pool;
};
