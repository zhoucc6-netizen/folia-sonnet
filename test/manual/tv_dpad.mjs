// test/manual/tv_dpad.mjs
// 遥控器方向键的可达性探针：在电视视口里逐次发方向键，记录焦点落在哪个元素上。
//
// 分两段跑，因为导航层有「让路」规则（见 components/app/tv/useSpatialNavigation）：
//   A. 弹窗还开着时按方向键 —— 弹窗在最上面，方向键应当归导航层，焦点要在弹窗内部走；
//   B. 关掉弹窗、手动把焦点放到顶部标签栏 —— 已经有 DOM 焦点，方向键应当继续在控件间走。
// 只有两段都动，才说明「遥控器点不到按钮」这件事真的解决了。
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

const describe = () => page.evaluate(() => {
    const node = document.activeElement;
    if (!node || node === document.body) return { tag: 'BODY', label: null };
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const scope = node.closest('[data-folia-keyboard-window="true"], [aria-modal="true"]');
    return {
        tag: node.tagName.toLowerCase(),
        label: (node.getAttribute('aria-label') || node.innerText || node.textContent || '')
            .replace(/\s+/g, ' ').trim().slice(0, 34),
        at: [Math.round(rect.x), Math.round(rect.y)],
        outline: `${style.outlineWidth} ${style.outlineStyle}`,
        inDialog: Boolean(scope),
    };
});

const trace = [];
const press = async (phase, key) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(280);
    trace.push({ phase, key, ...(await describe()) });
};

// ---- A：弹窗开着 ----
trace.push({ phase: 'A', key: '(initial)', ...(await describe()) });
for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']) {
    await press('A', key);
}

// ---- B：关掉弹窗，手动给焦点 ----
for (const label of ['下一步', '关闭', '我服了', '就这样']) {
    const button = page.getByRole('button', { name: label, exact: false }).first();
    if (await button.count()) {
        await button.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
    }
}
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

const seeded = await page.evaluate(() => {
    const candidate = document.querySelector('nav button, header button, [role="tab"]');
    if (!(candidate instanceof HTMLElement)) return false;
    candidate.focus();
    return document.activeElement === candidate;
});
trace.push({ phase: 'B', key: seeded ? '(seeded focus)' : '(no seed)', ...(await describe()) });
for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
    await press('B', key);
}

await page.screenshot({ path: 'preview/tv-dpad.png' });
console.log(JSON.stringify({ url, trace, errors: errors.slice(0, 5) }, null, 2));

await browser.close();
