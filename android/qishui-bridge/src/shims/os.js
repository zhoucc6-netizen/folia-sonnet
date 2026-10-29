// android/qishui-bridge/src/shims/os.js
//
// qishui-qr-login 用 os.hostname() 当「电脑名」，扫码时显示在汽水音乐确认页上。
// 安卓上固定成一个稳定的名字：签名宿主 WebView 的 localStorage 与桌面互相独立，
// 名字只要不变就不会让用户起疑。

export function hostname() {
    return 'Folia-Android';
}

export function platform() {
    return 'android';
}

export default { hostname, platform };
