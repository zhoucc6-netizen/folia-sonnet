import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    createVideoExportPresets,
    DEFAULT_VIDEO_EXPORT_PRESET_ID,
    DEFAULT_VIDEO_EXPORT_PRESET_VALUES,
    sanitizeVideoExportPresetValues,
    VIDEO_EXPORT_PRESET_MAX,
    VIDEO_EXPORT_PRESET_MIN,
} from '../../types/videoExport';
import type { VideoExportPresetValues, VideoExportStartMode } from '../../types/videoExport';
import { sendRemoteCommand } from './remoteWindowBridge';

// src/components/remote/useRemoteExportDraft.ts
// 遥控窗口「导出视频」那一摊：四个预设的尺寸、正在编辑的那一份的宽高草稿、起录方式，
// 以及预设选择器弹层的开关。原先这些状态和卡片布局混在 1200 行的组件里，
// 拆到这里之后，卡片那边只剩「面板切到导出时把这一摊挂上去」。

const REMOTE_VIDEO_EXPORT_PRESET_VALUES_STORAGE_KEY = 'remote_video_export_preset_values';

const readStoredVideoExportPresetValues = (): VideoExportPresetValues => {
    if (typeof window === 'undefined') {
        return DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    }

    const raw = window.localStorage.getItem(REMOTE_VIDEO_EXPORT_PRESET_VALUES_STORAGE_KEY);
    if (!raw) {
        return DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    }

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? sanitizeVideoExportPresetValues(parsed)
            : DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    } catch {
        return DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    }
};

export const getCalculatedAspectRatio = (
    t: (key: string) => string,
    wStr: string,
    hStr: string,
) => {
    const w = Number(wStr);
    const h = Number(hStr);
    if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) {
        return '';
    }

    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const divisor = gcd(w, h);
    const aspectW = w / divisor;
    const aspectH = h / divisor;
    const orientationStr = w >= h ? t('remote.landscape') : t('remote.portrait');

    if (aspectW === 16 && aspectH === 9) {
        return `16:9 (${orientationStr})`;
    }
    if (aspectW === 9 && aspectH === 16) {
        return `9:16 (${orientationStr})`;
    }
    if (aspectW === 4 && aspectH === 3) {
        return `4:3 (${orientationStr})`;
    }
    if (aspectW === 3 && aspectH === 4) {
        return `3:4 (${orientationStr})`;
    }
    if (aspectW === 1 && aspectH === 1) {
        return `1:1 (${t('remote.square')})`;
    }
    if (aspectW === 21 && aspectH === 9) {
        return `21:9 (${orientationStr})`;
    }

    return `${aspectW}:${aspectH} (${orientationStr})`;
};

export const useRemoteExportDraft = () => {
    const { t } = useTranslation();
    const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_VIDEO_EXPORT_PRESET_ID);
    const [presetValues, setPresetValues] = useState<VideoExportPresetValues>(readStoredVideoExportPresetValues);
    const [draftWidth, setDraftWidth] = useState('');
    const [draftHeight, setDraftHeight] = useState('');
    const [startMode, setStartMode] = useState<VideoExportStartMode>('from-start');
    const [presetSelectorOpen, setPresetSelectorOpen] = useState(false);

    const exportPresets = useMemo(() => createVideoExportPresets(presetValues), [presetValues]);
    const selectedPreset = exportPresets.find(preset => preset.id === selectedPresetId) ?? exportPresets[1];

    // 选中哪一份预设，宽高草稿就跟着走：草稿是"还没保存"的编辑值，换预设等于放弃编辑。
    useEffect(() => {
        const activePreset = exportPresets.find(preset => preset.id === selectedPresetId);
        if (activePreset) {
            setDraftWidth(String(activePreset.width));
            setDraftHeight(String(activePreset.height));
        }
    }, [selectedPresetId, presetValues, exportPresets]);

    useEffect(() => {
        window.localStorage.setItem(REMOTE_VIDEO_EXPORT_PRESET_VALUES_STORAGE_KEY, JSON.stringify(presetValues));
    }, [presetValues]);

    const handleSelectExportPreset = (presetId: string) => {
        const nextPreset = exportPresets.find(item => item.id === presetId);
        if (!nextPreset) {
            return;
        }

        setSelectedPresetId(nextPreset.id);
        sendRemoteCommand({ type: 'resize-main-window', width: nextPreset.width, height: nextPreset.height });
    };

    const handleApplyCustomPresetValues = () => {
        const w = Number(draftWidth);
        const h = Number(draftHeight);
        if (!Number.isFinite(w) || !Number.isFinite(h)) {
            return;
        }

        const clampVal = (val: number, fallback: number) => {
            const integerVal = Math.round(val);
            const safeVal = Number.isFinite(integerVal) ? integerVal : fallback;
            const clampedVal = Math.min(VIDEO_EXPORT_PRESET_MAX, Math.max(VIDEO_EXPORT_PRESET_MIN, safeVal));
            return clampedVal % 2 === 0 ? clampedVal : clampedVal + 1;
        };

        const clampedW = clampVal(w, 1920);
        const clampedH = clampVal(h, 1080);

        const activeIndex = exportPresets.findIndex(preset => preset.id === selectedPresetId);
        if (activeIndex === -1) {
            return;
        }

        const nextPresetValues = [...presetValues] as VideoExportPresetValues;
        nextPresetValues[activeIndex] = { width: clampedW, height: clampedH };
        setPresetValues(nextPresetValues);

        sendRemoteCommand({ type: 'resize-main-window', width: clampedW, height: clampedH });
    };

    return {
        selectedPresetId,
        setSelectedPresetId,
        presetValues,
        draftWidth,
        setDraftWidth,
        draftHeight,
        setDraftHeight,
        startMode,
        setStartMode,
        presetSelectorOpen,
        setPresetSelectorOpen,
        exportPresets,
        selectedPreset,
        handleSelectExportPreset,
        handleApplyCustomPresetValues,
        aspectRatioLabel: getCalculatedAspectRatio(t, draftWidth, draftHeight),
    };
};

export type RemoteExportDraft = ReturnType<typeof useRemoteExportDraft>;
