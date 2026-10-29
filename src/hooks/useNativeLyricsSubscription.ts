import { useEffect } from 'react';
import { isCapacitorAndroid } from '../platform/runtime';
import { setLyricsState } from '../stores/usePlaybackStore';
import type { Line, LyricData } from '../types';

// src/hooks/useNativeLyricsSubscription.ts
// 订阅原生推来的歌词。**歌词由原生拉**，这里只把它翻成界面用的结构。
//
// 为什么不让 JS 自己拉：它会挂到 `currentSong` 的 React effect 上，而原生派发的点歌
// 绕过那个 effect —— 用户报的「切了歌单，歌词与主题还停在上一个歌单那首，要等下一首
// 才翻」正是这个。现在原生拉到什么就推什么，认领判据只剩 songKey 一条。
//
// 前台被冻结时这个订阅不跑也没关系：原生照样拉着，桌面歌词照样有；前台重渲染时会
// 重新拉一次当前曲目的歌词（见 useNativeLyricsSubscription 的初次请求）。

type NativeLyricsPayload = { songKey: string; lrc?: string; translated?: string };

/** `[mm:ss.xx]` / `[mm:ss:xx]` 都见过，统一按这两位是百分秒处理。 */
const TIMESTAMP = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

const toSeconds = (minutes: string, seconds: string, fraction?: string): number => {
    const frac = fraction ? Number(`0.${fraction}`) : 0;
    return Number(minutes) * 60 + Number(seconds) + frac;
};

/**
 * 把 LRC 文本解成行。**只做纯解析**，不参与「该不该换歌词」的判断。
 *
 * 一行多个时间戳（`[00:01.00][00:05.00]词`）是各家平台返回的常见形态，逐个展开。
 * 翻译按时间戳对齐到主行。
 */
export const parseLrcLines = (lrc: string, translated: string): Line[] => {
    const translations = new Map<number, string>();
    if (translated) {
        for (const raw of translated.split('\n')) {
            TIMESTAMP.lastIndex = 0;
            const match = TIMESTAMP.exec(raw.trim());
            if (!match) continue;
            const text = raw.replace(TIMESTAMP, '').trim();
            if (text) translations.set(toSeconds(match[1], match[2], match[3]), text);
        }
    }
    const lines: Line[] = [];
    for (const raw of lrc.split('\n')) {
        TIMESTAMP.lastIndex = 0;
        const stamps = [...raw.matchAll(TIMESTAMP)];
        if (stamps.length === 0) continue;
        const text = raw.replace(TIMESTAMP, '').trim();
        for (const stamp of stamps) {
            const startTime = toSeconds(stamp[1], stamp[2], stamp[3]);
            lines.push({
                startTime,
                endTime: startTime,
                fullText: text,
                translation: translations.get(startTime) ?? '',
                words: [],
            });
        }
    }
    lines.sort((a, b) => a.startTime - b.startTime);
    // 每行的结束时间是下一行的开始；最后一首按自身长度兜底（播放时会按真实时长夹）。
    for (let i = 0; i < lines.length; i += 1) {
        const next = lines[i + 1];
        lines[i].endTime = next ? next.startTime : lines[i].startTime + 5;
    }
    return lines;
};

/** 把一份 LRC 变成 store 要的形状；没有内容时给 null（界面据此显示「暂无歌词」）。 */
export const toLyricData = (lrc: string, translated: string): LyricData | null => {
    const lines = parseLrcLines(lrc, translated);
    return lines.length > 0 ? { lines } : null;
};

export const useNativeLyricsSubscription = (currentSongKey: string | null): void => {
    useEffect(() => {
        if (!isCapacitorAndroid()) return;
        let disposed = false;
        let unsubscribe: { remove: () => Promise<void> | void } | null = null;

        const subscribe = async (): Promise<void> => {
            const g = window as unknown as {
                Capacitor?: { Plugins?: Record<string, unknown> };
            };
            const plugin = g.Capacitor?.Plugins?.FoliaPlayback as
                | {
                      addListener?: (
                          name: string,
                          cb: (payload: NativeLyricsPayload) => void,
                      ) => Promise<{ remove: () => Promise<void> | void }>;
                  }
                | undefined;
            if (!plugin?.addListener) return;
            // Capacitor 的 addListener 返回**句柄对象** `{ remove }`，不是函数：
            // 以前把它当函数在 effect 的清理里调，TypeError 直接把渲染打掉（黑屏）。
            const handle = await plugin.addListener('foliaPlaybackLyrics', (payload) => {
                if (disposed) return;
                // 只认当前这首：原生可能在我们切歌的同一瞬间推来上一首的结果。
                if (!payload?.songKey || payload.songKey !== currentSongKey) return;
                if (!payload.lrc) {
                    // 原生说这首没有歌词：清掉上一首的，别让界面挂着别人的词。
                    setLyricsState(null);
                    return;
                }
                setLyricsState(toLyricData(payload.lrc, payload.translated ?? ''));
            });
            if (disposed) void handle?.remove?.();
            else unsubscribe = handle;
        };

        void subscribe();
        return () => {
            disposed = true;
            void unsubscribe?.remove?.();
        };
    }, [currentSongKey]);
};
