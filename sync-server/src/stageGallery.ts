import { Hono } from 'hono';
import type { D1Database, Env } from './app.js';
import { hydrateCacheRows } from './aiCache.js';
import {
  DEFAULT_LIMIT,
  MAX_QUERY_CHARS,
  clampGalleryLimit,
  renderDetailPage,
  renderEntryTiles,
  renderMissingPage,
  renderSearchPage,
  summarizePayload,
  type GalleryEntry,
} from './stageGalleryView.js';

// src/stageGallery.ts
// 云缓存对外那一面的路由：`/stage` 搜索、`/stage/entry/<md5>` 详情。
//
// 解析与渲染都在 `stageGalleryView.ts`，这里只管查库与分发。
//
// 这两条**必须**挂在 app.ts 里那张 `app.route('/', api)` 兜底网**之前** ——
// 那张网会给所有没被认领的路径套 Bearer 校验，访客手上没有 token，挂到后面
// 就谁也进不来。

const GALLERY_KIND = 'stage';
const KEY_PATTERN = /^[a-f0-9]{32}$/;

const SELECT_COLUMNS = 'kind, cache_key, payload_json, song_title, provider, model, hits, created_at, updated_at';

type GalleryRow = {
  kind: string;
  cache_key: string;
  payload_json: string;
  song_title: string | null;
  provider: string | null;
  model: string | null;
  hits: number;
  created_at: string;
  updated_at: string;
};

const readText = (value: unknown, limit: number): string => (
  typeof value === 'string' ? value.trim().slice(0, limit) : ''
);

const toEntry = (row: GalleryRow): GalleryEntry => ({
  key: String(row.cache_key ?? '').toLowerCase(),
  songTitle: readText(row.song_title, 120),
  provider: readText(row.provider, 64),
  model: readText(row.model, 128),
  hits: Number(row.hits ?? 0),
  createdAt: String(row.created_at ?? ''),
  updatedAt: String(row.updated_at ?? ''),
  stage: summarizePayload(typeof row.payload_json === 'string' ? row.payload_json : null),
});

/** LIKE 的通配符要转义，否则搜一个 `%` 就能把全库拉出来。 */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/*
 * 两段式取数：先在覆盖索引 (kind, updated_at, song_title, cache_key) 上把要展示的
 * 那几行的主键捞出来（过滤与排序全程不碰大字段 payload_json），再按主键把整行补回来。
 *
 * 原来一条 SELECT 连 payload 一起扫：10w 条、每条最大 64KB，一次检索就是全表翻页，
 * 而且better-sqlite3 是同步执行 —— 扫描期间整个事件循环都被卡住。现在扫描只走索引，
 * payload 只读「这一页」的那几十条。
 */
const searchEntries = async (db: D1Database, query: string, limit: number): Promise<GalleryEntry[]> => {
  const keyRows = query
    ? await db
      .prepare(
        `SELECT cache_key FROM ai_cache
         WHERE kind = ? AND song_title LIKE ? ESCAPE '\\'
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .bind(GALLERY_KIND, `%${escapeLike(query)}%`, limit)
      .all<{ cache_key: string }>()
    : await db
      .prepare(
        `SELECT cache_key FROM ai_cache
         WHERE kind = ? AND song_title IS NOT NULL AND song_title <> ''
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .bind(GALLERY_KIND, limit)
      .all<{ cache_key: string }>();
  const keys = (keyRows.results ?? []).map((row) => ({ kind: GALLERY_KIND, cache_key: String(row.cache_key ?? '') }));
  if (keys.length === 0) return [];

  const hydrated = await hydrateCacheRows(db, keys);
  const entries: GalleryEntry[] = [];
  keys.forEach(({ cache_key }) => {
    const row = hydrated.get(`${GALLERY_KIND}\u0000${cache_key}`);
    if (row) entries.push(toEntry(row));
  });
  return entries;
};

const findEntry = async (db: D1Database, key: string): Promise<GalleryEntry | null> => {
  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM ai_cache WHERE kind = ? AND cache_key = ?`)
    .bind(GALLERY_KIND, key)
    .first<GalleryRow>();
  return row ? toEntry(row) : null;
};

export const galleryPageRoutes = new Hono<{ Bindings: Env }>();

galleryPageRoutes.get('/', async (c) => {
  const query = String(c.req.query('q') || '').trim().slice(0, MAX_QUERY_CHARS);
  const entries = await searchEntries(c.env.FOLIA_SYNC_DB, query, DEFAULT_LIMIT);
  return c.html(renderSearchPage(query, entries));
});

galleryPageRoutes.get('/entry/:key', async (c) => {
  const key = String(c.req.param('key') || '').trim().toLowerCase();
  if (!KEY_PATTERN.test(key)) {
    return c.html(renderMissingPage('这个地址不是一条缓存的键（应为 32 位 MD5）。'), 404);
  }
  const entry = await findEntry(c.env.FOLIA_SYNC_DB, key);
  if (!entry) {
    return c.html(renderMissingPage('缓存里没有这一条，可能已经被清理了。'), 404);
  }
  return c.html(renderDetailPage(entry));
});

export const galleryApiRoutes = new Hono<{ Bindings: Env }>();

/** GET /api/stage-gallery/search?q=&limit= —— 页面里输入即搜用的那一个。 */
galleryApiRoutes.get('/search', async (c) => {
  const query = String(c.req.query('q') || '').trim().slice(0, MAX_QUERY_CHARS);
  const limit = clampGalleryLimit(Number.parseInt(String(c.req.query('limit') || ''), 10));
  const entries = await searchEntries(c.env.FOLIA_SYNC_DB, query, limit).catch(() => [] as GalleryEntry[]);
  /*
   * `html` 是服务端渲染好的结果片段：转义与颜色校验只在服务端做一遍，
   * 前端不必再写一套渲染逻辑（那样迟早会漏转义）。
   */
  return c.json({
    ok: true,
    query,
    count: entries.length,
    html: renderEntryTiles(entries),
    entries,
  });
});
