// test/manual/tv_4k_probe.mjs
// 4K 电视的布局校验：确认视口真的是 3840 时，根字号有没有按比例放大回去。
//
// 背景见 services/androidPhoneLayout 的 tvViewportScaleFactor：WebView 的布局单位是 CSS px，
// 4K 电视若按 density 1.0 报，视口就是 3840，同一套 rem 尺寸铺上去只有该有的一半大。
//
// 判据：--folia-ui-scale-normal 应当是 200%（用户没拉过滑条时），且 html 的计算字号应当约等于
// 基准字号的 2 倍。1920 视口下这条必须是 100%，否则就是把正常 1080p 电视改坏了。
//
// 用法：node test/manual/tv_4k_probe.mjs [url]

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000/?splash=0';
const VIEWPORTS = [
    { label: '1080p', width: 1920, height: 1080 },
    { label: '4K', width: 3840, height: 2160 },
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];

for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
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
    await page.waitForTimeout(8000);

    const sample = await page.evaluate(() => {
        const root = document.documentElement;
        const style = window.getComputedStyle(root);
        const shell = document.querySelector('[data-folia-app-shell]');
        return {
            innerWidth: window.innerWidth,
            dpr: window.devicePixelRatio,
            uiScaleNormal: style.getPropertyValue('--folia-ui-scale-normal').trim(),
            rootFontSize: style.fontSize,
            shellWidth: shell ? Math.round(shell.getBoundingClientRect().width) : null,
        };
    });
    results.push({ viewport: viewport.label, ...sample });
    await page.screenshot({ path: `preview/tv-4k-${viewport.label}.png` });
    await context.close();
}

console.log(JSON.stringify({ url, results }, null, 2));
await browser.close();
