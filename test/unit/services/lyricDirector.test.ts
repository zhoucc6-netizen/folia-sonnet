import { beforeEach, describe, expect, it } from 'vitest';
import {
    buildParamSpec,
    gatesFor,
    gateSatisfied,
    isBlockedDirectorMode,
    isInertValue,
    isKnownDirectorMode,
    listDirectorModes,
    MODE_PARAMS,
    sanitizeParams,
    tuningStateKey,
} from '../../../src/services/lyricDirector/catalog';
import {
    buildLyricSnippet,
    buildSourcePrompt,
    buildSystemPrompt,
    extractJsonText,
    MAX_LINES_IN_PROMPT,
} from '../../../src/services/lyricDirector/prompt';
import {
    clearSnapshot,
    DEFAULT_BLOCKED_DIRECTOR_MODES,
    noteRecentMode,
    readDirectorSettings,
    readRecentModes,
    readSnapshot,
    updateDirectorSettings,
    writeSnapshotOnce,
} from '../../../src/services/lyricDirector/state';
import { BUILTIN_VISUALIZER_MODES } from '../../../src/types/visualizerModes';

// test/unit/services/lyricDirector.test.ts
// The parts of the AI lyric animation director that must not drift: the mode
// catalogue the prompt is built from, the validation that keeps an answer inside
// what the player can express, and the per-song memory.

describe('lyric director catalogue', () => {
    it('knows every built-in mode', () => {
        (BUILTIN_VISUALIZER_MODES as readonly string[]).forEach((mode) => {
            expect(MODE_PARAMS[mode], `${mode} has no parameter space`).toBeTruthy();
        });
        expect(isKnownDirectorMode('sonnet')).toBe(true);
        expect(isKnownDirectorMode('mod:whatever')).toBe(false);
        expect(isKnownDirectorMode(undefined)).toBe(false);
    });

    it('names every mode in the list handed to the AI', () => {
        const modes = listDirectorModes();
        expect(modes.map((mode) => mode.id).sort()).toEqual([...BUILTIN_VISUALIZER_MODES].sort());
        modes.forEach((mode) => {
            expect(mode.label.length).toBeGreaterThan(0);
        });
    });

    it('drops keys the mode cannot express and clamps the rest', () => {
        const cleaned = sanitizeParams('sonnet', {
            // 商奈的相机强度上限定在 0.7（不是 setter 的 2）：这一档的相机运动叠上分镜与转场
            // 之后，再高容易把画面甩出屏幕外。数就写死在这里，谁动了那条线都要在这里显形。
            cameraIntensity: 9,
            typographyMotion: 1.5,
            notAThing: true,
            postProcessEnabled: 'true', // strings are accepted for booleans
        });
        expect(cleaned).toEqual({ cameraIntensity: 0.7, typographyMotion: 1.5, postProcessEnabled: true });
    });

    it('refuses values outside a select and non-numeric numbers', () => {
        expect(sanitizeParams('sonnet', { outerFrameMode: 'frame' })).toEqual({ outerFrameMode: 'frame' });
        expect(sanitizeParams('sonnet', { outerFrameMode: 'pyramid' })).toEqual({});
        expect(sanitizeParams('sonnet', { cameraIntensity: 'loud' })).toEqual({});
        expect(sanitizeParams('still', { anything: 1 })).toEqual({});
        expect(sanitizeParams('sonnet', null)).toEqual({});
    });

    it('maps a tuning setter to the store field it writes', () => {
        expect(tuningStateKey('handleSetSonnetTuning')).toBe('sonnetTuning');
        expect(tuningStateKey(null)).toBeNull();
    });

    it('spells out the switch a gated parameter needs', () => {
        expect(gatesFor('sonnet', 'postProcessGrain')).toEqual([{ key: 'postProcessEnabled', mustBe: true }]);
        // sonnet's mgDensity needs two switches at once.
        expect(gatesFor('sonnet', 'mgDensity')).toHaveLength(2);
        expect(gatesFor('classic', 'breathingFloatMultiplier')).toEqual([]);

        const spec = buildParamSpec();
        expect(spec.sonnet).toContain('postProcessGrain(0~1)[需 postProcessEnabled=true]');
        // Every classic parameter but one is ungated, and cadenza has no gates at all.
        expect(spec.classic).toContain('wordSpacing(0~2)[需 useLegacyLayout=false]');
        expect(spec.cadenza).not.toContain('[需');
    });

    it('treats a value that asks for less as never blocked', () => {
        expect(gateSatisfied({ postProcessEnabled: false }, { key: 'postProcessEnabled', mustBe: true })).toBe(false);
        expect(gateSatisfied({ postProcessEnabled: true }, { key: 'postProcessEnabled', mustBe: true })).toBe(true);
        // No tuning read means we cannot prove the gate is closed.
        expect(gateSatisfied(null, { key: 'postProcessEnabled', mustBe: true })).toBe(true);
        expect(gateSatisfied({ showGearDecor: 'none' }, { key: 'showGearDecor', not: 'none' })).toBe(false);

        expect(isInertValue({ kind: 'boolean', zh: 'x' }, false)).toBe(true);
        expect(isInertValue({ kind: 'number', min: 0, max: 2, zh: 'x' }, 0)).toBe(true);
        expect(isInertValue({ kind: 'number', min: 0, max: 2, zh: 'x' }, 1)).toBe(false);
    });
});

describe('lyric director prompt', () => {
    it('says so when a track has no lyrics', () => {
        expect(buildLyricSnippet([])).toBe('(这首歌没有歌词)');
    });

    it('keeps sonnet\u2019s camera motion inside its safe range, in the rule and in the list', () => {
        // 真机现象：商奈档把镜头运动调高之后画面会甩出屏幕外。规则要写在系统提示词里，而参数
        // 清单里那个范围也得跟着收紧 —— 清单写着 0~2 而规则说 0.7，模型会按清单走。
        const prompt = buildSystemPrompt();
        expect(prompt).toContain('商奈');
        expect(prompt).toContain('cameraIntensity');
        expect(prompt).toContain('0.7');
        expect(buildParamSpec().sonnet).toContain('cameraIntensity(0~0.7)');
    });

    it('samples long lyrics instead of sending all of them', () => {
        const lines = Array.from({ length: 400 }, (_unused, index) => ({
            fullText: `line ${index}`,
            translation:'',
            songPart: index % 3 === 0 ? 'Chorus' : '',
            isChorus: index % 3 === 0,
        }));
        const snippet = buildLyricSnippet(lines);
        const picked = snippet.split('\n');
        expect(picked.length).toBeLessThanOrEqual(MAX_LINES_IN_PROMPT);
        // Sampled, not truncated: the tail of the song is represented too.
        expect(picked.length).toBeGreaterThan(1);
        expect(picked[picked.length - 1]).toContain('line');
        expect(snippet).toContain('[Chorus]');
        expect(snippet).toContain('[副歌]');
    });

    it('digs the object out of a fenced or chatty answer', () => {
        expect(extractJsonText('```json\n{"mode":"sonnet"}\n```')).toBe('{"mode":"sonnet"}');
        expect(extractJsonText('Sure! {"mode":"sonnet"} hope that helps')).toBe('{"mode":"sonnet"}');
        expect(extractJsonText('{"mode":"sonnet"}')).toBe('{"mode":"sonnet"}');
    });

    it('leaves a blocked mode out of both the mode list and the parameter space', () => {
        const blocked = ['lumiere', 'still'];
        const modes = listDirectorModes().filter((mode) => !isBlockedDirectorMode(mode.id, blocked));
        expect(modes.map((mode) => mode.id)).not.toContain('lumiere');
        const prompt = buildSourcePrompt({
            song: null,
            lines: [],
            modes,
            currentMode: 'classic',
            blockedModes: blocked,
        });
        expect(prompt).not.toContain('lumiere');
        expect(prompt).not.toContain('still');
        // The rest of the modes are still offered, parameters included.
        expect(prompt).toContain('sonnet');
        expect(prompt).toContain('各模式可调参数');
    });

    it('shows the AI the mode list, the parameter space and this song', () => {
        const prompt = buildSourcePrompt({
            song: { title: '晴天', artist: '周杰伦', album: '叶惠美' },
            lines: [{ fullText: '故事的小黄花', translation: '', songPart: '', isChorus: false }],
            modes: listDirectorModes(),
            currentMode: 'classic',
            userHint: '安静一点',
            recentModes: ['sonnet', 'sonnet', 'fume'],
            previousChoice: { mode: 'fume', params: { cameraSpeed: 1 }, reason: '纸质感更贴', forced: false },
        });
        expect(prompt).toContain('歌曲：晴天');
        expect(prompt).toContain('用户偏好：安静一点');
        expect(prompt).toContain('这首歌上次的选择：fume');
        // Recent modes are deduplicated and named with their label.
        expect(prompt).toContain('最近用过的模式（新→旧）：');
        expect(prompt.match(/sonnet/g)?.length ?? 0).toBeGreaterThan(0);
        expect(prompt).toContain('可选模式：');
        expect(prompt).toContain('各模式可调参数');
        expect(prompt).toContain('故事的小黄花');
    });
});

describe('lyric director memory', () => {
    beforeEach(() => {
        clearSnapshot();
    });

    it('keeps the recent modes newest first, deduplicated and capped', () => {
        ['classic', 'fume', 'classic', 'tilt'].forEach((mode) => noteRecentMode(mode));
        expect(readRecentModes()[0]).toBe('tilt');
        expect(readRecentModes().filter((mode) => mode === 'classic')).toHaveLength(1);
        for (let index = 0; index < 20; index += 1) noteRecentMode(`mode-${index}`);
        expect(readRecentModes().length).toBeLessThanOrEqual(8);
    });

    it('blocks the two modes that ship blocked by default', () => {
        const settings = readDirectorSettings();
        expect(settings.blockedModes).toEqual(expect.arrayContaining(['lumiere', 'still']));
        settings.blockedModes.forEach((mode) => expect(isKnownDirectorMode(mode)).toBe(true));
        expect(isBlockedDirectorMode('lumiere', settings.blockedModes)).toBe(true);
        expect(isBlockedDirectorMode('sonnet', settings.blockedModes)).toBe(false);
        expect(isBlockedDirectorMode('sonnet', undefined)).toBe(false);

        updateDirectorSettings({ blockedModes: ['sonnet'] });
        expect(readDirectorSettings().blockedModes).toEqual(['sonnet']);
        updateDirectorSettings({ blockedModes: [...DEFAULT_BLOCKED_DIRECTOR_MODES] });
    });

    it('keeps the first snapshot and only the first', () => {
        expect(readSnapshot()).toBeNull();
        writeSnapshotOnce({ mode: 'classic', tunings: {}, at: 1 });
        writeSnapshotOnce({ mode: 'sonnet', tunings: {}, at: 2 });
        expect(readSnapshot()?.mode).toBe('classic');
    });

    it('stores behaviour settings with defaults', () => {
        // Both "allow the AI to…" switches default to on: that is what Settings → AI promises.
        expect(readDirectorSettings()).toMatchObject({
            autoOnSongChange: true,
            rememberPerSong: true,
            applyParams: true,
            prefetchNext: true,
        });
        updateDirectorSettings({ applyParams: true, userHint: '多来点转场' });
        const settings = readDirectorSettings();
        expect(settings.applyParams).toBe(true);
        expect(settings.userHint).toBe('多来点转场');
        updateDirectorSettings({ applyParams: false, userHint: '' });
    });
});
