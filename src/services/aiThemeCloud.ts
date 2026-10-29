import { fetchEntry, fingerprintLyricSource, highlightWordsPresent, pullAiCloudCache, pushAiCloudCache } from './aiCloudCache';
import { getFromCache, saveToCache } from './db';
import { sanitizeDualTheme } from './themeSanitizer';
import type { DualTheme } from '../types';

// src/services/aiThemeCloud.ts
// AI 主题的两层存放：云端（AI 云缓存，kind='theme'）与「本机改过」那一份。
//
// 和舞台决策（kind='stage'）的那套分开，因为**两者的键根本不是一回事**：
//   · 舞台决策按「歌词正文 + policy」算键 —— 同一首歌换个平台的 LRC 就是另一个答案；
//   · 主题是跟着**歌**走的，翻唱 / 现场版的歌词不一样，配色还是那套。
// 于是这里的键只看歌名 + 歌手。
//
// 服务端 `ai_cache.kind` 是普通字符串列（没有白名单，见 sync-server/src/aiCache.ts），
// 所以多一个 'theme' 不用改服务端、也不用重新部署。
//
// 本地那一份只记「改过」的：没改过的歌一律用云端的，本地不存副本 ——
// 存了就是两份真相（老版本攒下来的本地缓存永远不上传，别人拿不到）。

/** 本地覆盖记录的键前缀。键跟云端同一个，省一次换算。 */
const OVERRIDE_PREFIX = 'ai_theme_override_';

/** 认得歌名和歌手就够了。 */
export interface AiThemeSongRef {
    title?: string | null;
    artist?: string | null;
}

const text = (value: unknown): string => String(value ?? '').trim();

/** SongResult → 只认歌名和歌手的那份引用。 */
export const aiThemeSongRefOf = (
    song: { name?: string | null; artists?: { name?: string | null }[] | null } | null | undefined,
): AiThemeSongRef => ({
    title: song?.name,
    artist: song?.artists?.map(artist => artist?.name).filter(Boolean).join('、'),
});

export const aiThemeCloudKey = (song: AiThemeSongRef): string => (
    fingerprintLyricSource('theme', `${text(song?.title)}\n${text(song?.artist)}`)
);

export const localAiThemeOverrideKey = (song: AiThemeSongRef): string => (
    `${OVERRIDE_PREFIX}${aiThemeCloudKey(song)}`
);

/** 本机改过、还没被「恢复云端版本」丢掉的那一版。没有就是 null。 */
export const readLocalAiThemeOverride = async (song: AiThemeSongRef): Promise<DualTheme | null> => {
    const stored = await getFromCache<DualTheme>(localAiThemeOverrideKey(song));
    return stored ? sanitizeDualTheme(stored) : null;
};

/** 快速编辑保存之后落一份：之后这首歌一律以本机这一版为准。 */
export const writeLocalAiThemeOverride = async (song: AiThemeSongRef, dualTheme: DualTheme): Promise<void> => {
    await saveToCache(localAiThemeOverrideKey(song), dualTheme);
};

/**
 * 推到云端。失败就当没发生过 —— 主题已经在本机生效了，同步失败不该打断它。
 *
 * 云端那条是 upsert：同一个键再推一次就是覆盖，所以「改完再同步」是幂等的。
 */
export const pushAiThemeToCloud = async (song: AiThemeSongRef, dualTheme: DualTheme): Promise<boolean> => (
    pushAiCloudCache('theme', aiThemeCloudKey(song), dualTheme, {
        songTitle: text(song?.title),
    })
);

/**
 * 按**已知键**直接取一条里的主题。
 *
 * 搜索页那个「AI 主题」来源给的就是键（云端歌名清单里那一行），点播放要的是
 * 「立刻用上那一条」，不该再去生成一遍 —— 生成要有歌词、要有 API Key，
 * 而这条缓存存在的意义就是不用再算一次。
 *
 * 键可能是两种 kind：本文件推的 `'theme'`（整份就是 DualTheme），以及舞台决策那条
 * `'stage'`（主题只是它的一半，在 `payload.theme` 上）。歌名清单按歌名分组，
 * 分不出来是哪种，所以两种都试。
 */
export const pullCachedThemeByKey = async (
    key: string,
    /** 歌词正文。给了就先过高亮词那一关 —— 见 passesHighlightCheck。 */
    lyricText?: string,
): Promise<DualTheme | null> => {
    if (!/^[a-f0-9]{32}$/.test(key)) {
        return null;
    }

    const asTheme = await fetchEntry('theme', key);
    if (isDualThemeLike(asTheme)) {
        return passesHighlightCheck(asTheme, String(lyricText ?? '')) ? sanitizeDualTheme(asTheme) : null;
    }

    const stage = await fetchEntry('stage', key);
    if (isDualThemeLike(stage)) {
        return passesHighlightCheck(stage, String(lyricText ?? '')) ? sanitizeDualTheme(stage) : null;
    }
    const half = isRecord(stage) ? stage.theme : null;
    if (!isDualThemeLike(half)) return null;
    return passesHighlightCheck(stage, String(lyricText ?? '')) ? sanitizeDualTheme(half) : null;
};

/** `payload` 长得像不像一份完整的主题（浅 + 深都要有东西）。 */
const isDualThemeLike = (value: unknown): boolean => (
    isRecord(value) && isRecord(value.light) && isRecord(value.dark)
);

const readWords = (value: unknown, out: string[]): void => {
    if (!Array.isArray(value)) return;
    value.forEach((entry) => {
        if (!isRecord(entry)) return;
        const word = typeof entry.word === 'string' ? entry.word.trim() : '';
        if (word && !out.includes(word)) out.push(word);
    });
};

/**
 * 这一份里 AI 标的**高亮词**（`light/dark.wordColors`）。
 *
 * 两种形状都收：本文件推的 `'theme'`（整份就是 DualTheme），以及舞台那条 `'stage'`
 * （主题在 `payload.theme` 上）。
 */
const highlightWordsOf = (payload: unknown): string[] => {
    const out: string[] = [];
    if (!isRecord(payload)) return out;
    const theme = isRecord(payload.theme) ? payload.theme : payload;
    readWords(theme.wordColors, out);
    if (isRecord(theme.light)) readWords(theme.light.wordColors, out);
    if (isRecord(theme.dark)) readWords(theme.dark.wordColors, out);
    return out;
};

/**
 * 拿得到歌词时，**每一条**云端主题都要再过高亮词这一关。
 *
 * ⭐ 这条链路以前一道判定都不走：`fetchEntry` 按已知键直取、`pullAiCloudCache` 只给歌名
 * （没歌词 → 无从判 → 直接信精确键）。于是早年「强制匹配 + 回填」写进去的那些脏条目，
 * 在舞台那条路被判住之后，**从主题这条路照样能进来** —— 用户报的就是这个：「我这边
 * 还是一直可以匹配上那一个」。缓存命中从来不止一条路，堵住一条不算堵住。
 *
 * 两条纪律：
 *  · **没歌词 = 没得判**，照旧放行（不因为拿不到歌词就把别人的成果判死）；
 *  · **没标高亮词 = 没凭据**，也照旧放行 —— 老的主题条目常常一个 wordColors 都没有，
 *    那不是「判出来不对」。只有**标了词却又对不上**才是真脏：那条答案不是照着这份
 *    歌词做的。
 */
const passesHighlightCheck = (payload: unknown, lyricText: string): boolean => {
    if (!lyricText.trim()) return true;
    const words = highlightWordsOf(payload);
    if (words.length === 0) return true;
    return highlightWordsPresent(words, lyricText);
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
/**
 * 从云端拉一首歌的主题（按歌名 + 歌手算键）。
 *
 * 缓存里的东西一律当不可信输入：形状不对就跟没命中一样（返回 null），
 * 服务端一条脏数据不能把播放页搞崩。
 */
export const pullAiThemeFromCloud = async (
    song: AiThemeSongRef,
    /** 歌词正文。给了才判高亮词；给不出（切歌那一刻歌词还没到）就照旧只信键。 */
    lyricText?: string,
): Promise<DualTheme | null> => {
    const result = await pullAiCloudCache('theme', aiThemeCloudKey(song), {
        songTitle: text(song?.title),
        lyricText,
    });
    if (result.status !== 'hit') {
        return null;
    }
    /* 按歌名取回来的那一档（'forced'）没验证过 —— 有歌词就再过一遍高亮词。 */
    if (!passesHighlightCheck(result.payload, String(lyricText ?? ''))) {
        return null;
    }
    return sanitizeDualTheme(result.payload);
};
