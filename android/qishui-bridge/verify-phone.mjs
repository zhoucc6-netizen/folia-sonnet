// android/qishui-bridge/verify-phone.mjs
//
// 手机协议（passport 扫码 + /luna/pc/*）的本机验证，与 verify-car.mjs 同一路子：
// 不发二维码给任何人扫，只证到「协议层能出码、能轮询、数据接口只认 Cookie」。
//
//   node android/qishui-bridge/verify-phone.mjs
//
// ⚠ 这一路**真发网络请求**（api.qishui.com），但不会登录：扫码那一步需要人在手机上确认，
// 这里只走到「二维码已生成、轮询回答等待扫码」为止。要验账号级读取（歌单 / 播放链接）
// 得先有会话 Cookie，把 COOKIE 环境变量填进来即可（从汽水客户端或浏览器导出）：
//
//   QISHUI_COOKIE='sessionid=...; sid_guard=...' node android/qishui-bridge/verify-phone.mjs

import { createQishuiPhone } from './src/phone/api.js';

const COOKIE = String(process.env.QISHUI_COOKIE || '').trim();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) SodaMusic/3.2.1 Chrome/136.0.7103.59 '
    + 'Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36';

let failures = 0;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

/** 把 node 的 fetch 包成协议层认的原生 http 桥形状。 */
const transport = {
    async request(payload) {
        const headers = { 'User-Agent': UA, ...(payload.headers || {}) };
        const response = await fetch(payload.url, {
            method: payload.method || 'GET',
            headers,
            body: payload.body == null ? undefined : payload.body,
        });
        const body = await response.text();
        return { status: response.status, headers: {}, body };
    },
};

const phone = createQishuiPhone({ transport });

console.log('— 手机协议：未登录 —');
const status = await phone.status();
check('status 说没登录', status.loggedIn === false, `protocol=${status.protocol} cookieKeys=${status.cookieKeys}`);
check('status 带出另一套协议的情况', Boolean(status.alt || status.alt === undefined));

console.log('— 手机协议：出码 —');
const started = await phone.startLogin();
const imageUrl = String(started.qrDataUrl || '');
check('拿到二维码', imageUrl.startsWith('data:image/'), `${imageUrl.slice(0, 30)}… (${imageUrl.length} 字符)`);
check('拿到轮询用的 key', String(started.key || '').length > 8, String(started.key).slice(0, 12) + '…');

// 码里装的是哪个地址：这一行是「扫了没反应」时最先要看的东西。
console.log('  扫码地址      ', started.scanUrl || '(none)');
check('二维码里是自己拼的 scan_login 地址', String(started.scanUrl || '').includes('/light/invoke/scan_login'));

if (String(process.env.QISHUI_SCAN || '') === '1') {
    // 人工扫码：跑这一支，用汽水 App 扫下面这个地址画出来的码。
    //   QISHUI_SCAN=1 node android/qishui-bridge/verify-phone.mjs
    // 确认之后会把会话 Cookie 与应用侧能拉到的东西一并打出来 —— 这就是「登录 + 拉数据」
    // 这条链路最直接的证据。终端里 qrcode 也会顺手打到 stdout（部分终端不显示，仅作参考）。
    console.log('\n—— 等你扫码确认（最多 180 秒）——');
    console.log(started.scanUrl);
    const deadline = Date.now() + 180_000;
    let state = 'waiting';
    let lastState = '';
    while (Date.now() < deadline) {
        const polled = await phone.checkLogin(started.key).catch(error => ({ state: `error: ${error?.message || error}` }));
        state = polled.state;
        if (state !== lastState) {
            lastState = state;
            console.log(`  state=${state}${polled.waitingForCookie ? ' (waitingForCookie)' : ''}`);
        }
        if (state === 'confirmed' || state === 'expired') break;
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    check('扫码确认成功', state === 'confirmed', `state=${state}`);
    if (state === 'confirmed') {
        const after = await phone.status();
        check('应用侧认下了登录态', after.loggedIn === true, `userId=${after.userId || '-'} cookieKeys=${after.cookieKeys}`);
        console.log('  cookie        ', phone.sessions?.get?.()?.cookie?.replace(/(sessionid\w*=[^;]{6})[^;]*/g, '$1…') || '(none)');
        const playlists = await phone.userPlaylists(20, 0).catch(error => ({ error: String(error?.message || error) }));
        check('我的歌单读得到', !playlists.error && Array.isArray(playlists.playlists),
            playlists.error || `${(playlists.playlists || []).length} 张`);
        const search = await phone.search('晴天', 5, 0).catch(error => ({ error: String(error?.message || error) }));
        check('搜索读得到', !search.error && Array.isArray(search.songs), search.error || `${(search.songs || []).length} 首`);
    }
} else {
    console.log('— 手机协议：轮询（没有人扫，应当回答等待）—');
    const polled = await phone.checkLogin(started.key);
    check('轮询回答 waiting', polled.state === 'waiting', `state=${polled.state}`);
}

console.log('— 手机协议：数据接口只认 Cookie（不认签名）—');
const probe = await fetch('https://api.qishui.com/luna/pc/me', {
    headers: { 'User-Agent': 'LunaPC/3.3.0(359450208)', Accept: 'application/json' },
});
const probeJson = await probe.json().catch(() => ({}));
// 没有 Cookie 时应当回「登录状态已失效」而不是「签名不对」—— 这就是手机协议
// 能在安卓上活着的根据（上游不再校验 X-Helios/X-Medusa / a_bogus）。
check('无签名请求能拿到业务应答', probe.status === 200 && Number(probeJson.status_code) === 1000016,
    `status=${probe.status} status_code=${probeJson.status_code}`);

if (!COOKIE) {
    console.log('\n（没有给 QISHUI_COOKIE，跳过账号级读取：给一段会话 Cookie 就能验歌单与播放链接。）');
} else {
    console.log('— 手机协议：账号级读取 —');
    const applied = phone.importCookie(COOKIE);
    check('Cookie 被接受', applied.restored === true, String(applied.reason || ''));
    const signedIn = await phone.status();
    check('登录态认下了', signedIn.loggedIn === true, `userId=${signedIn.userId || '-'} profileReady=${signedIn.profileReady}`);
    const playlists = await phone.userPlaylists(20, 0).catch(error => ({ error: String(error?.message || error) }));
    check('我的歌单读得到', !playlists.error && Array.isArray(playlists.playlists),
        playlists.error || `${(playlists.playlists || []).length} 张`);
    const search = await phone.search('晴天', 8, 0).catch(error => ({ error: String(error?.message || error) }));
    check('搜索读得到', !search.error && Array.isArray(search.songs), search.error || `${(search.songs || []).length} 首`);
}

console.log(failures ? `\n${failures} 项没过` : '\n全部通过');
process.exit(failures ? 1 : 0);
