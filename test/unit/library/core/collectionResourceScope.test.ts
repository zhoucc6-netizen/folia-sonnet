import { describe, expect, it, vi } from 'vitest';
import type { OnlineGridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';

// test/unit/library/core/collectionResourceScope.test.ts
// 来自上游 #879。无版本集合（拿不到 updatedAt 的那种）会有一段时间的内存复用，
// 所以它们必须按账号隔离 —— 否则切账号之后，上一账号的歌单会直接交给下一个人看。
// 这里只在「组装资源」这一层检查身份，不启动任何真实服务。

vi.mock('@/services/onlineMusic/omni', () => ({ omni: {} }));
vi.mock('@/services/db', () => ({ saveToCache: vi.fn(), getFromCache: vi.fn() }));
vi.mock('@/library/core/collection/resource/navidromeCollectionResource.service', () => ({ createNavidromeCollectionResource: vi.fn() }));
vi.mock('@/library/core/collection/resource/navidromeCollectionTracks.service', () => ({ resolveNavidromeServerScope: () => 'server' }));

const { resolveCollectionResourceKey } = await import('@/library/core/collection/resource/createCollectionResource.service');

const playlist = (overrides: Partial<OnlineGridViewCollectionDescriptor> = {}): OnlineGridViewCollectionDescriptor => ({
    source: 'online', providerId: 'p', type: 'playlist', id: 'pl', name: 'Playlist', ...overrides,
});

describe('在线集合资源的账号作用域', () => {
    it('无版本集合把未登录与不同账号分开', () => {
        const descriptor = playlist();
        const keys = [undefined, 'alice', 'bob'].map(user => resolveCollectionResourceKey(descriptor, user));
        expect(new Set(keys).size).toBe(3);
        expect(resolveCollectionResourceKey(descriptor, 'alice')).toBe(keys[1]);
    });

    it('有版本的歌单保持原来的资源身份', () => {
        const descriptor = playlist({ updatedAt: 1000 });
        expect(resolveCollectionResourceKey(descriptor)).toBe(resolveCollectionResourceKey(descriptor, 'alice'));
        expect(resolveCollectionResourceKey(descriptor, 'bob')).toBe(resolveCollectionResourceKey(descriptor, 'alice'));
    });

    it('云盘集合即使有版本也继续按账号隔离', () => {
        const descriptor = playlist({ type: 'cloud', id: 'cloud', updatedAt: 1000 });
        expect(resolveCollectionResourceKey(descriptor, 'alice')).not.toBe(resolveCollectionResourceKey(descriptor, 'bob'));
    });
});
