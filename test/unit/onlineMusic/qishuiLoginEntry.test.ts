import { afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { getOnlineMusicProvider, listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import { resolveLoginCopy } from '@/library/core/account/accountRules';
import { qishuiProvider } from '@/services/onlineMusic/qishuiProvider';

// test/unit/onlineMusic/qishuiLoginEntry.test.ts
// 汽水音乐怎样长出一个登录入口：provider 注册进 registry 之后，登录面板、登录文案与扫码流程
// 都从这一份注册信息自己长出来，没有第二处「哪些平台可以登录」的清单。
// 三条一起钉住，免得将来谁改了注册或可用性判定，界面上悄悄少一个入口。

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const qishuiAvailability = () => omni.getProviderSummaries().find(summary => summary.providerId === 'qishui')?.availability;

const stubQishuiBridge = (handler: (operation: string, params?: Record<string, unknown>) => unknown) => {
    vi.stubGlobal('window', {
        electron: { qishuiRequest: async (operation: string, params?: Record<string, unknown>) => handler(operation, params) },
    });
};

describe('Qishui login entry', () => {
    it('注册进 providerRegistry，并且声明了扫码登录需要的全部能力', () => {
        expect(getOnlineMusicProvider('qishui')).toBe(qishuiProvider);
        expect(listOnlineMusicProviders().map(provider => provider.id)).toContain('qishui');
        const capabilities = omni.getProviderCapabilities('qishui');
        expect(capabilities.auth).toBe(true);
        expect(capabilities.userLibrary).toBe(true);
        expect(capabilities.likes).toBe(true);
    });

    it('桌面端（preload 给了 qishuiRequest）登录入口可用；没有桥时明确标成 runtime-unavailable', () => {
        stubQishuiBridge(() => ({ ok: true, data: {} }));
        expect(qishuiAvailability()).toEqual({ configured: true });

        vi.stubGlobal('window', { electron: {} });
        expect(qishuiAvailability()).toEqual({ configured: false, reason: 'runtime-unavailable' });
    });

    it('登录面板的标题与说明用自己的文案，不是网易那一份', () => {
        const copy = resolveLoginCopy('qishui');
        expect(copy.title).toEqual({ key: 'home.loginTitleQishui' });
        expect(copy.note).toEqual({ key: 'home.loginNoteQishui' });
    });

    it('omni 的扫码登录两步（createQr / checkQr）走的是汽水那一套 operation', async () => {
        const calls: Array<[string, Record<string, unknown> | undefined]> = [];
        stubQishuiBridge((operation, params) => {
            calls.push([operation, params]);
            if (operation === 'login.qr') {
                return { ok: true, data: { token: 'tok-1', qrcode: 'data:image/png;base64,AAA', expireTime: 0 } };
            }
            return { ok: true, data: { status: 'waiting', errorCode: 0 } };
        });

        const { key, imageUrl } = await omni.startLogin('qishui');
        expect(key).toBe('tok-1');
        expect(imageUrl).toBe('data:image/png;base64,AAA');
        // ⚠ 出码之前本 fork 先按偏好在桥上选一次协议（protocol.use，见 qishuiProvider 的 useProtocol），
        // 老包不认这一手时它会抛错并被吞掉，接着照旧走 login.qr，所以这里按顺序断言三步。
        expect(calls.map(([operation]) => operation)).toEqual(['protocol.use', 'login.qr']);

        const state = await omni.checkLogin('qishui', key);
        expect(state.state).toBe('waiting');
        expect(calls[2]).toEqual(['login.check', { token: 'tok-1' }]);
        expect(calls.map(([operation]) => operation)).toEqual(['protocol.use', 'login.qr', 'login.check']);
    });

    it('没有 Electron 桥时登录直接报 unavailable，而不是静默返回一个空二维码', async () => {
        vi.stubGlobal('window', { electron: {} });
        await expect(omni.startLogin('qishui')).rejects.toMatchObject({ code: 'unavailable' });
    });
});
