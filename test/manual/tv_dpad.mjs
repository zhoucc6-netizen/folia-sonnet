// test/manual/tv_dpad.mjs
// 遥控器方向键的可达性探针：在电视视口里逐次发 keydown，记录焦点落在哪个元素上。
//
// 这是电视适配的核心判据 —— 焦点不动，说明这套界面在遥控器上走不通，
// 光有焦点框没有用。每次按键都记录 activeElement 的可读标识与它是不是真的可见。
//
// 用法：node test/manual/tv_dpad.mjs [url]

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

// 首启的「资料库用哪种界面」还压在上面：点掉它，否则按什么键都落在对话框里。
for (const label of ['下一步', '关闭', '我服了']) {
    const button = page.getByRole('button', { name: label, exact: false }).first();
    if (await button.count()) {
        await button.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(700);
    }
}
for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
}

const describe = () => page.evaluate(() => {
    const node = document.activeElement;
    if (!node || node === document.body) return { tag: 'BODY', label: null, visible: false };
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return {
        tag: node.tagName.toLowerCase(),
        label: (node.getAttribute('aria-label') || node.innerText || node.textContent || '')
            .replace(/\s+/g, ' ').trim().slice(0, 40),
        className: (node.className || '').toString().split(' ').slice(0, 3).join('.'),
        rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
        visible: rect.width > 0 && rect.height > 0,
    };
});

const trace = [];
trace.push({ step: 'initial', ...(await describe()) });

// 先按 Tab 把焦点送进页面（电视上没有 Tab，这里只是拿它当"进入界面"的等价动作）。
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
trace.push({ step: 'Tab', ...(await describe()) });

for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowUp']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(320);
    trace.push({ step: key, ...(await describe()) });
}

await page.screenshot({ path: 'preview/tv-dpad.png' });
console.log(JSON.stringify({ url, trace, errors: errors.slice(0, 5) }, null, 2));

await browser.close();
