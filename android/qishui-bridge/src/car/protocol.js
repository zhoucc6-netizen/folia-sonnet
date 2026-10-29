// android/qishui-bridge/src/car/protocol.js
//
// 汽水车机协议（/api/luna/v1/platform）的常量与请求拼装。
//
// 常量与字段形状照 GSQZ/qishui-music-api（MIT）0.2.1 移植：上游认的是这一整套
// app_id / channel / device_* 组合，改任何一个都可能整条链路 401/空数据。
// 差异只有一处：guard 头里的签名是异步的（WebCrypto），所以 qishuiGuardHeaders
// 是 async 函数，调用方一律 await。

import { base64ToBytes, bytesToBase64, randomHex, randomBytes, utf8Bytes } from './bytes.js';
import { importPrivateKeyPem, signTextDerBase64 } from './guard.js';

export const QISHUI_UA = 'LunaOpenSDK/1.0.10';
export const QISHUI_PREFIX = '/api/luna/v1/platform';
export const QISHUI_CLIENT_KEY = 'aw4bbxfujo741d09';

// 车机 SDK 的固定身份：aid/app_id/sdk_* 全按上游给的那一套写死。
export const QISHUI_COMMON = {
    aid: '765213',
    app_id: '765213',
    app_name: 'byte_autoservice_lite',
    version_code: '100010',
    version_name: '1.0.10',
    channel: 'bydSong',
    sdk_aid: '753999',
    caller_name: 'luna_open_sdk',
    sdk_version_code: '100000100',
    sdk_version_name: '0.0.1',
    sdk_channel: 'Test',
    vehicle_type: 'BYD',
    device_brand: 'BYD',
    device_type: 'BYD',
    device_platform: 'android',
    resolution: '1920x1080',
    os_version: '13',
    ac: 'wifi',
};

export const QISHUI_OPEN_HOST = 'https://open.qishui.com';
export const QISHUI_DOUYIN_HOST = 'https://open.douyin.com';
export const QISHUI_OPEN_CLIENT_HOST = 'https://open-client.douyin.com';

/** 每个请求的公共 query：设备身份 + 时间戳 + 随机数。 */
export function qishuiParams(deviceId) {
    const values = new URLSearchParams(Object.entries(QISHUI_COMMON));
    values.set('device_id', String(deviceId));
    values.set('did', String(deviceId));
    values.set('iid', String(deviceId));
    values.set('vehicle_id', `qishui-${deviceId}`);
    values.set('_timestamp', String(Math.floor(Date.now() / 1000)));
    const nonce = randomBytes(2);
    values.set('_nonce', String((nonce[0] << 8) | nonce[1]));
    return values.toString();
}

// 扫码授权那一路的参数（aid 1128 = 抖音开放平台扫码）。
// app_identity 是 md5('com.luna.music.car') 的常量，直接写死省一份摘要实现。
const QR_COMMON = {
    aid: '1128',
    client_key: QISHUI_CLIENT_KEY,
    state: '',
    next: '',
    jump_type: 'native',
    optional_scope_check: '',
    optional_scope_uncheck: '',
    customize_params: '{"source":"pc_auth","not_skip_confirm":"true"}',
    source_from: 'native',
    device_platform: 'android',
    app_identity: '82a0737a3f8d93d9958c8a7938bbc365',
    signature: 'cf9024ea72d9c71813238b13ea107a3d',
};

export const QISHUI_QR_SCOPE = 'user_info,luna.openapi.platform.interaction,'
    + 'luna.openapi.platform.me_tab,luna.commerce.openapi_platform.vip_info';

export function qrParams() {
    return { ...QR_COMMON, scope: QISHUI_QR_SCOPE };
}

const GUARD_KEYS = ['ticket', 'guardKey', 'guardCert', 'guardTsSign'];

/** 一次带 ticket-guard 的请求要带的三个头（access-token 另由调用方给）。 */
export async function qishuiGuardHeaders(credential, path) {
    for (const key of GUARD_KEYS) {
        const value = credential?.[key];
        if (typeof value !== 'string' || !value || value.length > 16384) {
            throw new Error('invalid guard credential');
        }
    }
    const privateKey = await importPrivateKeyPem(credential.guardKey);
    const timestamp = Math.floor(Date.now() / 1000);
    const content = `ticket=${credential.ticket}&path=${QISHUI_PREFIX}${path}&timestamp=${timestamp}`;
    return {
        'access-token': credential.ticket,
        'bd-ticket-guard-version': '1',
        'bd-ticket-guard-client-cert': credential.guardCert,
        'bd-ticket-guard-client-data': bytesToBase64(utf8Bytes(JSON.stringify({
            ts_sign: credential.guardTsSign,
            req_content: 'ticket,path,timestamp',
            req_sign: await signTextDerBase64(privateKey, content),
            timestamp,
        }))),
    };
}

/** 服务端在响应头里下发的 guard 数据（base64 JSON）。 */
export function readQishuiGuard(raw) {
    // 三种失败要分开说：头没到、头不是 base64 JSON、字段不全 —— 真机诊断里
    // 只有一句 'invalid guard response' 等于没有信息。
    if (typeof raw !== 'string' || !raw) throw new Error('guard header is missing');
    if (raw.length > 65536) throw new Error('guard header is too large');
    let json;
    try {
        json = JSON.parse(new TextDecoder().decode(base64ToBytes(raw)));
    } catch (_) {
        throw new Error('guard header is not base64 JSON');
    }
    for (const key of ['ticket', 'ts_sign', 'client_cert']) {
        if (typeof json[key] !== 'string' || !json[key] || json[key].length > 16384) {
            throw new Error(`guard header field missing or invalid: ${key}`);
        }
    }
    const cert = json.client_cert;
    return {
        ticket: json.ticket,
        guardTsSign: json.ts_sign,
        guardCert: cert.includes('-----BEGIN') ? bytesToBase64(utf8Bytes(cert)) : cert,
    };
}

/**
 * access_code 的过期时间：可能是秒/毫秒时间戳，也可能是「还有多少秒」。
 *
 * 返回 **Date**（与参考实现一致，调用方写的是 `.getTime()`）—— 早先这里返回
 * 数字，真机上表现为 `qishuiCredentialExpiry(...).getTime is not a function`，
 * 而且发生在 ticket 已经换到手之后，白白断掉一次登录。
 */
export function qishuiCredentialExpiry(raw) {
    const value = Number(raw || 0);
    const expires = value > 1e12 ? value : value > 1e9 ? value * 1000
        : value > 0 ? Date.now() + value * 1000 : Date.now() + 6 * 3600000;
    if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('invalid credential expiry');
    return new Date(expires);
}

export const isAccountId = value => (
    typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\s\x00-\x1f\x7f]/u.test(value)
);
export const isQishuiDeviceId = value => typeof value === 'string' && /^\d{19}$/.test(value);

// QR 会话的本地 key（32 位十六进制）：只在本页面内用，上游不认识它。
export const newQrKey = () => randomHex(16);

export { randomHex };
