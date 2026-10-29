import type { SongResult } from '../types';

// src/utils/songPlatform.ts
// 这首歌来自哪个音乐平台 —— 上传 AI 缓存时跟着一起交给服务端，它好去对应平台
// 把歌词原文件取回来核一遍。

/**
 * 平台名（netease / qq / kugou …）。
 *
 * **本地歌曲没有平台**：那种歌是文件里的东西，不归任何一家。留空串，服务端会按
 * 顺序逐个平台试着找它的歌词 —— 找到了就校验，一个都找不到就按「无从校验」放行。
 *
 * 这个字段只跟着上传走，**不参与缓存键**：键始终是那段歌词的 MD5，于是加了它也不
 * 影响早先推上去的那些条目。
 */
export const resolveSongPlatform = (song: SongResult | null | undefined): string => {
    const ref = song?.sourceRef;
    if (ref && ref.kind === 'online') {
        return String(ref.providerId ?? '').trim().toLowerCase();
    }
    return '';
};
