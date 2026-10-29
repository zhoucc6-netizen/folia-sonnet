// android/qishui-bridge/src/shims/globals.js
//
// esbuild inject：把打包产物里的全局符号替换成这里的实现。
//
//   Buffer            → shims/buffer.js（协议层只用 concat / byteLength）
//   __foliaProcessEnv → esbuild 的 --define:process.env=__foliaProcessEnv 用它
//                       替换 process.env（桌面端由 qishuiApiBridge.cjs 注入环境变量，
//                       安卓在打包期写死；值是 localStorage 键的一部分，见 fs.js）。

import Buffer from './buffer.js';

const __foliaProcessEnv = {
    QISHUI_COOKIE_FILE: '/folia/qishui-cookie.txt',
    QISHUI_TOKEN_FILE: '/folia/qishui-token.txt',
    QISHUI_QR_CONFIG_FILE: '/folia/qishui-qr-login.json',
    QISHUI_OAUTH_CONFIG_FILE: '/folia/qishui-oauth.json',
};

//   __foliaDirname   → esbuild 的 --define:__dirname=__foliaDirname 用它替换
//                       Node 的 __dirname。协议层几个 CommonJS 模块在**函数体里**
//                       用 __dirname 拼配置文件路径（qishui-api.js 的 oauth 候选、
//                       qishui-auth-v6.js 的 ASSET_DIR），模块顶层那几处因为被
//                       process.env 短路了反而不会执行 —— 所以这个坑只在真正
//                       查登录态时才炸，表现为 status / refresh 抛
//                       "__dirname is not defined"。安卓侧「文件」其实是
//                       localStorage 键，给一个稳定的前缀就够。
const __foliaDirname = '/folia';
const __foliaFilename = '/folia/qishui-api.js';

export { Buffer, __foliaProcessEnv, __foliaDirname, __foliaFilename };
