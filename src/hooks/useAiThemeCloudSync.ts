import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { isFoliaCloudCacheEnabled } from '../services/foliaCloud';
import {
    aiThemeSongRefOf,
    pullAiThemeFromCloud,
    pushAiThemeToCloud,
} from '../services/aiThemeCloud';
import { matchStage } from '../services/aiStage';
import { applyAiThemeFromOutside, readCurrentAiTheme } from '../services/aiThemeApplyBridge';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { resolveSongPlatform } from '../utils/songPlatform';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';

// src/hooks/useAiThemeCloudSync.ts
// 面板上「AI 主题」旁边那颗同步按钮：走 AI 云缓存，不碰自建 sync 服务器。
//
// 按下去只做一件事 —— **匹配一次**，并且**绝不生成**：
//   · 命中 → 当场用上（「别人做好的我直接拿来用」）；
//   · 没命中、而本机改过 → 把本机这一版贡献上去（云端那条是 upsert，再点是幂等的）；
//   · 都没有 → 提示云端还没有。
//
// 匹配走的是**舞台那条链路**（services/aiStage.ts 的 matchStage），跟切歌自动生成主题、
// 歌词动画导演用的是同一个键（歌词正文 + 设置）。以前这里查 kind='theme'（按歌名 + 歌手
// 算键），跟主题真正存的地方不是一个键 —— 切歌时明明刚从云端匹配上主题，按下这颗却报
// 「云端还没有这首的主题」，看上去就是缓存坏了。

export type AiThemeCloudSyncState = 'idle' | 'syncing' | 'complete';

const COMPLETE_STATE_HOLD_MS = 1600;

export const useAiThemeCloudSync = (options: {
    /** 本机改过的那一版还在不在（面板的 `themeSourceModel.hasLocalAiTheme`）。 */
    locallyEdited: boolean;
}) => {
    const { locallyEdited } = options;
    const { t } = useTranslation();
    const [syncState, setSyncState] = useState<AiThemeCloudSyncState>('idle');
    const completeTimerRef = useRef<number | null>(null);
    const currentSong = usePlaybackStore(useShallow(state => state.currentSong));
    /* 键是「歌词正文 + 设置」算出来的，所以同步也必须拿当前这份歌词去对。 */
    const lyrics = usePlaybackStore(state => state.lyrics);

    useEffect(() => () => {
        if (completeTimerRef.current !== null) {
            window.clearTimeout(completeTimerRef.current);
        }
    }, []);

    const holdComplete = useCallback(() => {
        if (completeTimerRef.current !== null) {
            window.clearTimeout(completeTimerRef.current);
        }
        setSyncState('complete');
        completeTimerRef.current = window.setTimeout(() => {
            setSyncState('idle');
            completeTimerRef.current = null;
        }, COMPLETE_STATE_HOLD_MS);
    }, []);

    const runSync = useCallback(async () => {
        if (syncState === 'syncing') {
            return;
        }
        if (!currentSong) {
            return;
        }
        if (!isFoliaCloudCacheEnabled()) {
            setStatusMessage({ type: 'info', text: t('ui.aiThemeCloudOff') });
            return;
        }

        const songRef = aiThemeSongRefOf(currentSong);
        const songTitle = String(currentSong.name ?? lyrics?.title ?? '').trim();
        const allText = (lyrics?.lines ?? [])
            .map((line) => line.fullText)
            .join('\n')
            .trim();
        const isPureMusic = currentSong.isPureMusic === true || isPureMusicLyricText(allText);

        setSyncState('syncing');
        try {
            /*
             * 先按舞台那条链路匹配一次 —— 与切歌自动生成主题、歌词动画导演同一个键，
             * 于是「刚才明明匹配上了」就一定还能匹配上。只匹配，不生成。
             */
            const matched = await matchStage({
                song: {
                    title: songTitle,
                    artist: currentSong.artists?.map((artist) => artist?.name).filter(Boolean).join('、') ?? '',
                    album: currentSong.album?.name ?? null,
                },
                lines: lyrics?.lines ?? [],
                songTitle,
                isPureMusic,
                platform: resolveSongPlatform(currentSong),
                require: 'theme',
            });
            if (matched?.theme && applyAiThemeFromOutside(matched.theme)) {
                setStatusMessage({ type: 'success', text: t('ui.aiThemeCloudPulled') });
                return;
            }

            /*
             * 老数据的兜底：早先同步上去的主题存在 kind='theme'（按歌名 + 歌手算键）里，
             * 舞台那条链路上没有。两条都问过才算真的没有。
             */
            /* 带歌词：主题那条路也要过高亮词，不然舞台那道判住的东西从这儿照旧进来。 */
            const legacy = await pullAiThemeFromCloud(songRef, allText);
            if (legacy && applyAiThemeFromOutside(legacy)) {
                setStatusMessage({ type: 'success', text: t('ui.aiThemeCloudPulled') });
                return;
            }

            /*
             * 云端真没有，而本机改过 → 把这一版贡献上去。
             *
             * 推上去的内容现在才问：面板那一行拿到的是按当前明暗挑出来的一半，
             * 而云端存的是整份（浅 + 深）—— 见 aiThemeApplyBridge。
             */
            const theme = readCurrentAiTheme();
            if (locallyEdited && theme) {
                const pushed = await pushAiThemeToCloud(songRef, theme);
                setStatusMessage({
                    type: pushed ? 'success' : 'info',
                    text: t(pushed ? 'ui.aiThemeCloudPushed' : 'ui.aiThemeCloudPushFailed'),
                });
                return;
            }

            setStatusMessage({ type: 'info', text: t('ui.aiThemeCloudMiss') });
        } finally {
            holdComplete();
        }
    }, [currentSong, holdComplete, locallyEdited, lyrics, syncState, t]);

    return { syncState, runSync };
};

export default useAiThemeCloudSync;
