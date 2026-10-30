// scripts/force-tv-viewport.mjs
// 把同步进安卓工程的 index.html 的 viewport 钉成固定宽度。
//
// 为什么必须在打包时改，而不是页面里运行时改：
//   安卓 WebView 的初始缩放只在**首次解析 viewport** 时算一次。实测在页面里按 UA 把
//   meta 的 content 改成 width=1920 确实执行了（包里能搜到那段脚本），但布局不重算 ——
//   电视上的诊断角标依旧报 960×540。
//
// 为什么需要它：
//   安卓电视按 density 2.0 报，1080p 面板算出来的 CSS 视口只有 960×540，而这套界面是按
//   桌面 1920 设计的。写成 width=1920 之后，浏览器按 960/1920 = 0.5 的初始缩放把页面缩下来，
//   页面重新拿回 1920 的布局空间；物理面板正好 1920，缩完 1:1 落在物理像素上，字不会糊。
//
// 用法（在仓库根目录）：
//   node scripts/force-tv-viewport.mjs [目标 index.html 路径]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const target = process.argv[2] ?? 'android/app/src/main/assets/public/index.html';
const VIEWPORT = 'width=1920, user-scalable=no, viewport-fit=cover';

if (!existsSync(target)) {
    console.error(`[tv-viewport] 找不到 ${target} —— cap sync 跑过了吗？`);
    process.exit(1);
}

const html = readFileSync(target, 'utf8');
// 兼容属性顺序不同、单双引号、以及被压缩器揉成一行的情况。
const pattern = /(<meta\s+[^>]*name=["']viewport["'][^>]*content=["'])[^"']*(["'])/i;
if (!pattern.test(html)) {
    console.error('[tv-viewport] 没在 index.html 里找到 viewport 标签');
    process.exit(1);
}

const next = html.replace(pattern, `$1${VIEWPORT}$2`);
writeFileSync(target, next, 'utf8');

const verify = readFileSync(target, 'utf8');
if (!verify.includes(VIEWPORT) || !/<meta\s+[^>]*name=["']viewport["']/i.test(verify)) {
    console.error('[tv-viewport] 改写后校验失败');
    process.exit(1);
}
console.log(`[tv-viewport] 已固定为 ${VIEWPORT}`);
