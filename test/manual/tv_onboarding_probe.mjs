// test/manual/tv_onboarding_probe.mjs
// 首启引导在电视上的探针：用户报「这是手机还是平板？」那一页按按钮没反应、进不去主界面。
//
// 验两件事：
//   1. 电视上不再出现 device-type 那一页（它属于首启阻塞页，一页过不去就卡死）；
//   2. 「确定」键真的能激活当前聚焦的按钮 —— 空间导航里自己合成 click 的那条路。
//
// 环境：不预置「已看过引导」的标记（模拟刚装好第一次打开），只预置设备类型为 tv。
//
// 用法：node test/manual/tv_onboarding_probe.mjs [url]

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000/?splash=0';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
});
await context.addInitScript(() => {
    try {
        localStorage.clear();
        localStorage.setItem('folia_device_type', 'tv');
    } catch {
        // 探针照跑。
    }
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(10000);

const state = () => page.evaluate(() => {
    const active = document.activeElement;
    const onboarding = document.querySelector('[data-onboarding-page]');
    const title = document.querySelector('#playback-entry-view-prompt-title');
    return {
        onboardingPage: onboarding?.getAttribute('data-onboarding-page') ?? null,
        promptTitle: (title?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24) || null,
        active: active instanceof HTMLElement
            ? `${active.tagName.toLowerCase()} ${(active.getAttribute('aria-label') || active.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18)}`
            : 'none',
        dialogCount: document.querySelectorAll('[aria-modal="true"], [data-folia-keyboard-window="true"]').length,
    };
});

const trace = [{ step: 'initial', ...(await state()) }];

// 走几步方向键，看焦点有没有落到按钮上。
for (const key of ['ArrowDown', 'ArrowRight', 'ArrowDown']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(300);
    trace.push({ step: key, ...(await state()) });
}

// 按「确定」—— 应当激活当前按钮，页面/弹窗状态要变。
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
trace.push({ step: 'Enter#1', ...(await state()) });
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
trace.push({ step: 'Enter#2', ...(await state()) });

// 把剩下的引导都按掉，看能不能走到主界面。
for (let i = 0; i < 6; i += 1) {
    const current = await state();
    if (!current.onboardingPage && current.dialogCount === 0) break;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    trace.push({ step: `Enter#${i + 3}`, ...(await state()) });
}

const sawDeviceType = trace.some(item => item.onboardingPage === 'device-type');
const reachedHome = !(await state()).onboardingPage;
await page.screenshot({ path: 'preview/tv-onboarding.png' });

console.log(JSON.stringify({ url, sawDeviceType, reachedHome, trace, errors: errors.slice(0, 5) }, null, 2));
await browser.close();
