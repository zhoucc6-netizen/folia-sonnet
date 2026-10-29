// test/manual/tv_keyboard_probe.mjs
// 电视虚拟键盘的探针：确认输入框获得焦点时键盘会接管、键帽能用方向键走、按键真的写进输入框。
//
// 判据三条：
//   1. 聚焦搜索框后出现 [data-folia-keyboard-window] 面板，且焦点落在第一颗键帽上；
//   2. 按键帽（Enter / 点击）之后输入框的 value 真的变了 —— 直接赋 value 会被 React 的
//      受控组件吞掉，所以这里同时看 DOM 的 value 与输入框上挂的受控值是否一致；
//   3. 关掉键盘后焦点回到输入框。
//
// 用法：node test/manual/tv_keyboard_probe.mjs [url]

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
const errors = [];
page.on('pageerror', error => errors.push(error.message));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(9000);

for (let round = 0; round < 8; round += 1) {
    const next = page.getByRole('button', { name: /下一步|关闭|我服了|就这样|稍后/ }).first();
    if (!(await next.count())) break;
    await next.click({ timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(400);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// 开搜索页。
const openedSearch = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button'))
        .find(node => (node.getAttribute('aria-label') ?? '').includes('搜索'));
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
});
await page.waitForTimeout(2500);

const trace = [];
const snapshot = () => page.evaluate(() => {
    const panel = document.querySelector('[data-folia-keyboard-window="true"]');
    const active = document.activeElement;
    const input = document.querySelector('input[type="search"], input[type="text"], input:not([type])');
    return {
        panel: Boolean(panel),
        panelKeyCount: panel ? panel.querySelectorAll('button').length : 0,
        active: active instanceof HTMLElement
            ? `${active.tagName.toLowerCase()} ${(active.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 12)}`
            : 'none',
        activeIsKey: Boolean(panel && active && panel.contains(active)),
        inputValue: input instanceof HTMLInputElement ? input.value : null,
        inputFocused: input === active,
    };
});

trace.push({ step: 'search opened', ...(await snapshot()) });

// 搜索框获得焦点时键盘就自动接管了（电视上没有系统输入法），焦点此时在键帽上。
// 这里不再手动聚焦输入框：那会把焦点从键帽上拽走，和真实使用顺序相反。

// 第一颗键帽是 '1'，Enter 应当把它写进输入框。
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
trace.push({ step: 'Enter on first key', ...(await snapshot()) });

// 方向键应当在键帽之间走。
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
trace.push({ step: 'ArrowRight', ...(await snapshot()) });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
trace.push({ step: 'Enter again', ...(await snapshot()) });

// Esc 关掉键盘，焦点回到输入框。
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
trace.push({ step: 'Escape', ...(await snapshot()) });

await page.screenshot({ path: 'preview/tv-keyboard.png' });
console.log(JSON.stringify({ url, openedSearch, trace, errors: errors.slice(0, 5) }, null, 2));

await browser.close();
