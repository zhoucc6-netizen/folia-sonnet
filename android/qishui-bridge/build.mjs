// android/qishui-bridge/build.mjs
//
// 把汽水协议层（车机协议 + 手机协议）打包成签名宿主页面能跑的产物，并装配进
// android/app/src/main/assets/qishui/：
//
//   protocol.js    entry.js（车机协议 + 手机协议 + Node shims）的 esbuild 产物
//   folia-xhr.js   原生 http 桥（源文件直拷，无打包需求）
//   bootstrap.html 签名宿主页面：只剩上面两个脚本
//
// 两套协议都在同一个产物里，选哪套由渲染层在运行时决定（见 entry.js 的 protocol.use）。
//
// 手机协议的数据层是**桌面端那份的 vendored 副本**（src/generated/qishui-web-api.cjs）：
// /luna/pc/* 的响应嵌套很深，安卓这边不另写一套解析，免得把同一个坑踩两遍。副本由
// 本脚本从 electron/qishui/qishui-api.js 生成，唯一的改动是把签名桥那一处 require
// 换成空壳（generated/qishui-official-stub.cjs）—— 上游已经不校验签名（见那个文件的注释）。
// 它用 Node 的 fs / crypto / http(s) / os / path，靠 src/shims/ 下的浏览器实现顶上。
//
// 产物需要提交进仓库（安卓构建不跑 node），改了 src/ 后要重跑：
//   node android/qishui-bridge/build.mjs

import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const assetsDir = join(repoRoot, 'android', 'app', 'src', 'main', 'assets', 'qishui');
const upstreamWebApi = join(repoRoot, 'electron', 'qishui', 'qishui-api.js');
const generatedWebApi = join(here, 'src', 'generated', 'qishui-web-api.cjs');

function esbuild(args) {
    // npx 只在首次需要下载，之后走本地缓存；不往 package.json 里加 devDependency。
    // Windows 上 npx 是 .cmd，shell 必须开；execSync 在失败时把 stderr 一起抛出。
    const command = 'npx -y esbuild@0.25.10 ' + args.map(shellQuote).join(' ');
    try {
        const output = execSync(command, {
            cwd: here,
            shell: true,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (output.trim()) console.log(output.trim());
    } catch (error) {
        const detail = [error.stdout, error.stderr].filter(Boolean).join('\n');
        throw new Error('esbuild failed:\n' + (detail || error.message));
    }
}

function shellQuote(value) {
    return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : '"' + value.replace(/"/g, '\\"') + '"';
}

function copy(src, dest) {
    writeFileSync(dest, readFileSync(src));
}

/**
 * 生成桌面端协议层的安卓副本。
 *
 * esbuild 的 alias 不接受相对路径，而 qishui-api.js 里恰有一行
 * require('./qishui-qr-login') 要换成空壳。与旧版处理 qishui-qr-login.js 的做法
 * 一致：构建时生成 vendored 副本（.cjs：根 package.json 是 type: module，
 * .js 会被当成 ESM），其余内容一字不动；源文件结构变了就让构建失败（人工核对）。
 */
function buildGeneratedWebApi() {
    const source = readFileSync(upstreamWebApi, 'utf8');
    const needle = "require('./qishui-qr-login')";
    if (!source.includes(needle)) {
        throw new Error('qishui-api.js 不再包含 ' + needle + '，请人工核对后更新 build.mjs');
    }
    mkdirSync(dirname(generatedWebApi), { recursive: true });
    writeFileSync(generatedWebApi, source.split(needle).join("require('./qishui-official-stub.cjs')"));
}

function buildBootstrap() {
    // 极简宿主页：挂在假源 https://www.qishui.com/__folia/bootstrap.html 下加载
    // （QishuiSignHost.shouldInterceptRequest 按这个路径回本文件），协议层需要的
    // 全局只有 FoliaQishuiHost（原生注入）与 __foliaHttpTransport（folia-xhr.js）。
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Folia Qishui Car Protocol</title>
<!-- Folia Android：由 android/qishui-bridge/build.mjs 生成。
     车机协议版：不再加载 sdk-glue / bdms / react（那是旧 passport a_bogus
     签名的依赖），只保留原生 http 桥与协议层两个脚本。改 src/ 后重新构建。 -->
<script src="folia-xhr.js"></script>
<script src="protocol.js"></script>
</head>
<body></body>
</html>
`;
}

buildGeneratedWebApi();

rmSync(assetsDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

esbuild([
    join(here, 'src', 'entry.js'),
    '--bundle',
    '--format=iife',
    '--target=chrome110',
    '--platform=browser',
    '--charset=utf8',
    '--legal-comments=none',
    '--outfile=' + join(assetsDir, 'protocol.js'),
    // 手机协议那份是桌面端的 CommonJS 模块：Node 内建模块要靠 shims 顶上
    // （fs → localStorage，http/https → 原生 OkHttp 桥），Node 内建变量靠注入的标识符
    // 替换 —— 走标识符而不是字符串字面量，避开 Windows cmd 对引号的处理。
    '--inject:' + join(here, 'src', 'shims', 'globals.js'),
    '--define:process.env=__foliaProcessEnv',
    '--define:__dirname=__foliaDirname',
    '--define:__filename=__foliaFilename',
    '--alias:fs=./src/shims/fs.js',
    '--alias:os=./src/shims/os.js',
    '--alias:path=./src/shims/path.js',
    '--alias:crypto=./src/shims/crypto.js',
    '--alias:http=./src/shims/http.js',
    '--alias:https=./src/shims/https.js',
    '--alias:electron=./src/shims/electron.js',
]);

copy(join(here, 'src', 'folia-xhr.js'), join(assetsDir, 'folia-xhr.js'));
writeFileSync(join(assetsDir, 'bootstrap.html'), buildBootstrap());

// 旧版清单里的 officialBdmsUrl 只服务 bdms.js 重定向；两套协议都不加载 bdms，
// 保留 manifest 但去掉该字段，QishuiSignHost 里对它的引用已经不存在了。
writeFileSync(join(assetsDir, 'manifest.json'), JSON.stringify({
    // 两套协议都在同一个产物里：车机（luna-car，默认）与手机（passport-web）。
    protocols: ['luna-car', 'passport-web'],
    defaultProtocol: 'luna-car',
    version: 3,
}, null, 2));

const produced = readdirSync(assetsDir);
console.log('[qishui-bridge] assets ready:', produced.join(', '));
