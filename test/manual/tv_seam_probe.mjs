// test/manual/tv_seam_probe.mjs
// 曲库墙「缝」（中间那条固定控制条）的可达性探针。
//
// 用户报的第二个问题：遥控器进不去中间那条。设计上它只能靠 Tab 进（bravais 把 Tab 翻成 tab 动作），
// 而遥控器没有 Tab。
//
// 现在的口径：墙走到边界再按一次 → bravais 的 move 返回 false、不 preventDefault，这一下漏到
// 空间导航的冒泡兜底，由它把焦点送进 [data-bravais-seam]。
// 本探针验证这条链路，以及进缝之后按返回键能不能回到墙。
//
// 用法：node test/manual/tv_seam_probe.mjs [url]

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
await page.waitForTimeout(10000);
for (let round = 0; round < 8; round += 1) {
    const next = page.getByRole('button', { name: /下一步|关闭|我服了|就这样|稍后/ }).first();
    if (!(await next.count())) break;
    await next.click({ timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(400);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);

const state = () => page.evaluate(() => {
    const active = document.activeElement;
    const seam = document.querySelector('[data-bravais-seam]');
    return {
        active: active instanceof HTMLElement
            ? `${active.tagName.toLowerCase()} ${(active.getAttribute('aria-label') || active.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22)}`
            : 'none',
        inSeam: Boolean(active && seam && seam.contains(active)),
        seamPresent: Boolean(seam),
        seamLevel: seam?.getAttribute('data-bravais-seam-level') ?? null,
        seamControls: seam ? seam.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])').length : 0,
    };
});

const trace = [{ step: 'initial', ...(await state()) }];

for (let i = 1; i <= 12; i += 1) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(260);
    const current = await state();
    trace.push({ step: `ArrowDown#${i}`, ...current });
    if (current.inSeam) break;
}

if (!(await state()).inSeam) {
    // 墙上没有内容时 move 会先 seedSlot，方向键未必立刻放行；补几发横的再试。
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowUp', 'ArrowUp']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(260);
        trace.push({ step: key, ...(await state()) });
    }
}

await page.keyboard.press('Escape');
await page.waitForTimeout(600);
trace.push({ step: 'Escape', ...(await state()) });

await page.screenshot({ path: 'preview/tv-seam.png' });
console.log(JSON.stringify({ url, trace, errors: errors.slice(0, 5) }, null, 2));

await browser.close();
