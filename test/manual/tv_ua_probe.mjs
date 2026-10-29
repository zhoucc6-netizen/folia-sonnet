// test/manual/tv_ua_probe.mjs
// 原生 UA 标记的验证：这是电视判定的主要依据（见 MainActivity.applyWebViewPlaybackSettings）。
//
// 用户那台海信电视的 WebView 靠媒体查询判不出来（既不报粗指针也不报 hover: none），
// 于是整套电视适配没启用、卡在首启。原生现在会往 UA 末尾加 `FoliaTV/1`。
//
// 这个探针用带标记的 UA 打开页面，**不预置任何 localStorage**，检查：
//   1. data-folia-device-resolved 是 tv（JS 判据生效）；
//   2. 首启不再出现 device-type 那一页；
//   3. 电视档的 overscan 内边距真的写到了 app shell 上。
//
// 用法：node test/manual/tv_ua_probe.mjs [url]

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000/?splash=0';
const TV_UA = 'Mozilla/5.0 (Linux; Android 9; Hisense 85E7SPro) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Safari/537.36 FoliaTV/1';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    userAgent: TV_UA,
});
// 只清空，不写任何「已经选过」的标记 —— 模拟刚装好第一次打开。
await context.addInitScript(() => {
    try {
        localStorage.clear();
    } catch {
        // 探针照跑。
    }
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(10000);

const first = await page.evaluate(() => {
    const root = document.documentElement;
    const shell = document.querySelector('[data-folia-app-shell]');
    const shellStyle = shell ? window.getComputedStyle(shell) : null;
    return {
        resolved: root.getAttribute('data-folia-device-resolved'),
        uiScale: window.getComputedStyle(root).getPropertyValue('--folia-ui-scale-normal').trim(),
        shellPadding: shellStyle ? `${shellStyle.paddingTop} ${shellStyle.paddingRight}` : null,
        onboardingPage: document.querySelector('[data-onboarding-page]')?.getAttribute('data-onboarding-page') ?? null,
        uaHasMarker: navigator.userAgent.includes('FoliaTV/1'),
    };
});

// 一路按确定，看能不能过完引导进主界面（不按方向键 —— 电视用户最常见的操作就是连按确定）。
const trace = [{ step: 'initial', ...(await page.evaluate(() => ({
    resolved: document.documentElement.getAttribute('data-folia-device-resolved'),
    onboardingPage: document.querySelector('[data-onboarding-page]')?.getAttribute('data-onboarding-page') ?? null,
    dialogs: document.querySelectorAll('[aria-modal="true"]').length,
}))) }];
for (let i = 1; i <= 8; i += 1) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({
        onboardingPage: document.querySelector('[data-onboarding-page]')?.getAttribute('data-onboarding-page') ?? null,
        dialogs: document.querySelectorAll('[aria-modal="true"]').length,
        active: document.activeElement instanceof HTMLElement
            ? (document.activeElement.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 14)
            : 'none',
    }));
    trace.push({ step: `Enter#${i}`, ...state });
    if (!state.onboardingPage && state.dialogs === 0) break;
}

const sawDeviceType = trace.some(item => item.onboardingPage === 'device-type');
await page.screenshot({ path: 'preview/tv-ua.png' });
console.log(JSON.stringify({ url, first, sawDeviceType, trace, errors: errors.slice(0, 5) }, null, 2));

await browser.close();
