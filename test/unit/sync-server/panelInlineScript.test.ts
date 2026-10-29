// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderLoginPage, renderPanelPage } from '../../../sync-server/src/panel';

// 当前文件：面板页面里那段内联脚本必须是**浏览器能直接跑的 JS**。
//
// panel.ts 自己是 TypeScript，但内联脚本是模板字符串 —— TS 不会转译字符串
// 里的内容。在里面写类型注解（`(): void`）编译期一声不响，要等页面在浏览器
// 里抛 SyntaxError 才发现，而那时候整个脚本都挂了、所有按钮都点不动。
//
// 所以这里把页面真的挂进 DOM 再执行一遍：语法错会抛 SyntaxError，
// `getElementById` 拿不到元素会抛 TypeError —— 后者正是加新控件时最容易漏的
// （改了脚本忘了改 HTML，或者反过来）。

const okJson = (payload: unknown): unknown => ({
  ok: true,
  status: 200,
  json: async () => payload,
});

const mount = (html: string): string[] => {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  document.body.appendChild(holder);
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
};

describe('panel inline script', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      ok: true,
      fonts: [],
      entries: [],
      total: 0,
      hasMore: false,
      usingDefaultCredentials: false,
    })));
  });

  it('runs the panel page script without throwing', () => {
    const scripts = mount(renderPanelPage());
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.some((script) => script.includes('reloadStatsImage'))).toBe(true);
    scripts.forEach((script) => {
      expect(() => new Function(script)()).not.toThrow();
    });
  });

  it('runs the login page script without throwing', () => {
    const scripts = mount(renderLoginPage());
    expect(scripts.length).toBeGreaterThan(0);
    scripts.forEach((script) => {
      expect(() => new Function(script)()).not.toThrow();
    });
  });
});
