// test/manual/tv_probe.mjs
// 电视端适配用的手动探针：在 1920x1080（1080p 电视）视口里打开 dev server，
// 采一次设备能力与布局基线，并截图。用本机已装的 Edge（channel: 'msedge'），
// 不需要 `npx playwright install` 下载 Chromium。
//
// 用法：node test/manual/tv_probe.mjs [url] [outPng] [deviceType]
//   deviceType 传 tv / phone / tablet 时，会预先把 folia_device_type 写进 localStorage，
//   用来在没有电视硬件的情况下验证电视那一支的样式。不传就按浏览器自动推断。
//
// 首启会串行弹一串引导（免费软件声明 → 更新说明 → 播放入口 → 登录高亮），
// 这里先把「看过了」的标记播种进去，再按几次 Esc 兜底，截到的才是真正的界面。

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:3000/';
const out = resolve(process.argv[3] ?? 'preview/tv-baseline.png');
const deviceType = process.argv[4] ?? null;

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
});

await context.addInitScript(({ type }) => {
    try {
        localStorage.setItem('folia_free_software_notice_seen', '1');
        localStorage.setItem('folia_sign_in_spotlight_done', '1');
        if (type) {
            localStorage.setItem('folia_device_type', type);
            localStorage.setItem('folia_device_type_answered', 'true');
        }
    } catch {
        // 隐私模式下列表可能写不进去：探针照跑，只是会多看到几个引导层。
    }
}, { type: deviceType });

const page = await context.newPage();

const consoleLines = [];
page.on('console', message => {
    if (message.type() === 'error') consoleLines.push(`[console.error] ${message.text()}`);
});
page.on('pageerror', error => consoleLines.push(`[pageerror] ${error.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
// 首屏要等音频引擎、字体和首启引导都落定，否则截到的是半成品。
await page.waitForTimeout(9000);
for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
}
await page.waitForTimeout(600);

const probe = await page.evaluate(() => {
    const mq = query => window.matchMedia(query).matches;
    const root = document.documentElement;
    const focusables = Array.from(document.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ));
    const shell = document.querySelector('[data-folia-app-shell]');
    const shellStyle = shell ? window.getComputedStyle(shell) : null;
    return {
        title: document.title,
        viewport: [window.innerWidth, window.innerHeight],
        finePointer: mq('(hover: hover) and (pointer: fine)'),
        anyFinePointer: mq('(any-pointer: fine)'),
        coarsePointer: mq('(pointer: coarse)'),
        hoverNone: mq('(hover: none)'),
        maxTouchPoints: navigator.maxTouchPoints,
        dataDevice: root.getAttribute('data-folia-device'),
        dataDeviceResolved: root.getAttribute('data-folia-device-resolved'),
        dataUiScale: root.getAttribute('data-folia-ui-scale'),
        focusableCount: focusables.length,
        focusableSample: focusables.slice(0, 8).map(node => (
            `${node.tagName.toLowerCase()}.${(node.className || '').toString().split(' ').slice(0, 2).join('.')}`
        )),
        activeElement: document.activeElement?.tagName ?? null,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        shellPadding: shellStyle ? `${shellStyle.paddingTop} ${shellStyle.paddingRight}` : null,
        rootChildren: document.getElementById('root')?.children.length ?? -1,
        splashPresent: Boolean(document.getElementById('app-splash')),
        appShellPresent: Boolean(shell),
        bodyText: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200),
    };
});

await page.screenshot({ path: out, fullPage: false });

console.log(JSON.stringify({ url, out, deviceType, probe, consoleLines: consoleLines.slice(0, 20) }, null, 2));

await browser.close();
