// test/manual/tv_focus_audit.mjs
// 电视可达性审计：把每个页面上「看着能点、遥控器却停不上去」的容器找出来。
//
// 判据分两堆：
//   · focusable —— 真能被 focus 的元素（button / a[href] / input / role=... / tabindex>=0）；
//   · clickableNotFocusable —— 鼠标悬停变手型（cursor: pointer）、但不在上面那一堆里的元素。
//     这一类就是电视上的死区：鼠标能点，遥控器永远到不了。它不一定是 bug（整张卡片可能就是
//     一个 button 的子元素），所以排除掉「祖先本身就是可聚焦元素」的那些。
//
// 用法：node test/manual/tv_focus_audit.mjs [url]
// 输出是 JSON：每个页面两堆元素的位置与文案，够直接照着改。

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000/?splash=0';

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]',
    '[role="tab"]',
    '[role="option"]',
    '[role="menuitem"]',
    '[role="slider"]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

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

/** 关掉首启那串引导（「资料库用哪种界面」是多页的）。 */
const dismissPrompts = async () => {
    for (let round = 0; round < 8; round += 1) {
        const next = page.getByRole('button', { name: /下一步|关闭|我服了|就这样|稍后/ }).first();
        if (!(await next.count())) break;
        await next.click({ timeout: 1200 }).catch(() => {});
        await page.waitForTimeout(400);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
};

const audit = (label, focusableSelector) => page.evaluate(({ label, selector }) => {
    const describe = node => {
        const r = node.getBoundingClientRect();
        const text = (node.getAttribute('aria-label') || node.textContent || '')
            .replace(/\s+/g, ' ').trim().slice(0, 30);
        return {
            tag: node.tagName.toLowerCase(),
            role: node.getAttribute('role') ?? '',
            text,
            at: [Math.round(r.x), Math.round(r.y)],
            size: [Math.round(r.width), Math.round(r.height)],
        };
    };
    const visible = node => {
        const r = node.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const s = window.getComputedStyle(node);
        return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
    };

    const focusables = Array.from(document.querySelectorAll(selector)).filter(visible);
    const focusableSet = new Set(focusables);

    // 手型光标、且没有可聚焦的祖先 —— 电视上到不了的地方。
    //
    // 两个必须排除的假阳性（都踩过）：
    //   ① cursor 会**继承**：设置页的可点击行给容器加了 cursor-pointer，行里每一层 div/span
    //      都跟着变成手型，但它们本身不是可点区域。只认「自己引入手型」的元素，即父元素不是手型。
    //   ② 覆盖式按钮：kit 的 Row 在整行上铺了一个绝对定位的 <button>，行容器本身不可聚焦、
    //      但它是可达的。凡是内部有一个覆盖自己矩形（误差 8px 内）的可聚焦后代，就不算死区。
    const sameBox = (a, b) => (
        Math.abs(a.left - b.left) < 8 && Math.abs(a.top - b.top) < 8
        && Math.abs(a.width - b.width) < 8 && Math.abs(a.height - b.height) < 8
    );
    const dead = Array.from(document.querySelectorAll('body *')).filter(node => {
        if (!visible(node)) return false;
        const style = window.getComputedStyle(node);
        if (style.cursor !== 'pointer') return false;
        const parent = node.parentElement;
        if (parent && window.getComputedStyle(parent).cursor === 'pointer') return false;
        if (node.closest(selector)) return false;
        if (focusableSet.has(node)) return false;
        const own = node.getBoundingClientRect();
        const covered = Array.from(node.querySelectorAll(selector))
            .some(child => sameBox(own, child.getBoundingClientRect()));
        return !covered;
    });

    return {
        label,
        focusableCount: focusables.length,
        deadCount: dead.length,
        focusable: focusables.slice(0, 60).map(describe),
        dead: dead.slice(0, 40).map(describe),
    };
}, { label, selector: focusableSelector });

const reports = [];
await dismissPrompts();
reports.push(await audit('home', FOCUSABLE));

// 设置窗
try {
    const settings = page.getByRole('button', { name: '设置' }).first();
    if (await settings.count()) {
        await settings.click({ timeout: 3000 });
        await page.waitForTimeout(2500);
        reports.push(await audit('settings', FOCUSABLE));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(800);
    }
} catch (error) {
    reports.push({ label: 'settings', error: String(error).slice(0, 120) });
}

// 登录窗
try {
    const opened = await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll('button'))
            .find(node => (node.textContent ?? '').includes('连接在线平台'));
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
    });
    if (opened) {
        await page.waitForTimeout(3000);
        reports.push(await audit('login', FOCUSABLE).then(async report => {
            await page.screenshot({ path: 'preview/tv-audit-login.png' });
            return report;
        }));
    }
} catch (error) {
    reports.push({ label: 'login', error: String(error).slice(0, 120) });
}

console.log(JSON.stringify({ url, reports, errors: errors.slice(0, 5) }, null, 2));

await browser.close();
