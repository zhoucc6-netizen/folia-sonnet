import { describe, expect, it } from 'vitest';
import {
    buildColorOsLyricInfo,
    buildColorOsLyricInfoFromLyricData,
} from '@/utils/lyrics/colorOsLyricInfo';
import type { Line, LyricData } from '@/types';

// test/unit/lyrics/colorOsLyricInfo.test.ts
// ColorOS 原生锁屏歌词的 payload 契约（ColorOS-Live-Lyrics-Bridge 的播放器接入协议）。
// 这里锁的是「协议形状」：时间必须是绝对毫秒、逐行 lane 必须存在、没有真逐字时不许伪造。

const line = (overrides: Partial<Line> & { fullText: string; startTime: number }): Line => ({
    words: [],
    endTime: overrides.startTime + 2,
    ...overrides,
});

describe('buildColorOsLyricInfo', () => {
    it('没有歌词行时不产出 payload', () => {
        expect(buildColorOsLyricInfo({ lines: [] })).toBeNull();
        expect(buildColorOsLyricInfo({ lines: [line({ fullText: '   ', startTime: 1 })] })).toBeNull();
    });

    it('逐行 lane 用绝对时间的 mm:ss.mmm 标签', () => {
        const result = buildColorOsLyricInfo({
            title: '歌',
            artist: '人',
            songId: '42',
            durationMs: 180_000,
            lines: [
                line({ fullText: '第一句', startTime: 10 }),
                line({ fullText: '第二句', startTime: 14.5 }),
            ],
        });
        expect(result).not.toBeNull();
        const payload = JSON.parse(result!.lyricInfo);
        expect(payload.lyric).toBe('[00:10.000]第一句\n[00:14.500]第二句\n');
        expect(payload.lyricType).toBe(0);
        expect(payload.noLyric).toBe(false);
        expect(payload.trackKey).toBe('42|歌|人|180');
        expect(result!.hasTranslation).toBe(false);
    });

    it('只有逐行时间时不伪造逐字 lane', () => {
        const result = buildColorOsLyricInfo({
            lines: [line({
                fullText: '第一句',
                startTime: 10,
                words: [
                    { text: '第一', startTime: 10, endTime: 10.7 },
                    { text: '句', startTime: 10.7, endTime: 12.8 },
                ],
            })],
        });
        const payload = JSON.parse(result!.lyricInfo);
        expect(payload.rawLyric).toBeUndefined();
    });

    it('逐字 lane 写的是绝对时间，末尾再补一个结束标签', () => {
        const result = buildColorOsLyricInfo({
            lines: [line({
                fullText: '第一句',
                startTime: 10,
                endTime: 12.8,
                words: [
                    { text: '第一', startTime: 10, endTime: 10.7 },
                    { text: '句', startTime: 10.7, endTime: 12.8 },
                ],
            })],
            isWordByWord: true,
        });
        const payload = JSON.parse(result!.lyricInfo);
        expect(payload.rawLyric)
            .toBe('[00:10.000]<00:10.000>第一<00:10.700>句<00:12.800>\n');
    });

    it('西文歌词的词间空格不会被拼掉', () => {
        const result = buildColorOsLyricInfo({
            lines: [line({
                fullText: 'Hello World',
                startTime: 1,
                endTime: 2,
                words: [
                    { text: 'Hello', startTime: 1, endTime: 1.2 },
                    { text: 'World', startTime: 1.3, endTime: 1.6 },
                ],
            })],
            isWordByWord: true,
        });
        const payload = JSON.parse(result!.lyricInfo);
        expect(payload.rawLyric).toContain('Hello ');
        expect(payload.rawLyric).not.toContain('HelloWorld');
    });

    it('翻译走独立 lane，并标记 hasTranslation', () => {
        const result = buildColorOsLyricInfo({
            lines: [
                line({ fullText: '第一句', startTime: 10, translation: 'First line' }),
                line({ fullText: '第二句', startTime: 14.5 }),
            ],
        });
        const payload = JSON.parse(result!.lyricInfo);
        expect(payload.translationLyric).toBe('[00:10.000]First line\n');
        expect(result!.hasTranslation).toBe(true);
    });

    it('行起点倒退时被夹成单调不减', () => {
        const result = buildColorOsLyricInfo({
            lines: [
                line({ fullText: '后到的行', startTime: 20 }),
                line({ fullText: '时间倒退的行', startTime: 5 }),
            ],
        });
        const payload = JSON.parse(result!.lyricInfo);
        expect(payload.lyric).toBe('[00:20.000]后到的行\n[00:20.000]时间倒退的行\n');
    });

    it('只有部分行有逐字时间时整首都不给逐字 lane', () => {
        const result = buildColorOsLyricInfo({
            lines: [
                line({
                    fullText: '有逐字',
                    startTime: 1,
                    words: [
                        { text: '有', startTime: 1, endTime: 1.4 },
                        { text: '逐字', startTime: 1.5, endTime: 2 },
                    ],
                }),
                line({ fullText: '没逐字', startTime: 3 }),
            ],
            isWordByWord: true,
        });
        const payload = JSON.parse(result!.lyricInfo);
        expect(payload.rawLyric).toBeUndefined();
    });

    it('文本里的换行会被压平，不会把一行拆成两条记录', () => {
        const result = buildColorOsLyricInfo({
            lines: [line({ fullText: '上行\n下行', startTime: 1 })],
        });
        const payload = JSON.parse(result!.lyricInfo);
        expect(payload.lyric).toBe('[00:01.000]上行 下行\n');
    });
});

describe('buildColorOsLyricInfoFromLyricData', () => {
    it('没有 LyricData 时返回 null', () => {
        expect(buildColorOsLyricInfoFromLyricData(null, { title: 'x' }, 1)).toBeNull();
    });

    it('代次写进 sessionGeneration', () => {
        const lyricData: LyricData = {
            lines: [line({ fullText: '一句', startTime: 1 })],
            isWordByWord: false,
        };
        const result = buildColorOsLyricInfoFromLyricData(lyricData, { title: '歌' }, 7);
        expect(JSON.parse(result!.lyricInfo).sessionGeneration).toBe(7);
    });
});
