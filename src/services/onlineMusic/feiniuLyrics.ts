import type { ProviderLyricsResult } from '../../types/onlineMusic';
import { parseLyricsByFormat } from '../../utils/lyrics/parserCore';
import { isPureMusicLyricText } from '../../utils/lyrics/pureMusic';

// src/services/onlineMusic/feiniuLyrics.ts

export type FeiniuLyricEntry = { guid?: string; content?: string; isLRC?: boolean; offset?: number };
export type FeiniuLyricPayload = { list?: FeiniuLyricEntry[]; preferred?: string };

/** 飞牛的歌词就是标准 LRC 文本，挑 `preferred` 那一条，没有就取第一条。 */
export const pickFeiniuLyricText = (payload: FeiniuLyricPayload | null | undefined): string => {
    const list = Array.isArray(payload?.list) ? payload!.list! : [];
    if (list.length === 0) return '';
    const preferred = list.find(entry => entry?.guid && entry.guid === payload?.preferred);
    return String(preferred?.content ?? list[0]?.content ?? '');
};

export const parseFeiniuLyrics = (text: string): ProviderLyricsResult => {
    const content = String(text ?? '');
    const lyrics = content ? parseLyricsByFormat('lrc', content) : null;
    return {
        lyrics: lyrics && lyrics.lines.length > 0 ? lyrics : null,
        mainText: content || null,
        isPureMusic: isPureMusicLyricText(content),
    };
};
