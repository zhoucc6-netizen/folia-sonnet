import { DualTheme, Theme } from '../types';
import { applyStoredAnimationIntensityToDualTheme } from '../services/themePreferences';
import { FALLBACK_AI_DUAL_THEME } from '../services/themeSanitizer';
import { generateBuiltinDualTheme } from '../utils/builtinTheme/generateBuiltinDualTheme';

export type ThemeSourceKind = 'default' | 'ai' | 'custom';
export type EditableThemeSourceKind = 'ai' | 'custom';

export type ThemeSourceOption = {
    source: ThemeSourceKind;
    available: boolean;
    editable: boolean;
    theme: Theme | null;
    label: string;
    swatchColor: string;
};

export type ThemeSourceModel = {
    activeSource: ThemeSourceKind;
    current: ThemeSourceOption;
    options: Record<ThemeSourceKind, ThemeSourceOption>;
    editableSource: EditableThemeSourceKind | null;
    canOpenQuickEditor: boolean;
    hasLocalAiTheme: boolean;
};

export const getBaseThemeForMode = ({
    defaultTheme,
    daylightTheme,
    isDaylight,
}: {
    defaultTheme: Theme;
    daylightTheme: Theme;
    isDaylight: boolean;
}): Theme => {
    return isDaylight ? daylightTheme : defaultTheme;
};

const getSelectedDualTheme = (dualTheme: DualTheme, isDaylight: boolean) => (
    isDaylight ? dualTheme.light : dualTheme.dark
);

const buildThemeSourceOption = (
    source: ThemeSourceKind,
    theme: Theme | null,
    available: boolean,
    editable: boolean,
): ThemeSourceOption => ({
    source,
    available,
    editable,
    theme,
    label: theme?.name ?? '',
    swatchColor: theme?.backgroundColor ?? 'transparent',
});

export const buildThemeSourceModel = ({
    bgMode,
    aiTheme,
    legacyTheme,
    customTheme,
    isDaylight,
    defaultTheme,
    daylightTheme,
    currentSongHasLocalAiTheme,
}: {
    bgMode: ThemeSourceKind;
    aiTheme: DualTheme | null;
    legacyTheme: Theme | null;
    customTheme: DualTheme | null;
    isDaylight: boolean;
    defaultTheme: Theme;
    daylightTheme: Theme;
    currentSongHasLocalAiTheme: boolean;
}): ThemeSourceModel => {
    const defaultSourceTheme = getBaseThemeForMode({ defaultTheme, daylightTheme, isDaylight });
    const aiSourceTheme = aiTheme
        ? getSelectedDualTheme(aiTheme, isDaylight)
        : legacyTheme ?? getSelectedDualTheme(FALLBACK_AI_DUAL_THEME, isDaylight);
    const customSourceTheme = customTheme
        ? getSelectedDualTheme(customTheme, isDaylight)
        : null;

    const options: Record<ThemeSourceKind, ThemeSourceOption> = {
        default: buildThemeSourceOption('default', defaultSourceTheme, true, false),
        ai: buildThemeSourceOption('ai', aiSourceTheme, true, Boolean(aiTheme || !legacyTheme)),
        custom: buildThemeSourceOption('custom', customSourceTheme, Boolean(customTheme), Boolean(customTheme)),
    };

    const activeSource = options[bgMode]?.available ? bgMode : 'default';
    const editableSource = options[activeSource].editable && activeSource !== 'default'
        ? activeSource
        : null;

    return {
        activeSource,
        current: options[activeSource],
        options,
        editableSource,
        canOpenQuickEditor: options.ai.editable || options.custom.editable,
        hasLocalAiTheme: currentSongHasLocalAiTheme,
    };
};

export const buildDefaultCustomDualTheme = ({
    defaultTheme,
    daylightTheme,
}: {
    defaultTheme: Theme;
    daylightTheme: Theme;
}): DualTheme => applyStoredAnimationIntensityToDualTheme({
    light: {
        ...daylightTheme,
        wordColors: [],
        lyricsIcons: [],
        provider: 'Custom',
    },
    dark: {
        ...defaultTheme,
        wordColors: [],
        lyricsIcons: [],
        provider: 'Custom',
    },
});

export const resolveBgModeTheme = ({
    mode,
    aiTheme,
    isDaylight,
    defaultTheme,
    daylightTheme,
    // 接住但不读：高亮词 / 歌词图标改回「跟着选中的主题走」之后这里不再需要它
    // （见下面 default 分支的注释）。留在签名里，调用方与既有测试照旧传。
}: {
    mode: 'default' | 'ai';
    aiTheme: DualTheme | null;
    isDaylight: boolean;
    defaultTheme: Theme;
    daylightTheme: Theme;
    previousTheme?: Theme;
}): Theme => {
    if (mode === 'default') {
        const baseTheme = getBaseThemeForMode({ defaultTheme, daylightTheme, isDaylight });
        if (!aiTheme) {
            return baseTheme;
        }

        const selectedAiTheme = isDaylight ? aiTheme.light : aiTheme.dark;
        /*
         * 高亮词与歌词图标是**这首歌**的：跟着选中的那份主题走，不从上一份主题里继承。
         *
         * 以前这两项取的是 `previousTheme` 的。第一次走到这里时上一份是默认主题
         * （高亮词为空），于是 AI 主题的配色照样换上、高亮词却永远是空的 —— 之后
         * previousTheme 自己也变成空，再也回不来。表现就是「AI 主题生效了，但歌词
         * 没有 AI 高亮」。继承上一首歌的高亮词本身也不对：那是照着别一首的歌词挑的。
         */
        return {
            ...selectedAiTheme,
            backgroundColor: baseTheme.backgroundColor,
        };
    }

    const selectedAiTheme = aiTheme
        ? getSelectedDualTheme(aiTheme, isDaylight)
        : getSelectedDualTheme(FALLBACK_AI_DUAL_THEME, isDaylight);
    return selectedAiTheme;
};

// Cover-derived fallback theme used when no AI API key is configured; the color/name work lives
// in utils/builtinTheme, this only keeps the stored animation intensity applied.
export const buildBuiltinDualTheme = ({
    coverColors = [],
    random,
}: {
    coverColors?: string[];
    random?: () => number;
} = {}): DualTheme => applyStoredAnimationIntensityToDualTheme(
    generateBuiltinDualTheme({ coverColors, random }),
);
