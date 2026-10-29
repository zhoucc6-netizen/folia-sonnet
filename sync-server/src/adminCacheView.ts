import {
  escapeHtml,
  page,
  renderStageDetail,
  summarizePayload,
  type GalleryEntry,
} from './stageGalleryView.js';

// sync-server/src/adminCacheView.ts
// 管理面板的「看一条缓存」页面：主题渲染 + 覆盖副本。
//
// 面板以前只能把 payload 当 JSON 摊开 —— 主题长什么样全靠人自己读色值，而**覆盖副本
// 干脆没有界面**（只有一套 JSON 接口，得手敲 URL）。两件事在这里一起解决。
//
// 页面上的每一个字都来自任何人都能推的 payload，所以渲染**只在服务端做一遍**，跟访客
// 检索页共用同一个 `renderStageDetail` —— 转义也就不必分两处维护。

/** 一条缓存（当前那条或被覆盖留下来的那一版）在页面上的最小形状。 */
export interface AdminCacheItem {
  id?: number;
  kind: string;
  key: string;
  payloadJson: string;
  songTitle: string;
  provider: string;
  model: string;
  platform: string;
  payloadBytes: number;
  hits: number;
  createdAt: string;
  updatedAt?: string;
  archivedAt?: string;
}

const toEntry = (item: AdminCacheItem): GalleryEntry => ({
  key: item.key,
  songTitle: item.songTitle,
  provider: item.provider,
  model: item.model,
  hits: item.hits,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt ?? item.archivedAt ?? '',
  stage: summarizePayload(item.payloadJson),
});

const formatBytes = (bytes: number): string => {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
};

const formatTime = (value: string): string => {
  const text = String(value ?? '').trim();
  if (!text) return '—';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
};

const backupRow = (item: AdminCacheItem): string => `
  <tr>
    <td class="mono">${escapeHtml(formatTime(item.archivedAt ?? item.updatedAt ?? item.createdAt))}</td>
    <td>${escapeHtml(item.songTitle || '(未记歌名)')}</td>
    <td class="mono">${escapeHtml(item.platform || '—')}</td>
    <td class="mono">${escapeHtml(item.provider || '—')} / ${escapeHtml(item.model || '—')}</td>
    <td class="mono">${escapeHtml(formatBytes(item.payloadBytes))}</td>
    <td class="mono">${escapeHtml(item.hits)}</td>
    <td>
      <a href="/admin/cache/backups/${encodeURIComponent(Number(item.id ?? 0))}">查看</a>
    </td>
    <td>
      <form method="post" action="/admin/cache/backups/${encodeURIComponent(Number(item.id ?? 0))}/restore">
        <button type="submit">捞回来</button>
      </form>
    </td>
  </tr>`;

/**
 * 一条缓存的详情页：当前那一版 + 它被覆盖之前留下来的旧版。
 *
 * `current` 为 null 表示这一条已经被删了 —— 副本还在，那就是唯一能捞回来的东西，
 * 这种情况下更要让人看见。
 */
export const renderAdminCachePage = (input: {
  kind: string;
  key: string;
  current: AdminCacheItem | null;
  backups: readonly AdminCacheItem[];
  limit: number;
}): string => {
  const { kind, key, current, backups, limit } = input;
  const heading = current?.songTitle || backups[0]?.songTitle || '(未记歌名)';

  const currentCard = current
    ? `
      <div class="card">
        <h2>当前这一版</h2>
        ${renderStageDetail(toEntry(current))}
      </div>`
    : `
      <div class="card">
        <h2>当前这一版</h2>
        <div class="empty">这个键现在没有内容（已经被删了）。下面那些副本是唯一还能捞回来的版本。</div>
      </div>`;

  const backupCard = backups.length === 0
    ? `
      <div class="card">
        <h2>被覆盖之前的旧版</h2>
        <div class="empty">还没有副本 —— 这个键一次都没被覆盖过。</div>
      </div>`
    : `
      <div class="card">
        <h2>被覆盖之前的旧版（<span class="mono">${escapeHtml(backups.length)}</span> / 最多 ${escapeHtml(limit)} 份）</h2>
        <div class="sub" style="margin-bottom:12px">
          每次要被覆盖之前，旧的那版整条存下来。捞回来之前，**现在的这一版也会先存一份**
          —— 捞错了还能再捞。
        </div>
        <table>
          <thead>
            <tr><th>存档时间</th><th>歌名</th><th>平台</th><th>生成来源 / 模型</th><th>大小</th><th>命中</th><th></th><th></th></tr>
          </thead>
          <tbody>${backups.map(backupRow).join('')}</tbody>
        </table>
      </div>`;

  return page(
    `${heading} · 云缓存管理`,
    `
    <div class="back" style="margin-bottom:16px"><a href="/admin">← 返回管理面板</a></div>
    <div class="card">
      <div class="stage-title">${escapeHtml(heading)}</div>
      <div class="mono" style="margin-top:8px;font-size:11px;color:var(--muted)">
        ${escapeHtml(kind)} · ${escapeHtml(key)}
      </div>
    </div>
    ${currentCard}
    ${backupCard}
    `,
  );
};

/** 某一版副本单独看一页 —— 渲染出来才知道它跟现在这一版差在哪。 */
export const renderAdminBackupPage = (input: {
  backup: AdminCacheItem;
  limit: number;
}): string => {
  const { backup } = input;
  const backHref = `/admin/cache/${encodeURIComponent(backup.kind)}/${encodeURIComponent(backup.key)}`;

  return page(
    `${backup.songTitle || '未记歌名'} · 覆盖副本`,
    `
    <div class="back" style="margin-bottom:16px">
      <a href="${escapeHtml(backHref)}">← 返回这一条</a>
    </div>
    <div class="card">
      <div class="stage-title">${escapeHtml(backup.songTitle || '(未记歌名)')}</div>
      <div class="sub" style="margin-top:8px">
        被覆盖于 ${escapeHtml(formatTime(backup.archivedAt ?? ''))}
        ${backup.platform ? ` · 平台 ${escapeHtml(backup.platform)}` : ''}
      </div>
      <form method="post" action="/admin/cache/backups/${encodeURIComponent(Number(backup.id ?? 0))}/restore" style="margin-top:14px">
        <button type="submit">把这一版捞回来</button>
      </form>
    </div>
    ${renderStageDetail(toEntry(backup))}
    `,
  );
};

export const renderAdminMissingPage = (message: string): string => page(
  '没有这一条',
  `<div class="empty">${escapeHtml(message)}<br><br><a href="/admin">返回管理面板</a></div>`,
);
