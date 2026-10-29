import type { LyricProviderSource, LyricSourcePreference } from '../../types';
import { LYRIC_SOURCE_IDS, isLyricProviderSource } from './lyricSources';

// 这两档类型本文件就在用，顺手从源头转出去，调用方不必再绕回 types.ts。
export type { LyricProviderSource, LyricSourcePreference };

// src/utils/lyrics/sourcePriority.ts

/**
 * 「跟随播放平台来源」这一档。
 *
 * 必须留成字面量类型：靠 `preference !== LYRIC_SOURCE_FOLLOW_PLAYBACK` 收窄出具体平台，
 * 否则 TypeScript 认不出剩下的分支都是 LyricProviderSource。
 */
export const LYRIC_SOURCE_FOLLOW_PLAYBACK = 'follow-source' as const;

export const DEFAULT_PREFERRED_LYRIC_SOURCE: LyricSourcePreference = LYRIC_SOURCE_FOLLOW_PLAYBACK;

/** 本地文件 / Navidrome 这类没有平台来源的歌用的退路。 */
export const DEFAULT_LOCAL_LYRIC_SOURCE: LyricProviderSource = 'qq';

/** 这个值是「跟随」或某个具体平台时才作数。 */
export const isLyricSourcePreference = (value: unknown): value is LyricSourcePreference => (
    value === LYRIC_SOURCE_FOLLOW_PLAYBACK || isLyricProviderSource(value)
);

/** 下拉里的顺序：「跟随」在最前，后面跟着各个具体平台。 */
export const LYRIC_SOURCE_PREFERENCE_ORDER: readonly LyricSourcePreference[] = [
    LYRIC_SOURCE_FOLLOW_PLAYBACK,
    ...LYRIC_SOURCE_IDS,
];

// Places the user preference first while retaining every fallback source exactly once.
export const buildLyricSourceOrder = (
    preferredSource: LyricProviderSource = DEFAULT_LOCAL_LYRIC_SOURCE,
): LyricProviderSource[] => [
    preferredSource,
    ...LYRIC_SOURCE_IDS.filter(source => source !== preferredSource),
];

export const migratePreferredLyricSource = (
    versionedValue: unknown,
    legacyValue: unknown,
): LyricSourcePreference => {
    if (versionedValue !== null && versionedValue !== undefined) {
        return isLyricSourcePreference(versionedValue) ? versionedValue : DEFAULT_PREFERRED_LYRIC_SOURCE;
    }
    // A fixed list, not the table: only these three names are carried over from the older key.
    if (legacyValue === 'amll' || legacyValue === 'qq' || legacyValue === 'kugou') return legacyValue;
    return DEFAULT_PREFERRED_LYRIC_SOURCE;
};
