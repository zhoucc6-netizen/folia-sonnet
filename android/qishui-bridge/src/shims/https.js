// android/qishui-bridge/src/shims/https.js
//
// 与 http 共用同一套实现：真正的传输在原生 OkHttp 里，scheme 由 URL 自己表达。

export { request, default } from './http.js';
