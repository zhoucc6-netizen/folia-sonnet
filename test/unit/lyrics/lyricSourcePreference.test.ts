import { describe, expect, it } from 'vitest';
import type { LyricProviderSource, LyricSourcePreference } from '@/types';
import { resolveLyricSourcePreference } from '@/utils/lyrics/lyricSourcePreference';

// test/unit/lyrics/lyricSourcePreference.test.ts
// 「跟随播放平台来源」不是一个能发请求的平台：每个消费点传 preferredSource 之前都要先过
// resolveLyricSourcePreference。漏掉一处不会报错，只会静默退回兜底顺序 —— 优先级看着「没生效」。

const settings = (preference: LyricSourcePreference, local: LyricProviderSource = 'qq') => ({
    preferredAlternativeLyricSource: preference,
    localLyricProviderSource: local,
});

const onlineSong = (providerId: string) => ({ sourceRef: { kind: 'online' as const, providerId, mediaId: '1' } });

describe('resolveLyricSourcePreference', () => {
    it('passes a concrete preference through untouched', () => {
        expect(resolveLyricSourcePreference(settings('netease'))).toBe('netease');
        expect(resolveLyricSourcePreference(settings('amll'), onlineSong('qq'))).toBe('amll');
    });

    it('follows the provider an online song came from', () => {
        expect(resolveLyricSourcePreference(settings('follow-source'), onlineSong('kugou'))).toBe('kugou');
        expect(resolveLyricSourcePreference(settings('follow-source'), onlineSong('netease'))).toBe('netease');
        expect(resolveLyricSourcePreference(settings('follow-source'), onlineSong('qq'))).toBe('qq');
    });

    it('falls back to the local-song source when the song carries no provider', () => {
        // 本地文件 / Navidrome：没有 sourceRef，也传不进来。
        expect(resolveLyricSourcePreference(settings('follow-source'))).toBe('qq');
        expect(resolveLyricSourcePreference(settings('follow-source', 'kugou'))).toBe('kugou');
        // 平台不认识（将来新接的源）时同样走本地那一项，不会拿到 undefined。
        expect(resolveLyricSourcePreference(settings('follow-source', 'netease'), onlineSong('future-provider'))).toBe('netease');
    });

    it('never returns follow-source itself', () => {
        expect(resolveLyricSourcePreference(settings('follow-source'))).not.toBe('follow-source');
    });
});
