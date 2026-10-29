// android/qishui-bridge/src/car/auth.js
//
// 车机扫码授权：抖音 App 扫码 → auth_code → access_code → ticket（bd-ticket-guard）。
//
// 凭据只来自「用户在 Folia 里主动发起的那一次扫码」：本文件不读任何别的 App 的
// 登录态，也不碰 WebView 的 cookie 罐（旧 passport 那套整体不再使用）。
//
// 与参考实现（GSQZ/qishui-music-api，MIT）的对应关系：
//   start() → 建二维码；check() → 轮询并在确认后换 ticket；status() → 令牌续期。
// 差异：createGuard 是异步的（WebCrypto），以及会话持久化落在 localStorage
// （见 storage.js）而不是宿主的内存仓库。

import { QISHUI_CLIENT_KEY, QISHUI_DOUYIN_HOST, QISHUI_OPEN_CLIENT_HOST, QISHUI_OPEN_HOST,
    QISHUI_PREFIX, isAccountId, newQrKey, qrParams, qishuiCredentialExpiry, readQishuiGuard } from './protocol.js';
import { createGuard } from './guard.js';
import { QishuiError } from './client.js';
import { DEVICE_KEY, SESSION_KEY, readJson, remove, writeJson } from './storage.js';
import { randomDigits19 } from './bytes.js';

const QR_TTL_MS = 5 * 60 * 1000;

export function createSessions() {
    let deviceId = readJson(DEVICE_KEY, null);
    // 设备 ID 是不是**读回来的**：它是「持久化有没有真的生效」的探针 ——
    // 每次启动都重新生成一个，说明那一档存储根本没读出来，凭据也一样读不回来。
    const deviceIdReused = typeof deviceId === 'string' && /^\d{19}$/.test(deviceId);
    if (!deviceIdReused) {
        deviceId = randomDigits19();
        writeJson(DEVICE_KEY, deviceId);
    }
    let current = readJson(SESSION_KEY, null);
    let reread = false;
    let revision = 0;
    return {
        deviceId,
        deviceIdReused,
        get revision() { return revision; },
        get() {
            // 页面刚起来那一刻原生存储万一还没就绪，这里补问一次（只补一次）：
            // 少了这一手，那一次启动就永久判定为「没登录」，而凭据其实一直在。
            if (!current && !reread) {
                reread = true;
                current = readJson(SESSION_KEY, null) || null;
            }
            return current;
        },
        set(value) {
            current = value;
            revision++;
            if (value) writeJson(SESSION_KEY, value);
            else remove(SESSION_KEY);
        },
        clear() {
            current = null;
            revision++;
            remove(SESSION_KEY);
        },
    };
}

export function createAuth(client, { log = () => {} } = {}) {
    const pending = new Map();
    let generation = 0;
    let refreshing;
    const { http, query, platform, sessions } = client;

    const clean = () => {
        for (const [key, value] of pending) {
            if (value.expires <= Date.now()) pending.delete(key);
        }
    };

    const step = async (stage, run) => {
        try { return await run(); }
        catch (error) {
            // 保留原始 message：换成一句笼统的「读不出来」会让真机诊断只剩
            // stage 名，看不出是响应头没到还是内容不对（ticket 那一步踩过）。
            const failure = error instanceof QishuiError
                ? error
                : new QishuiError('invalid-response',
                    String(error?.message || error) || 'Qishui sign-in response could not be read');
            failure.stage ||= stage;
            throw failure;
        }
    };

    const getUser = credential => step('account', async () => {
        const { my_info: user } = await platform('/me/info/', {}, credential);
        if (!isAccountId(user?.id)) throw new QishuiError('invalid-response', 'Qishui did not identify the account');
        return {
            id: String(user.id),
            nickname: String(user.nickname || ''),
            avatar: user.medium_avatar_url || user.avatar_url || user.thumb_avatar_url,
            isVip: user.is_vip === true,
        };
    });

    async function ticket(access, guard, deviceId) {
        if (!access.access_code) throw new QishuiError('invalid-response', 'Access code is missing');
        const response = await http(`${QISHUI_OPEN_CLIENT_HOST}/passport/open/get_access_ticket/?${
            new URLSearchParams({ aid: '1128', client_key: QISHUI_CLIENT_KEY, device_platform: 'android' })}`, {
            body: { access_code: access.access_code, open_id: String(access.open_id || access.open_uid || '') },
            form: true,
            headers: {
                'bd-ticket-guard-version': '1',
                ...(guard.csr ? { 'bd-ticket-guard-client-csr': guard.csr } : { 'bd-ticket-guard-client-cert': guard.guardCert }),
            },
        });
        // guard 数据只走响应头。这里把它读不到时的现场（状态码 + 头名清单 +
        // 有没有 guard 相关的头）全部写进错误信息：真机上这一拍失败，除了一份
        // 诊断文本什么都没有，越具体越好。头的值一律不带（那是凭据）。
        const guardHeader = response.headers.get('bd-ticket-guard-server-data');
        let guardData;
        try {
            guardData = readQishuiGuard(guardHeader);
        } catch (error) {
            const names = typeof response.headers.names === 'function' ? response.headers.names() : [];
            const related = names.filter(name => /ticket-guard/i.test(String(name)));
            throw new Error(`readQishuiGuard failed (${String(error?.message || error)})`
                + `; http=${response.status ?? '?'}`
                + ` headers=[${names.join(' ') || 'none'}]`
                + ` guardHeaders=[${related.join(' ') || 'none'}]`
                + ` rawLength=${guardHeader ? String(guardHeader.length) : '0'}`);
        }
        return {
            deviceId,
            guardKey: guard.guardKey,
            ...guardData,
            accessCode: access.access_code,
            openId: String(access.open_id || access.open_uid || ''),
            expiresAt: qishuiCredentialExpiry(access.expires_time).getTime(),
        };
    }

    /** 续期：access_code 临近过期就换新的一张，再拿新 ticket；顺便刷新用户资料。 */
    async function renew() {
        const old = sessions.get();
        if (!old) return null;
        const revision = sessions.revision;
        let candidate = old;
        if (Number(old.expiresAt) < Date.now() + 3600000) {
            const result = await http(query(`${QISHUI_OPEN_HOST}${QISHUI_PREFIX}/access/code/refresh/`,
                { access_code: old.accessCode }, old.deviceId));
            const access = result.data.data || result.data;
            candidate = await ticket({ ...access, open_id: access.open_id || access.open_uid || old.openId }, old, old.deviceId);
        }
        const user = await getUser(candidate);
        if (user.id !== old.userId) throw new QishuiError('auth-required', 'Qishui account identity changed');
        if (revision !== sessions.revision) return null;
        sessions.set({ ...candidate, userId: user.id, user });
        return user;
    }

    return {
        async start() {
            clean();
            pending.clear();
            const mine = ++generation;
            const result = await http(`${QISHUI_DOUYIN_HOST}/oauth/get_qrcode/?${new URLSearchParams(qrParams())}`);
            const data = result.data.data;
            if (!data?.token || !data.qrcode) throw new QishuiError('invalid-response', 'QR code is missing');
            if (mine !== generation) throw new QishuiError('unavailable', 'Sign-in was cancelled');
            const key = newQrKey();
            pending.set(key, { token: data.token, qr: `data:image/png;base64,${data.qrcode}`, expires: Date.now() + QR_TTL_MS });
            log('[Qishui] Sign-in QR created');
            return { key, imageUrl: `data:image/png;base64,${data.qrcode}` };
        },

        qr(key) {
            clean();
            const value = pending.get(key);
            if (!value) throw new QishuiError('unavailable', 'QR session expired');
            return { imageUrl: value.qr };
        },

        async check(key) {
            clean();
            const value = pending.get(key);
            if (!value) return { state: 'expired' };
            if (value.task) return value.task;
            const revision = sessions.revision;
            const run = async () => {
                const result = await http(`${QISHUI_DOUYIN_HOST}/oauth/check_qrcode/?${
                    new URLSearchParams({ ...qrParams(), token: value.token, timestamp: String(Date.now()) })}`);
                const data = result.data.data;
                if (!data || !['new', 'scanned', 'confirmed', 'expired', 'refused'].includes(data.status)) {
                    throw new QishuiError('invalid-response', 'Invalid QR status');
                }
                if (data.status !== 'confirmed') {
                    if (['expired', 'refused'].includes(data.status)) pending.delete(key);
                    return data.status === 'refused'
                        ? { state: 'error', failure: { case: 'refused' } }
                        : { state: data.status === 'new' ? 'waiting' : data.status };
                }
                const code = data.code || data.auth_code;
                if (!code) throw new QishuiError('invalid-response', 'QR authorization code is missing');
                const access = await step('access-code', async () => {
                    const response = await http(query(`${QISHUI_OPEN_HOST}${QISHUI_PREFIX}/access/code/get/`, { auth_code: code }));
                    return response.data.data || response.data;
                });
                const credential = await step('ticket', async () => ticket(access, await createGuard(), sessions.deviceId));
                const user = await getUser(credential);
                if (pending.get(key) !== value || sessions.revision !== revision) return { state: 'expired' };
                sessions.set({ ...credential, userId: user.id, user });
                pending.delete(key);
                log('[Qishui] Sign-in confirmed; account stored');
                return { state: 'confirmed' };
            };
            value.task = run().finally(() => { value.task = undefined; });
            return value.task;
        },

        cancel(key) { pending.delete(key); },

        logout() {
            generation++;
            pending.clear();
            sessions.clear();
            log('[Qishui] Signed out');
        },

        status() {
            if (!refreshing) refreshing = renew().finally(() => { refreshing = undefined; });
            return refreshing;
        },
    };
}

export default { createAuth, createSessions };
