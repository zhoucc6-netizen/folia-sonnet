// test/manual/tv_perf_probe.mjs
// 电视端帧率的量化探针：在 1920×1080 下采 rAF 间隔、统计花钱的视觉层，判断「帧率低」是
// 设置问题、素材问题，还是硬件问题。
//
// 采三样：
//   · rAF 间隔分布 —— p50 / p95 / 掉帧率（>25ms 的比例）。浏览器里跑不到 60 就说明这一帧的
//     内容本身重，跟电视面板 180Hz 无关：面板刷新率不会让一次绘制变便宜。
//   · backdrop-filter 层数 —— 毛玻璃每一层都要在 GPU 上做一次全屏模糊，电视 SoC 上这是最贵的
//     一项，也正是设置里「毛玻璃」开关控的东西。
//   · canvas / WebGL 数量与尺寸 —— 歌词可视化走 pixi / three，全屏画布在 TV 上通常是第二贵。
//
// 用法：node test/manual/tv_perf_probe.mjs [url]

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000/?splash=0';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
});
await context.addInitScript(() => {
    try {
        localStorage.setItem('folia_free_software_notice_seen', '1');
        localStorage.setItem('folia_sign_in_spotlight_done', '1');
        localStorage.setItem('folia_device_type', 'tv');
        localStorage.setItem('folia_device_type_answered', 'true');
    } catch {
        // 探针照跑。
    }
});

const page = await context.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(9000);

// 关掉首启引导，否则量的是弹窗。
for (let round = 0; round < 8; round += 1) {
    const next = page.getByRole('button', { name: /下一步|关闭|我服了|就这样|稍后/ }).first();
    if (!(await next.count())) break;
    await next.click({ timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(400);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);

const sample = await page.evaluate(async () => {
    const deltas = [];
    await new Promise(resolve => {
        let last = performance.now();
        const started = last;
        const tick = now => {
            deltas.push(now - last);
            last = now;
            if (now - started < 3000) requestAnimationFrame(tick);
            else resolve();
        };
        requestAnimationFrame(tick);
    });

    const sorted = [...deltas].sort((a, b) => a - b);
    const pick = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;

    const root = document.documentElement;
    const canvases = Array.from(document.querySelectorAll('canvas')).map(canvas => ({
        w: canvas.width,
        h: canvas.height,
    }));
    const blurred = Array.from(document.querySelectorAll('body *')).filter(node => {
        const style = window.getComputedStyle(node);
        return style.backdropFilter && style.backdropFilter !== 'none';
    }).length;

    return {
        frames: deltas.length,
        p50: Math.round(pick(0.5)),
        p95: Math.round(pick(0.95)),
        worst: Math.round(sorted[sorted.length - 1] ?? 0),
        over25ms: Math.round((deltas.filter(d => d > 25).length / Math.max(1, deltas.length)) * 100),
        nodes: document.querySelectorAll('body *').length,
        canvases,
        blurredLayers: blurred,
        flags: {
            reduceMotion: root.getAttribute('data-reduce-motion'),
            glass: root.getAttribute('data-glass'),
            device: root.getAttribute('data-folia-device-resolved'),
        },
    };
});

console.log(JSON.stringify({ url, sample }, null, 2));

await browser.close();
