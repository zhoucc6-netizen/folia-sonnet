import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFontMarket } from '@/services/fontMarket';

// 当前文件：字体市场目录的分页契约。
//
// 分页和过滤都放在服务端 —— 前端手上只有一页，在前端筛等于只在这一页里筛，
// 翻页还会漏掉后面几页的。所以这里盯的是「请求长什么样」，以及老服务端
// 还不带分页字段时客户端能不能体面地退一步。

const fontRecord = (id: string) => ({
  id,
  name: `字体 ${id}`,
  family: `FoliaMarket_${id}`,
  category: 'sans',
  categoryLabel: '黑体 / 无衬线',
  previewAspect: 3,
});

const stubFetch = (payload: unknown, ok = true): { calls: string[] } => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return { ok, status: ok ? 200 : 500, json: async () => payload } as Response;
  }));
  return { calls };
};

describe('fetchFontMarket', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for one page and keeps the filters in the query', async () => {
    const { calls } = stubFetch({
      fonts: [fontRecord('a')],
      total: 57,
      page: 2,
      pageSize: 24,
      hasMore: true,
    });
    const result = await fetchFontMarket({ page: 2, pageSize: 24, category: 'sans', q: '黑体' });
    expect(result.error).toBeNull();
    expect(result.fonts).toHaveLength(1);
    expect(result.total).toBe(57);
    expect(result.page).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(calls[0]).toContain('page=2');
    expect(calls[0]).toContain('pageSize=24');
    expect(calls[0]).toContain('category=sans');
    expect(calls[0]).toContain('q=');
  });

  it('drops the defaults so the first page stays cacheable', async () => {
    const { calls } = stubFetch({ fonts: [], total: 0, page: 1, pageSize: 24, hasMore: false });
    await fetchFontMarket({ page: 1, category: 'all', q: '   ' });
    expect(calls[0]).not.toContain('page=');
    expect(calls[0]).not.toContain('category=');
    expect(calls[0]).not.toContain('q=');
  });

  it('falls back to the page length when an older server sends no totals', async () => {
    const { calls } = stubFetch({ fonts: [fontRecord('a'), fontRecord('b')] });
    const result = await fetchFontMarket();
    expect(result.error).toBeNull();
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(calls[0]).not.toContain('?');
  });

  it('turns a failed request into an empty page instead of throwing', async () => {
    stubFetch({}, false);
    const result = await fetchFontMarket({ page: 3 });
    expect(result.error).toBe('server');
    expect(result.fonts).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  it('ignores malformed entries instead of rendering broken cards', async () => {
    stubFetch({ fonts: [fontRecord('a'), null, { name: '没有 id' }], total: 3, hasMore: false });
    const result = await fetchFontMarket();
    expect(result.fonts.map((font) => font.id)).toEqual(['a']);
  });
});
