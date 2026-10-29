// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeController, type GenerateAIThemeResult } from '@/hooks/useThemeController';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { setStatusMessage, useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { FALLBACK_AI_DUAL_THEME } from '@/services/themeSanitizer';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import i18n from '@/i18n/config';
import type { DualTheme, LyricData, SongResult } from '@/types';

// Drive the real hook and stores with deferred AI, artwork and cache IO.
const io = vi.hoisted(() => ({
    generate: vi.fn(), save: vi.fn(), cached: vi.fn(), lastDual: vi.fn(),
    lastLegacy: vi.fn(), sync: vi.fn(), colors: vi.fn(), fromCache: vi.fn(),
}));
// 本 fork 的主链路走 services/gemini 那一版同名函数（经 requestStage 编排、进出云缓存），
// 不是 services/aiText 那版直连的 —— 上游这套用例 mock 的是 aiText，于是在这里拦不到任何
// 调用，真实现会去问模型并失败。mock 换成 gemini，且它返回的是 { theme, source } 而不是
// 一个裸主题（`source` 决定界面说「生成成功」还是「已从云端拉取缓存」）。
vi.mock('@/services/gemini', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/services/gemini')>(),
    generateThemeFromLyrics: io.generate,
}));
// `getFromCache` 是 fork 侧 aiThemeCloud 用来读「本机改过那一版」的（恢复云端版本时要先看它），
// 上游这套用例的 mock 里没有它，缺导出会直接抛在恢复路径上。
vi.mock('@/services/db', () => ({ saveToCache: io.save, getFromCache: io.fromCache }));
vi.mock('@/services/themeCache', () => ({
    getCachedThemeState: io.cached,
    getCachedThemeStateForSong: io.cached,
    getLastDualTheme: io.lastDual,
    getLastLegacyTheme: io.lastLegacy,
}));
vi.mock('@/services/sync/syncRepository', () => ({ saveSyncedThemeForSong: io.sync }));
vi.mock('@/utils/colorExtractor', () => ({ extractColors: io.colors }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = (id: number): SongResult => ({
    id, name: `Song ${id}`, artists: [], album: { id, name: 'Album' }, durationMs: 60_000,
});
const SONG_A = song(1), SONG_B = song(2);
const theme = (name: string): DualTheme => ({
    light: { ...FALLBACK_AI_DUAL_THEME.light, name: `${name} light` },
    dark: { ...FALLBACK_AI_DUAL_THEME.dark, name: `${name} dark` },
});
const THEME_A = theme('A'), THEME_B = theme('B');
/** services/gemini 的 generateThemeFromLyrics 回的是主题 + 这份答案从哪来。 */
type ThemeAnswer = { theme: DualTheme; source: 'ai' | 'cloud' };
const answer = (theme: DualTheme, source: ThemeAnswer['source'] = 'ai'): ThemeAnswer => ({ theme, source });
const lyrics: LyricData = {
    lines: [{ fullText: 'A lyric to color', startTime: 0, endTime: 1, words: [] }],
};
const cacheKey = (value: SongResult) => `dual_theme_${getPlaybackSongKey(value)}`;
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof useThemeController>;
let cache: Map<string, DualTheme>;
const Probe = () => {
    controller = useThemeController({
        defaultTheme: FALLBACK_AI_DUAL_THEME.dark, daylightTheme: FALLBACK_AI_DUAL_THEME.light,
        isDaylight: false, setDaylightPreference() {}, coverUrl: 'cover-a.png', t: key => key,
    });
    return null;
};
const mount = (source: 'ai' | 'cover' = 'ai') => {
    localStorage.setItem('theme_generation_source', source);
    act(() => root.render(createElement(Probe)));
};
const start = (value: SongResult | null = SONG_A, options = {}) => {
    let request!: Promise<GenerateAIThemeResult>;
    act(() => { request = controller.generateAITheme(lyrics, value, options); });
    return request;
};
const finish = async (request: Promise<GenerateAIThemeResult>, release: () => void) => {
    let result!: GenerateAIThemeResult;
    await act(async () => { release(); result = await request; });
    return result;
};
const visibleState = () => ({
    theme: controller.theme, source: controller.bgMode,
    hasLocalTheme: controller.themeSourceModel.hasLocalAiTheme,
    message: useStatusMessageStore.getState().message,
    lastTheme: cache.get('last_dual_theme'),
});
const restoreB = async () => {
    usePlaybackStore.setState({ currentSong: SONG_B });
    cache.set(cacheKey(SONG_B), THEME_B);
    await act(async () => { await controller.restoreCachedThemeForSong(SONG_B); });
    setStatusMessage({ type: 'info', text: 'Song B is current' });
};

beforeEach(() => {
    Object.values(io).forEach(mock => mock.mockReset());
    localStorage.clear();
    cache = new Map();
    io.save.mockImplementation(async (key: string, value: DualTheme) => { cache.set(key, value); });
    io.cached.mockImplementation(async (value: SongResult) => {
        const cached = cache.get(cacheKey(value));
        return cached ? { kind: 'dual', theme: cached } : { kind: 'none' };
    });
    io.lastDual.mockResolvedValue(null);
    io.lastLegacy.mockResolvedValue(null);
    io.sync.mockResolvedValue(undefined);
    io.colors.mockResolvedValue(['#2288cc']);
    io.fromCache.mockResolvedValue(null);
    usePlaybackStore.setState({ currentSong: SONG_A });
    useStatusMessageStore.setState({ message: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.body.appendChild(document.createElement('div'));
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlaybackStore.setState({ currentSong: null });
    vi.restoreAllMocks();
});

describe('theme generation request ownership', () => {
    it('caches a late manual result for A without overwriting B’s restored theme or status', async () => {
        const generated = deferred<ThemeAnswer>();
        io.generate.mockReturnValueOnce(generated.promise);
        mount();
        const request = start();
        expect(controller.isGeneratingTheme).toBe(true);
        await restoreB();
        const before = visibleState();

        expect(await finish(request, () => generated.resolve(answer(THEME_A)))).toEqual({ status: 'generated', applied: false });
        expect(visibleState()).toEqual(before);
        expect(cache.get(cacheKey(SONG_A))?.dark.name).toBe('A dark');
        expect(io.sync).toHaveBeenCalledWith(SONG_A, expect.anything(), 'manual');
        expect(controller.isGeneratingTheme).toBe(false);
    });

    it.each(['ai', 'cover'] as const)('respects shouldApply=false for %s, including the current-song cache indicator', async source => {
        const generated = deferred<ThemeAnswer>(), colors = deferred<string[]>();
        io.generate.mockReturnValueOnce(generated.promise);
        io.colors.mockReturnValueOnce(colors.promise);
        mount(source);
        const request = start(SONG_A, { source: 'auto', shouldApply: () => false });
        setStatusMessage({ type: 'info', text: 'Keep current state' });
        const before = visibleState();

        const result = await finish(request, () => {
            if (source === 'ai') generated.resolve(answer(THEME_A));
            else colors.resolve(['#2288cc']);
        });
        expect(result).toEqual({ status: 'generated', applied: false });
        expect(visibleState()).toEqual(before);
        expect(cache.has(cacheKey(SONG_A))).toBe(true);
        expect(controller.isGeneratingTheme).toBe(false);
    });

    it('does not apply an old missing-key cover fallback after B is restored', async () => {
        const colors = deferred<string[]>();
        io.generate.mockRejectedValueOnce(new Error('OpenAI API key not configured'));
        io.colors.mockReturnValueOnce(colors.promise);
        mount();
        const request = start();
        await act(async () => { await Promise.resolve(); });
        expect(io.colors).toHaveBeenCalledWith('cover-a.png', 5);
        await restoreB();
        const before = visibleState();

        expect(await finish(request, () => colors.resolve(['#2288cc']))).toEqual({ status: 'generated', applied: false });
        expect(visibleState()).toEqual(before);
        expect(cache.get(cacheKey(SONG_A))?.dark.provider).toBe('Built-in');
        expect(controller.isGeneratingTheme).toBe(false);
    });

    it('ignores an old failure when playback changes before the hook renders again', async () => {
        const generated = deferred<ThemeAnswer>();
        io.generate.mockReturnValueOnce(generated.promise);
        mount();
        const request = start();
        setStatusMessage({ type: 'info', text: 'Song B is current' });
        const before = visibleState();

        const result = await finish(request, () => {
            usePlaybackStore.setState({ currentSong: SONG_B });
            generated.reject(new Error('Network unavailable'));
        });
        expect(result).toEqual({ status: 'failed' });
        expect(visibleState()).toEqual(before);
        expect(controller.isGeneratingTheme).toBe(false);
    });

    it('checks the song again after saving the generated theme finishes', async () => {
        const saved = deferred<void>();
        io.generate.mockResolvedValueOnce(answer(THEME_A));
        io.save.mockImplementationOnce(async (key: string, value: DualTheme) => {
            await saved.promise;
            cache.set(key, value);
        });
        mount();
        const request = start();
        await act(async () => { await Promise.resolve(); });
        expect(io.save).toHaveBeenCalledWith(cacheKey(SONG_A), expect.anything());
        usePlaybackStore.setState({ currentSong: SONG_B });
        setStatusMessage({ type: 'info', text: 'Song B is current' });
        const before = visibleState();

        expect(await finish(request, () => saved.resolve())).toEqual({ status: 'generated', applied: false });
        expect(visibleState()).toEqual(before);
        expect(cache.get(cacheKey(SONG_A))?.dark.name).toBe('A dark');
        expect(controller.isGeneratingTheme).toBe(false);
    });

    it('can apply the pending A result after switching A → B → A', async () => {
        const generated = deferred<ThemeAnswer>();
        io.generate.mockReturnValueOnce(generated.promise);
        mount();
        const request = start();
        usePlaybackStore.setState({ currentSong: SONG_B });
        usePlaybackStore.setState({ currentSong: { ...SONG_A } });

        expect(await finish(request, () => generated.resolve(answer(THEME_A)))).toEqual({ status: 'generated', applied: true });
        expect(controller.theme.name).toBe('A dark');
        expect(controller.themeSourceModel.hasLocalAiTheme).toBe(true);
        expect(controller.isGeneratingTheme).toBe(false);
    });

    it('does not confuse equal song ids from different providers', async () => {
        const generated = deferred<ThemeAnswer>();
        const otherProvider: SongResult = {
            ...SONG_A, sourceRef: { kind: 'online', providerId: 'qq', mediaId: String(SONG_A.id) },
        };
        io.generate.mockReturnValueOnce(generated.promise);
        mount();
        const request = start();
        usePlaybackStore.setState({ currentSong: otherProvider });
        setStatusMessage({ type: 'info', text: 'QQ song is current' });
        const before = visibleState();

        expect(await finish(request, () => generated.resolve(answer(THEME_A)))).toEqual({ status: 'generated', applied: false });
        expect(visibleState()).toEqual(before);
        expect(cache.has(cacheKey(SONG_A))).toBe(true);
        expect(cache.has(cacheKey(otherProvider))).toBe(false);
        expect(controller.isGeneratingTheme).toBe(false);
    });

    it('applies a current-song result, skips a duplicate in flight, and allows another request after completion', async () => {
        const generated = deferred<ThemeAnswer>();
        io.generate.mockReturnValueOnce(generated.promise).mockResolvedValueOnce(answer(THEME_A));
        mount();
        const request = start();
        let duplicate!: GenerateAIThemeResult;
        await act(async () => { duplicate = await controller.generateAITheme(lyrics, SONG_A); });
        expect(duplicate).toEqual({ status: 'skipped', reason: 'in-flight' });
        expect(io.generate).toHaveBeenCalledTimes(1);

        expect(await finish(request, () => generated.resolve(answer(THEME_A)))).toEqual({ status: 'generated', applied: true });
        expect(controller.theme.name).toBe('A dark');
        expect(controller.themeSourceModel.hasLocalAiTheme).toBe(true);
        expect(cache.get('last_dual_theme')?.dark.name).toBe('A dark');
        // 主链路走 fork 的 notifyStageResolved：这次真调了模型，所以是「生成成功」那条文案
        // （命中云缓存时才会换成「已从云端拉取缓存」）。上游那句带主题名的 themeApplied 在本
        // fork 已经没人用了。
        expect(useStatusMessageStore.getState().message).toMatchObject({ type: 'info' });
        expect(useStatusMessageStore.getState().message?.text).toBe(i18n.t('status.themeGenerated'));
        expect(controller.isGeneratingTheme).toBe(false);
        await act(async () => { await controller.generateAITheme(lyrics, SONG_A); });
        expect(io.generate).toHaveBeenCalledTimes(2);
    });

    it('keeps loading until both songs settle and reports a failure only for the current song', async () => {
        const a = deferred<ThemeAnswer>(), b = deferred<ThemeAnswer>();
        io.generate.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
        mount();
        const first = start();
        usePlaybackStore.setState({ currentSong: SONG_B });
        const second = start(SONG_B);

        expect(await finish(first, () => a.resolve(answer(THEME_A)))).toEqual({ status: 'generated', applied: false });
        expect(controller.isGeneratingTheme).toBe(true);
        expect(controller.themeSourceModel.hasLocalAiTheme).toBe(false);
        expect(await finish(second, () => b.reject(new Error('Network unavailable')))).toEqual({ status: 'failed' });
        expect(controller.isGeneratingTheme).toBe(false);
        expect(useStatusMessageStore.getState().message).toMatchObject({ type: 'error', text: 'status.themeGenerationFailed' });
    });

    it('can still generate from lyrics when there is no current song', async () => {
        io.generate.mockResolvedValueOnce(answer(THEME_A));
        usePlaybackStore.setState({ currentSong: null });
        mount();
        let result!: GenerateAIThemeResult;
        await act(async () => { result = await controller.generateAITheme(lyrics, null); });
        expect(result).toEqual({ status: 'generated', applied: true });
        expect(controller.theme.name).toBe('A dark');
        expect(controller.themeSourceModel.hasLocalAiTheme).toBe(false);
        expect(controller.isGeneratingTheme).toBe(false);
    });
});
