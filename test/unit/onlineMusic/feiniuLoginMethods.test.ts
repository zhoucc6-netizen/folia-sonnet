import { describe, expect, it } from 'vitest';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import {
    feiniuFnIdFromServerUrl,
    feiniuServerUrlFromFnId,
    isFeiniuRelayAddress,
    isFnConnectLoginPage,
    normalizeFeiniuServerUrl,
} from '@/services/onlineMusic/feiniuTransport';

// test/unit/onlineMusic/feiniuLoginMethods.test.ts
// 飞牛的登录有两种方式：FN ID（人在外面，只填那个 ID）与局域网地址（人在家里，手写 IP:端口）。
// 两种方式后面是同一张表单（用户名 + 密码），区别全在第一栏怎么变成地址 ——
// 这里钉住这个翻译：手抄错一点（多了空格、写了 https、带端口、带 /music 尾巴）都要难不倒它。

describe('an FN ID becomes the address of that machine', () => {
    it('adds the relay domain the vendor hands out, and speaks https', () => {
        // 中继域名是飞牛自己的 fnos.net（实测：baixiao.fnos.net 在多个公共 DNS 上都解析得到，
        // 而 baixiao.5ddd.com 一律 NXDOMAIN —— 5ddd.com 是上一代通道）。写错后缀的报法最坏：
        // DNS 直接解析不了，界面只说「连不上」，看着像 NAS 没开机。所以这个后缀必须钉住。
        expect(feiniuServerUrlFromFnId('baixiao')).toBe('https://baixiao.fnos.net');
        expect(feiniuServerUrlFromFnId(' ABCD1234 ')).toBe('https://abcd1234.fnos.net');
    });

    it('leaves an address that is already one alone, and keeps the scheme it was written with', () => {
        // 用户从浏览器地址栏复制来的往往是整条：域名已经在里面，不该再补一次后缀。
        expect(feiniuServerUrlFromFnId('https://abcd1234.fnos.net/')).toBe('https://abcd1234.fnos.net');
        // 自己的局域网写着 http 就还是 http：连自己域名的人知道自己在连哪里，别替他改成 https。
        expect(feiniuServerUrlFromFnId('http://192.168.1.5:5666/music/')).toBe('http://192.168.1.5:5666');
        expect(feiniuServerUrlFromFnId('abcd1234.fnos.net:8443')).toBe('https://abcd1234.fnos.net:8443');
    });

    it('is empty when nothing was typed', () => {
        expect(feiniuServerUrlFromFnId('')).toBe('');
        expect(feiniuServerUrlFromFnId('   ')).toBe('');
    });

    it('survives the paste that comes with a full-width colon', () => {
        expect(feiniuServerUrlFromFnId('abcd1234.fnos.net：8443')).toBe('https://abcd1234.fnos.net:8443');
    });
});

describe('the other way round: whether an address is one of those', () => {
    it('answers the ID for a machine reached through either relay domain', () => {
        expect(feiniuFnIdFromServerUrl('https://baixiao.fnos.net')).toBe('baixiao');
        expect(feiniuFnIdFromServerUrl('abcd1234.fnos.net:8443/music')).toBe('abcd1234');
        // 上一代通道连过的旧地址也要认得出（预填那一栏用）。
        expect(feiniuFnIdFromServerUrl('abcd1234.5ddd.com')).toBe('abcd1234');
        // 局域网地址不是 FN ID：那一栏不该被它填上。
        expect(feiniuFnIdFromServerUrl('http://192.168.1.5:5666')).toBe('');
        expect(feiniuFnIdFromServerUrl('')).toBe('');
    });
});

describe('whether an address goes through the relay', () => {
    // 走中继的请求（含登录那一发）必须带 `mode=relay`，否则网关 302 掉。实测 fnos.net：
    // 带 → 200 + JSON；不带 → 302 + nginx 的 HTML。
    it('is true for both relay domains, and only for them', () => {
        expect(isFeiniuRelayAddress('https://baixiao.fnos.net')).toBe(true);
        expect(isFeiniuRelayAddress('abcd1234.5ddd.com')).toBe(true);
        expect(isFeiniuRelayAddress('http://192.168.1.5:5666')).toBe(false);
        expect(isFeiniuRelayAddress('192.168.1.5:5666')).toBe(false);
        // 自己的 DDNS 域名是直连，不是中继。
        expect(isFeiniuRelayAddress('nas.example.com')).toBe(false);
        expect(isFeiniuRelayAddress('')).toBe(false);
    });
});

describe('the address typed the other way is left as it is', () => {
    it('keeps http together with its default port', () => {
        expect(normalizeFeiniuServerUrl(' http://192.168.1.5:5666/music/ ')).toBe('http://192.168.1.5:5666');
    });
});

describe('a page the gateway hands back instead of an answer', () => {
    // 网关不放行时给的是一页 HTML。认得出它，界面才能说「网关把请求拨走了」，
    // 而不是「这个地址上没有服务」。
    const gateway = '<!doctype html><html lang="zh-CN"><head>'
        + '<link rel="icon" href="https://static2.fnnas.com/connect/favicon.ico"/>'
        + '<title>FN Connect 远程访问 - 飞牛 fnOS</title></head><body><div id="app"></div></body></html>';

    it('knows the gateway login page when it sees one', () => {
        expect(isFnConnectLoginPage(gateway)).toBe(true);
    });

    it('leaves any other page alone, so a wrong address still says service not found', () => {
        expect(isFnConnectLoginPage('<html><head><title>fnOS</title></head><body>登录</body></html>')).toBe(false);
        expect(isFnConnectLoginPage('')).toBe(false);
    });

    it('does not catch the relay turning a request away — that one is told by its status, not its text', () => {
        // fnos.net 网关拦下请求的方式是 302 + nginx 那一页（实测），它不带 FN Connect 的字样：
        // 这一页只能按状态码认（feiniuRequest 里 3xx + HTML 的那一段）。
        const nginx = '<html>\n<head><title>302 Found</title></head>\n<body>\n'
            + '<center><h1>302 Found</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>';
        expect(isFnConnectLoginPage(nginx)).toBe(false);
    });
});

describe('the two sign-in methods a platform of this kind declares', () => {
    const methods = getOnlineMusicProvider('feiniu')!.auth!.getLoginMethods!();

    it('offers both, and each of them leads to the form rather than to a code', () => {
        expect(methods.map(method => method.id)).toEqual(['fnid', 'server']);
        // 没有二维码可言的平台：两种方式都必须通向表单，否则会停在等着取码那一屏。
        expect(methods.every(method => Boolean(method.passwordField))).toBe(true);
    });

    it('names its own first field, so the window stays clear of platforms', () => {
        expect(Object.fromEntries(methods.map(method => [method.id, method.passwordField?.labelKey]))).toEqual({
            fnid: 'home.loginFeiniuFnId',
            server: 'home.loginServerUrl',
        });
    });
});
