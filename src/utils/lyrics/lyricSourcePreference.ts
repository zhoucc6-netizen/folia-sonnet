import type { LyricProviderSource, LyricSourcePreference, SongResult } from '../../types';
import { getSongNativeLyricProviderSource } from './lyricSourceLabels';
import { DEFAULT_LOCAL_LYRIC_SOURCE, LYRIC_SOURCE_FOLLOW_PLAYBACK } from './sourcePriority';

// src/utils/lyrics/lyricSourcePreference.ts
// 「跟随播放平台来源」在这里落地成一个真能发请求的平台。
//
// 存进设置的可以是 'follow-source'，但 autoMatchBestLyric / 匹配弹窗只认具体平台，
// 所以每个消费点传 preferredSource 之前都要过一次这里。漏掉一处就是拿一个不存在的
// 平台去搜索 —— 静默退回兜底顺序，看不出错，只是优先级不对。

export type LyricSourcePreferenceSettings = {
    preferredAlternativeLyricSource: LyricSourcePreference;
    localLyricProviderSource?: LyricProviderSource;
};

export const resolveLyricSourcePreference = (
    settings: LyricSourcePreferenceSettings,
    song?: Pick<SongResult, 'sourceRef'> | null,
): LyricProviderSource => {
    const preference = settings.preferredAlternativeLyricSource;
    if (preference !== LYRIC_SOURCE_FOLLOW_PLAYBACK) return preference;
    // 本地文件、Navidrome 曲库里的歌都没有 sourceRef 平台，只能退回「本地歌曲的歌词来源」。
    return getSongNativeLyricProviderSource(song) ?? settings.localLyricProviderSource ?? DEFAULT_LOCAL_LYRIC_SOURCE;
};
