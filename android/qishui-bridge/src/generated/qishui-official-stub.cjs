'use strict';

// android/qishui-bridge/src/generated/qishui-official-stub.cjs
//
// 桌面端 qishui-api.js 里 `getQishuiOfficialBridge()` 会去 require 登录桥
// （qishui-qr-login → 裁剪版签名层）拿到一个「官方签名请求」出口：/luna 的账号请求
// 在桌面上走 bdms.node 的 X-Helios/X-Medusa，或隐藏窗的 a_bogus。
//
// 安卓两样都没有（bdms.node 是 Windows x64 原生模块；a_bogus 要 sdk-glue + react
// 那一整套签名页），而**实测上游已经不再校验**：/luna/pc/* 只要 Cookie 就答，
// passport 的出码与轮询同样免签名。所以这里给一个空壳 —— 它让
// `typeof bridge.requestOfficial === 'function'` 为假，协议层随即走无签名直连，
// 不会去碰任何原生模块。
//
// 这个文件由 build.mjs 替换进 vendored 副本里；上游哪天又开始要签名了，
// 症状会是「能登录、拉不到数据」，到那时该改的是这里。

module.exports = {};
