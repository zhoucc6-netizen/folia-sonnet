import { OnlineProviderError, type OnlineProviderId } from '../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';

// src/services/onlineMusic/authExpiry.ts
// 「某个平台的登录态不行了」这件事的唯一记录入口。
//
// 为什么要单独抽一层：原本只有**库刷新**那条路会把鉴权失效记下来 ——
// useBodianLibrary / useFeiniuLibrary / useQqLibrary / useKugouLibrary 各自判断一次
// `auth-required` 再 clearAccount。而**播放**和**搜索**撞到同一件事时什么都不做，
// 只往控制台打一条 warn：用户看到的是「这首歌只能试听」或者「搜索没结果」，
// 从头到尾没有人告诉他 cookie 过期了 —— 于是他以为 App 坏了，或者以为本来就该是试听。
//
// 这里把它收成一处：任何路径撞到 auth-required 都调一下，账号状态立刻变成
// error='auth-required'，首页的 needsRelogin 和账户面板那套「登录已过期」UI 是现成的，
// 不用为每条路径各写一遍提示。

/** 这次失败是不是「平台说登录态不行了」。只认 provider 归一化后的 auth-required。 */
export const isProviderAuthFailure = (error: unknown): boolean => (
    error instanceof OnlineProviderError && error.code === 'auth-required'
);

/**
 * 这个平台**曾经**持过会话吗。
 *
 * 决定该说「登录已过期」还是「未登录」：从来没登过的平台撞到 auth-required 是正常的
 * （游客就是看不了），把它标成过期会骗用户去重新登录一个他没登录过的账号。
 * 判据与 onlinePlaybackFailure 的 resolveAuthReason 保持一致。
 */
export const hasHeldProviderSession = (
    account?: { status?: 'unknown' | 'authenticated' | 'anonymous' | 'error'; error?: string },
): boolean => (
    account?.status === 'authenticated'
    || account?.status === 'error'
    || account?.error === 'auth-required'
);

/**
 * 记一次平台鉴权失效。
 *
 * 幂等：已经是这个状态就不重复写 —— 播放失败可能一秒来好几次，每次都写会让所有
 * 订阅它的组件反复重渲染，而状态本身没有任何变化。
 */
export const noteProviderAuthExpired = (providerId?: OnlineProviderId): void => {
    if (!providerId) return;
    const state = useOnlineProviderAccountStore.getState();
    const account = state.accounts[providerId];
    if (account?.error === 'auth-required') return;
    if (!hasHeldProviderSession(account)) return;
    state.clearAccount(providerId, 'auth-required');
};

/**
 * 从一次失败里取平台并记下鉴权失效。不是 auth-required 就什么都不做。
 *
 * providerId 的取法：错误自带的优先（transport 抛的时候一般都带了），
 * 没有才用调用方给的兜底 —— 调用方知道自己在请求哪个平台。
 */
export const noteAuthFailureIfAny = (
    error: unknown,
    fallbackProviderId?: OnlineProviderId,
): boolean => {
    if (!isProviderAuthFailure(error)) return false;
    const providerId = error instanceof OnlineProviderError
        ? (error.providerId ?? fallbackProviderId)
        : fallbackProviderId;
    noteProviderAuthExpired(providerId);
    return true;
};
