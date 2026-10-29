import { DualTheme, Theme } from '../types';
import { getFromCache } from './db';
import { sanitizeDualTheme, sanitizeTheme, FALLBACK_AI_DUAL_THEME } from './themeSanitizer';

// src/services/themeCache.ts
// 「上次用过的主题」指针。
//
// 这里只留 last_* 两个指针，用来在切到一首没有主题的新歌时，把界面退回上次那套配色。
// 生成结果的缓存已经全部搬到云端（services/aiStage.ts）—— 本地再存一份就是两份真相：
// 老版本攒下来的本地缓存永远不会上传，别人也就永远拿不到，等于白生成。

export type ThemeCacheSongKey = string | number;

export async function getLastDualTheme(): Promise<DualTheme | null> {
    const dualTheme = await getFromCache<DualTheme>('last_dual_theme');
    return dualTheme ? sanitizeDualTheme(dualTheme) : null;
}

export async function getLastLegacyTheme(): Promise<Theme | null> {
    const legacyTheme = await getFromCache<Theme>('last_theme');
    return legacyTheme ? sanitizeTheme(legacyTheme, FALLBACK_AI_DUAL_THEME.dark) : null;
}
