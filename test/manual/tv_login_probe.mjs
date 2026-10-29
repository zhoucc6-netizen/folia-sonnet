// test/manual/tv_login_probe.mjs
// 登录窗的焦点陷阱探针：遥控器卡在左侧平台列里、去不了右边，是用户报的第一个问题。
//
// 复现路径：电视视口 → 关掉首启引导 → 点「连接在线平台」开登录窗 → 把焦点放到左侧列 →
// 按右键，看焦点能不能离开这个容器。
//
// 判据：左列是个 role="listbox" 且 tabIndex=0，它自己的 onKeyDown 会吃掉左右键（上下行切换）。
// 如果按右键之后 activeElement 仍是它，就是陷阱还在。
//
// 用法：node test/manual/tv_login_probe.mjs [url]

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
        // 资料库界面那一页选择问过了，免得它压在登录窗上面。
        localStorage.setItem('folia_library_suite_prompt_seen', 'true');
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

// 关掉首启引导。那个「资料库用哪种界面」是多页的，一次点不干净，循环点到没有为止。
for (let round = 0; round < 8; round += 1) {
    const next = page.getByRole('button', { name: /下一步|关闭|我服了|就这样|稍后/ }).first();
    if (!(await next.count())) break;
    await next.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(450);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// 开登录窗。顶栏那颗按钮的完整文案是「连接在线平台 · 网易云 · 未登录」，用 DOM 直接找再点：
// getByRole 的名字匹配在这种长文案上不稳，而且空状态那段说明里也有「连接在线平台」几个字。
const opened = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button'))
        .find(node => (node.textContent ?? '').includes('连接在线平台'));
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
});
await page.waitForTimeout(3000);

const state = () => page.evaluate(() => {
    const node = document.activeElement;
    const listbox = document.querySelector('[role="listbox"][aria-label]');
    const rect = node instanceof HTMLElement ? node.getBoundingClientRect() : null;
    return {
        active: node === document.body ? 'BODY'
            : `${node?.tagName.toLowerCase()} ${node?.getAttribute('role') ?? ''} ${
                (node?.getAttribute('aria-label') || node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26)}`.trim(),
        at: rect ? [Math.round(rect.x), Math.round(rect.y)] : null,
        isListbox: node === listbox,
        dialog: Boolean(document.querySelector('[data-folia-keyboard-window="true"], [aria-modal="true"]')),
    };
});

const trace = [];
trace.push({ step: 'after open', ...(await state()) });

// 把焦点放进左侧平台列（模拟用户用遥控器走到那里）。
const seeded = await page.evaluate(() => {
    const listbox = document.querySelector('[role="listbox"][aria-label]');
    if (!(listbox instanceof HTMLElement)) return false;
    listbox.focus();
    return document.activeElement === listbox;
});
trace.push({ step: seeded ? 'listbox focused' : 'listbox NOT found', ...(await state()) });

for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(320);
    trace.push({ step: key, ...(await state()) });
}

await page.screenshot({ path: 'preview/tv-login.png' });
const dialogCandidates = await page.evaluate(() => {
    const dialog = document.querySelector('[data-folia-keyboard-window="true"], [aria-modal="true"]');
    if (!dialog) return [];
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"], [role="tab"], [role="option"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
    return Array.from(dialog.querySelectorAll(sel)).map(node => {
        const r = node.getBoundingClientRect();
        return {
            tag: node.tagName.toLowerCase(),
            role: node.getAttribute('role') ?? '',
            text: (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
            at: [Math.round(r.x), Math.round(r.y)],
            visible: r.width > 0 && r.height > 0,
        };
    }).filter(item => item.visible);
});
console.log(JSON.stringify({ url, opened, trace, dialogCandidates, errors: errors.slice(0, 5) }, null, 2));

await browser.close();
