// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// test/unit/sync-server/highlightEvidenceParity.test.ts
// 高亮词判定有**两份代码**：客户端拉缓存那一侧（`src/services/aiCloudCache.ts`）与服务端
// 上传校验那一侧（`sync-server/src/stageVerifier.ts`）。
//
// 规矩只有一条 —— 证据词必须在这首歌的歌词里 100% 全在 —— 但「哪些词算证据」是两张各自
// 写的表。这两张表一旦漂移，最典型的后果就是「客户端判得过的条目，服务端上传时被拒」
// （或反过来），而这种错不会报错，只会表现为「这首歌的缓存一会儿有一会儿没有」。
//
// 这里钉的是**两张表逐词一致**，不是「两边都实现了某个函数」：改一边忘改另一边，这里
// 立刻红。想改规矩就两边一起改，并在这个文件里补上对应的用例。

vi.mock('@/services/foliaCloud', () => ({
  isFoliaCloudCacheEnabled: () => false,
  resolveCloudApiUrl: (path: string) => `https://cloud.test/api/${path}`,
  DEFAULT_CLOUD_BASE_URL: 'https://cloud.test',
}));

vi.mock('@/services/aiNativeFetch', () => ({
  createAiFetch: () => async () => { throw new Error('不该发请求'); },
  fetchAiCacheViaNative: async () => null,
}));

vi.mock('@/services/aiCompletion', () => ({
  describeAiTarget: () => null,
}));

const { highlightEvidenceWords: clientEvidence } = await import('@/services/aiCloudCache');
const {
  highlightEvidenceWords: serverEvidence,
  highlightWordsPresent: serverPresent,
} = await import('../../../sync-server/src/stageVerifier');

/** 一张混着各种情况的词表：单字、虚词、实词、英文虚词、带空格的实词。 */
const MIXED = [
  '我', '你', '的', '了', '把', '什么', '自己', '一个', // 虚词与单字，全都不该算证据
  '留住', '绚烂', '小黄花', '荡秋千', 'rainbow', 'the', 'and', // 实词算，英文虚词不算
  '大 雨 过 后', // 压平之后仍是实词
  '', '   ', // 空串压平后长度为 0，不算
];

describe('客户端与服务端的证据词表是同一张', () => {
  it('两边挑出来的证据词一模一样', () => {
    expect(serverEvidence(MIXED)).toEqual(clientEvidence(MIXED));
  });

  it('单字与虚词两边都不算证据', () => {
    const filler = ['我', '你', '把', '什么', '的', '了', '一个', '自己', 'the', 'and'];
    expect(clientEvidence(filler)).toEqual([]);
    expect(serverEvidence(filler)).toEqual([]);
  });

  /* 服务端上传校验用的就是这一份判定：虚词凑出来的「命中」同样不算数。 */
  it('服务端也不拿虚词凑命中', () => {
    const lyric = '可那些与我无关\n麻烦总缠着我\n什么也不想说\n让我重新认识一个更好的你';
    expect(serverPresent(['留住', '我', '什么', '把', '你'], lyric)).toBe(false);
    expect(serverPresent(['我', '什么', '你'], lyric)).toBe(false);
    expect(serverPresent(['麻烦', '重新认识'], lyric)).toBe(true);
  });

  /* 压平规则也要一致：LRC 里多一个空格不该判成「这不是同一个词」。 */
  it('两边都压掉空白与大小写再比', () => {
    expect(serverEvidence(['大 雨 过 后'])).toEqual(clientEvidence(['大 雨 过 后']));
    expect(serverEvidence(['Rainbow'])).toEqual(clientEvidence(['Rainbow']));
    expect(serverPresent(['大 雨 过 后'], '就像大雨过后的好天气')).toBe(true);
  });
});
