// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeHexColor,
  renderDetailPage,
  renderEntryTiles,
  renderSearchPage,
  summarizePayload,
  type GalleryEntry,
} from '../../../sync-server/src/stageGalleryView';

// 当前文件：云缓存对外那一面的解析与渲染。
//
// 页面上出现的每一个字都来自**任何人都能 PUT 的** payload，而这一面的服务改动
// 在本机跑不起来（sync-server 是独立子项目），所以「不可信输入怎么被收拾」只能
// 落在这里：颜色只认 #hex（会被拼进 style，放过一个 `;` 就是一处注入）、文本一律
// 转义、两种 decision 形状都得认。

const samplePayload = {
  theme: {
    light: {
      name: '晴',
      backgroundColor: '#fff',
      primaryColor: '#111',
      accentColor: '#f00',
      secondaryColor: '#0f0',
      fontStyle: 'sans',
      animationIntensity: 'normal',
      description: '午后',
      wordColors: [{ word: '晴天', color: '#ff8800' }],
    },
    dark: {
      name: '夜',
      backgroundColor: '#101014',
      primaryColor: '#f8fafc',
      accentColor: '#7dd3fc',
      secondaryColor: '#cbd5e1',
      fontStyle: 'sans',
      animationIntensity: 'calm',
      wordColors: [{ word: '晴天', color: '#7dd3fc' }],
    },
  },
  decision: {
    mode: 'sonnet',
    reason: '副歌推进强，用分镜承接',
    params: { cameraIntensity: 0.7, enableWordRotation: true },
  },
};

const buildEntry = (overrides: Partial<GalleryEntry> = {}): GalleryEntry => ({
  key: 'a'.repeat(32),
  songTitle: '晴天',
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  hits: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  stage: summarizePayload(JSON.stringify(samplePayload)),
  ...overrides,
});

const mount = (html: string): string[] => {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  document.body.appendChild(holder);
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
};

describe('stage gallery payload summary', () => {
  it('reads the mode, both palettes and the highlighted words out of a cached stage', () => {
    const stage = summarizePayload(JSON.stringify(samplePayload));

    expect(stage.mode).toBe('sonnet');
    expect(stage.modeName).toBe('商籁');
    expect(stage.reason).toContain('副歌');
    expect(stage.params.map((row) => row.key)).toEqual(['cameraIntensity', 'enableWordRotation']);
    /* 三位简写要展开成六位，跟 themeSanitizer 那条规则一致。 */
    expect(stage.light?.backgroundColor).toBe('#ffffff');
    expect(stage.light?.primaryColor).toBe('#111111');
    expect(stage.light?.wordColors).toEqual([{ word: '晴天', color: '#ff8800' }]);
    expect(stage.dark?.backgroundColor).toBe('#101014');
  });

  /*
   * 决策有两种形状：模型刚答出来的 mode 与 theme 并列在顶层，缓存条目里的已经
   * 收进 `decision`。只认一种的话，别人推上来的决策拉回来就被判成「没有动画」。
   */
  it('reads a decision left at the top level as well, the shape the model answers in', () => {
    const stage = summarizePayload(JSON.stringify({
      theme: samplePayload.theme,
      mode: 'cadenza',
      reason: '情绪外放',
      params: {},
    }));

    expect(stage.mode).toBe('cadenza');
    expect(stage.modeName).toBe('心象');
    expect(stage.light?.backgroundColor).toBe('#ffffff');
  });

  it('survives a payload that is not JSON at all', () => {
    const stage = summarizePayload('not json {');

    expect(stage.mode).toBe('');
    expect(stage.light).toBeNull();
    expect(stage.dark).toBeNull();
  });

  /* 颜色会被拼进 `style="..."`，不认识的必须整个换成兜底色，不能原样带出去。 */
  it('refuses colours that are not hex, including one carrying an injection', () => {
    const hostile = summarizePayload(JSON.stringify({
      theme: {
        light: {
          backgroundColor: 'red;background:url(javascript:alert(1))',
          primaryColor: 'url(http://evil/x)',
          accentColor: '#abc',
          secondaryColor: 'rgba(0,0,0,0.5)',
          wordColors: [{ word: '晴天', color: 'expression(alert(1))' }],
        },
        dark: samplePayload.theme.dark,
      },
      decision: { mode: 'classic', reason: '', params: {} },
    }));

    expect(hostile.light?.backgroundColor).toBe('#0b0b10');
    expect(hostile.light?.primaryColor).toBe('#f5f5f7');
    expect(hostile.light?.accentColor).toBe('#aabbcc');
    expect(hostile.light?.secondaryColor).toBe('#aabbcc');
    /* 词还在，只是颜色退回强调色 —— 词本身是内容，不该因为颜色脏就整条丢掉。 */
    expect(hostile.light?.wordColors).toEqual([{ word: '晴天', color: '#aabbcc' }]);
  });

  it('keeps a hex colour it recognises and expands the short form', () => {
    expect(normalizeHexColor('#AbC', '#000000')).toBe('#aabbcc');
    expect(normalizeHexColor('#1a2b3c', '#000000')).toBe('#1a2b3c');
    expect(normalizeHexColor(42, '#000000')).toBe('#000000');
    expect(normalizeHexColor('#12345', '#000000')).toBe('#000000');
  });
});

describe('stage gallery pages', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes untrusted text instead of letting it through as markup', () => {
    const html = renderEntryTiles([buildEntry({ songTitle: '<script>alert(1)</script>' })]);

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('paints each highlighted word in the colour the AI gave it', () => {
    const html = renderDetailPage(buildEntry());

    expect(html).toContain('style="color:#ff8800"');
    expect(html).toContain('style="color:#7dd3fc"');
    expect(html).toContain('晴天');
  });

  it('shows the mode and both palettes on the detail page', () => {
    const html = renderDetailPage(buildEntry());

    expect(html).toContain('商籁');
    expect(html).toContain('sonnet');
    expect(html).toContain('#ffffff');
    expect(html).toContain('#101014');
    expect(html).toContain('副歌推进强');
  });

  it('says so when a half entry has no animation decision', () => {
    const html = renderDetailPage(buildEntry({ stage: summarizePayload(JSON.stringify({ theme: samplePayload.theme })) }));

    expect(html).toContain('未定动画');
  });

  it('renders an empty state rather than an empty grid', () => {
    expect(renderEntryTiles([])).toContain('没有匹配的条目');
  });

  /*
   * 页面里那段脚本是**模板字符串**，TS 不转译它 —— 写个类型注解编译期一声不响，
   * 到了浏览器整段 SyntaxError、搜索框直接失灵。跟 panelInlineScript 同样的办法：
   * 真挂进 DOM 跑一遍，顺带验 `getElementById` 拿得到元素。
   */
  it('runs the search page script without throwing', () => {
    const scripts = mount(renderSearchPage('晴天', [buildEntry()]));

    expect(scripts.length).toBe(1);
    expect(scripts[0]).toContain('/api/stage-gallery/search');
    scripts.forEach((script) => {
      expect(() => new Function(script)()).not.toThrow();
    });
  });

  it('runs the search script even with no results rendered yet', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, html: '' }) })));
    const scripts = mount(renderSearchPage('', []));

    expect(scripts.length).toBe(1);
    scripts.forEach((script) => {
      expect(() => new Function(script)()).not.toThrow();
    });
    vi.unstubAllGlobals();
  });
});
