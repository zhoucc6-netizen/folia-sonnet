import { describe, expect, it } from 'vitest';
import {
  renderAdminBackupPage,
  renderAdminCachePage,
  renderAdminMissingPage,
  type AdminCacheItem,
} from '../../../sync-server/src/adminCacheView';

// test/unit/sync-server/adminCacheView.test.ts
// 管理面板那条「看一条缓存」的页面到底画出了什么。
//
// 面板以前只能把 payload 当 JSON 摊开 —— 主题长什么样全靠人自己读色值，覆盖副本更是
// 只有一套 JSON 接口。这里钉住两件事：**主题要渲染出来**（色块、高亮词用本色），
// **副本要看得见也捞得回来**。
//
// 页面上每一个字都来自任何人都能推的 payload，所以转义也一并钉住。

const KEY = 'a'.repeat(32);

const item = (patch: Partial<AdminCacheItem> = {}): AdminCacheItem => ({
  kind: 'stage',
  key: KEY,
  payloadJson: JSON.stringify({
    theme: {
      light: {
        backgroundColor: '#101010',
        primaryColor: '#ff0055',
        accentColor: '#ffcc00',
        secondaryColor: '#00ffcc',
        wordColors: [{ word: '小黄花', color: '#ffcc00' }],
      },
      dark: {
        backgroundColor: '#f5f5f5',
        primaryColor: '#111111',
        accentColor: '#00aaff',
        secondaryColor: '#333333',
        wordColors: [{ word: '荡秋千', color: '#00aaff' }],
      },
    },
    decision: { mode: 'flow', reason: '副歌要飘起来', params: { intensity: 0.4 } },
  }),
  songTitle: '晴天',
  provider: 'openai',
  model: 'gpt-4o-mini',
  platform: 'netease',
  payloadBytes: 2048,
  hits: 7,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...patch,
});

const backup = (id: number, patch: Partial<AdminCacheItem> = {}): AdminCacheItem => ({
  ...item({ archivedAt: '2026-10-03T00:00:00.000Z' }),
  id,
  ...patch,
});

describe('renderAdminCachePage', () => {
  it('renders the theme colours as swatches instead of raw JSON', () => {
    const html = renderAdminCachePage({ kind: 'stage', key: KEY, current: item(), backups: [], limit: 10 });

    expect(html).toContain('#ff0055');
    expect(html).toContain('#ffcc00');
    expect(html).toContain('主题颜色');
    expect(html).toContain('flow');
  });

  /* 高亮词要用它自己的颜色显示 —— 这是访客检索页那一套，管理面板以前完全没有。 */
  it('paints each AI highlight word in its own colour', () => {
    const html = renderAdminCachePage({ kind: 'stage', key: KEY, current: item(), backups: [], limit: 10 });

    expect(html).toContain('小黄花');
    expect(html).toMatch(/color:#ffcc00/);
    expect(html).toContain('荡秋千');
  });

  it('lists the overwritten copies with a way to look and a way to restore', () => {
    const html = renderAdminCachePage({
      kind: 'stage',
      key: KEY,
      current: item(),
      backups: [backup(11), backup(12)],
      limit: 10,
    });

    expect(html).toContain('/admin/cache/backups/11');
    expect(html).toContain('/admin/cache/backups/12');
    /* 恢复是整页刷新的表单，不是要人去手敲 JSON 接口。 */
    expect(html).toContain('action="/admin/cache/backups/11/restore"');
    expect(html).toContain('被覆盖之前的旧版');
  });

  /* 当前那条被删了也要能看 —— 那时候副本是唯一还能捞回来的东西。 */
  it('says so when the entry itself is gone', () => {
    const html = renderAdminCachePage({
      kind: 'stage',
      key: KEY,
      current: null,
      backups: [backup(11)],
      limit: 10,
    });

    expect(html).toContain('已经被删了');
    expect(html).toContain('/admin/cache/backups/11');
  });

  it('escapes whatever the uploader put in the title', () => {
    const html = renderAdminCachePage({
      kind: 'stage',
      key: KEY,
      current: item({ songTitle: '<script>alert(1)</script>' }),
      backups: [backup(11, { songTitle: '<img onerror=x>' })],
      limit: 10,
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderAdminBackupPage', () => {
  it('renders that copy and links back to the entry', () => {
    const html = renderAdminBackupPage({ backup: backup(11), limit: 10 });

    expect(html).toContain('#ffcc00');
    expect(html).toContain(`action="/admin/cache/backups/11/restore"`);
    expect(html).toContain(`/admin/cache/stage/${KEY}`);
  });
});

describe('renderAdminMissingPage', () => {
  it('escapes the reason', () => {
    expect(renderAdminMissingPage('<b>nope</b>')).not.toContain('<b>nope</b>');
  });
});
