// android/qishui-bridge/src/shims/electron.js
//
// 兜底占位：裁剪版签名层（qishui-auth-android.js）不再引用 electron，
// 挂这个 alias 只是防止上游文件被误打包时抛「module not found」。

export default {};
export const BrowserWindow = undefined;
export const app = undefined;
export const session = undefined;
