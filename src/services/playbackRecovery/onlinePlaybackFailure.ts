import { OnlineProviderError, type OnlineProviderId, type ProviderErrorCode } from '../../types/onlineMusic';
import { noteAuthFailureIfAny } from '../onlineMusic/authExpiry';
import type { PlaybackFailure, PlaybackFailureHint, PlaybackFailureReason, PlaybackFailureStage } from '../../types/playbackFailure';

// src/services/playbackRecovery/onlinePlaybackFailure.ts
// 把一次播放请求的失败（OmniError、普通异常、空 URL、媒体元素错误）归一成 PlaybackFailure。
// 纯函数：不读 store、不写缓存。只有 code 为 'taken-down' 才可能得到 taken-down。

export interface PlaybackFailureClassifyContext {
    stage: PlaybackFailureStage;
    providerId?: OnlineProviderId;
    /** 请求发出之前的账号快照（useOnlineProviderAccountStore.accounts[providerId]）；鉴权失败后 transport 可能已清理会话，事后读会失真。 */
    account?: { status?: 'unknown' | 'authenticated' | 'anonymous' | 'error'; error?: string };
}

const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

const FETCH_FAILURE_MESSAGE = /Failed to fetch|NetworkError|Load failed|fetch failed/i;

const RATE_LIMIT_CARRIER_CODES: ReadonlySet<ProviderErrorCode> = new Set<ProviderErrorCode>(['network', 'service-unavailable', 'unavailable']);

// 去掉值为 undefined 的字段，让诊断对象只留下真实存在的证据。
const compact = <T extends object>(value: T): T => (
    Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
);

// auth-required 的拆分：adapter 给出的 details.auth 优先；否则看请求前的账号快照，
// 曾经持有会话（authenticated / error，或上次就是鉴权失败）才算“已失效”，其余一律按“未登录”。
const resolveAuthReason = (
    error: OnlineProviderError,
    account: PlaybackFailureClassifyContext['account'],
): PlaybackFailureReason => {
    if (error.details?.auth === 'signed-out') return 'not-signed-in';
    if (error.details?.auth === 'expired') return 'session-expired';
    if (account?.status === 'authenticated' || account?.status === 'error' || account?.error === 'auth-required') {
        return 'session-expired';
    }
    return 'not-signed-in';
};

/**
 * 「只有试听片段」要不要报成登录问题。
 *
 * **默认是不报** —— 试听本身不是登录态的证据。给试听的原因绝大多数是版权 / 会员：
 * 这个账号对这首曲子没有完整播放权，登不登录都一样。曾经按「账号快照 + signInMayHelp」
 * 反推过登录态，结果刚刚登录完的账号拿到一首要会员的歌，被判成 session-expired，
 * 上层顺手把账号清掉 —— 用户看到的是「刚登录就被踢下线」，而凭据一直是好的。
 *
 * 而且这么推也推不准：账号快照是缓存的，cookie 真过期时它照样写着 authenticated，
 * 拿它当判据两个方向都是错的。
 *
 * 真正该报登录问题的只有两种情况，都是**证据**而不是推断：
 *
 * · 适配器自己明说了登录态（details.auth）；
 * · 这个平台上一次就已经被判定过鉴权失效（account.error === 'auth-required'）——
 *   此时账号早就清过了，这里只是让提示说到点子上，不会再把人踢一次。
 */
const resolvePreviewOnlyReason = (
    error: OnlineProviderError,
    account: PlaybackFailureClassifyContext['account'],
): PlaybackFailureReason => {
    if (error.details?.auth === 'signed-out') return 'not-signed-in';
    if (error.details?.auth === 'expired') return 'session-expired';
    if (account?.error === 'auth-required') return 'session-expired';
    return 'preview-only';
};

// network code 的细分：带 upstreamCode 说明上游有应答（业务拒绝），其余按 HTTP 状态区分。
const resolveNetworkReason = (error: OnlineProviderError): PlaybackFailureReason => {
    if (error.details?.upstreamCode !== undefined) return 'unknown';
    const status = error.httpStatus;
    if (status === 504) return 'timeout';
    if (typeof status === 'number' && status >= 500) return 'service-unavailable';
    if (typeof status === 'number' && status >= 400 && status < 500) return 'invalid-response';
    return 'network';
};

const isRateLimitedProviderError = (error: OnlineProviderError): boolean => (
    error.code === 'rate-limited'
    || (RATE_LIMIT_CARRIER_CODES.has(error.code)
        && (error.httpStatus === 429 || (typeof error.retryAfterMs === 'number' && error.retryAfterMs > 0)))
);

// 把 OmniError 的 code（加上 HTTP 状态与账号快照）映射到播放失败原因；switch 穷举 ProviderErrorCode。
const resolveProviderErrorReason = (
    error: OnlineProviderError,
    account: PlaybackFailureClassifyContext['account'],
): PlaybackFailureReason => {
    if (isRateLimitedProviderError(error)) return 'rate-limited';

    const code: ProviderErrorCode = error.code;
    switch (code) {
        case 'auth-required':
            return resolveAuthReason(error, account);
        case 'network':
            return resolveNetworkReason(error);
        case 'timeout':
            return 'timeout';
        case 'unavailable':
        case 'service-unavailable':
            return 'service-unavailable';
        case 'invalid-response':
            return 'invalid-response';
        case 'rate-limited':
            return 'rate-limited';
        case 'preview-only':
            return resolvePreviewOnlyReason(error, account);
        case 'region-restricted':
        // 上游新分的「要订阅」：与「要会员」是同一件事，界面给的也是同一句（去开通）。
        case 'subscription-required':
            return 'membership-required';
        case 'membership-required':
        case 'purchase-required':
        case 'entitlement-required':
        case 'taken-down':
            return code;
        case 'not-playable':
        case 'unsupported':
        case 'not-public':
            return 'unknown';
        // 用户名或密码不对（飞牛登录抛的）。这个 code 本来属于登录链路，播放请求撞上它说明
        // 会话压根没建立起来 —— 按「未登录」处理，不要归到「登录态过期」：后者会引导用户
        // 重新登录，而这里重新登录只会再错一次，真正要的是修正账号密码。
        case 'invalid-credentials':
        // 需要先在网页里登录（飞牛的云连接）。同属「这次请求没有身份」：引导去登录窗口。
        case 'web-login-required':
            return 'not-signed-in';
        default: {
            const exhaustive: never = code;
            return exhaustive;
        }
    }
};

// 证据不足时的补充说法。登录可能有用只在没有会话时出现，可能原因只在带会话时出现，两者不会同时给；万一同时给，先说登录。
const resolveFailureHint = (details: OnlineProviderError['details']): PlaybackFailureHint | undefined => {
    if (details?.signInMayHelp) return 'sign-in-may-help';
    if (details?.likelyCause === 'membership') return 'maybe-membership';
    if (details?.likelyCause === 'region') return 'maybe-region-restricted';
    return undefined;
};

const isTimeoutDomException = (error: unknown): boolean => (
    typeof DOMException !== 'undefined'
    && error instanceof DOMException
    && error.name === 'TimeoutError'
);

/** 把一次音源请求抛出的异常归一成 PlaybackFailure；按顺序匹配，先命中先返回。 */
export const classifyPlaybackError = (error: unknown, ctx: PlaybackFailureClassifyContext): PlaybackFailure => {
    if (error instanceof OnlineProviderError) {
        const details = error.details;
        return compact<PlaybackFailure>({
            reason: resolveProviderErrorReason(error, ctx.account),
            stage: ctx.stage,
            providerId: error.providerId ?? ctx.providerId,
            providerCode: error.code,
            providerStage: details?.stage,
            upstreamCode: details?.upstreamCode,
            httpStatus: error.httpStatus,
            retryAfterMs: error.retryAfterMs,
            transient: details?.transient,
            hint: resolveFailureHint(details),
            attempts: details?.attempts,
            message: error.message,
            cause: error,
        });
    }

    if (isTimeoutDomException(error)) {
        return compact<PlaybackFailure>({
            reason: 'timeout',
            stage: ctx.stage,
            providerId: ctx.providerId,
            message: (error as DOMException).message,
            cause: error,
        });
    }

    if (error instanceof TypeError && FETCH_FAILURE_MESSAGE.test(error.message)) {
        return compact<PlaybackFailure>({
            reason: 'network',
            stage: ctx.stage,
            providerId: ctx.providerId,
            message: error.message,
            cause: error,
        });
    }

    return compact<PlaybackFailure>({
        reason: 'unknown',
        stage: ctx.stage,
        providerId: ctx.providerId,
        message: error instanceof Error ? error.message : (typeof error === 'string' ? error : undefined),
        cause: error,
    });
};

/** provider 没抛错却没给出可用 URL：空值证据不足（unknown），给了但不安全的 URL 是形态错误（invalid-response）。 */
export const classifyMissingAudioUrl = (
    rawUrl: string | null | undefined,
    ctx: PlaybackFailureClassifyContext,
): PlaybackFailure => {
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
        return compact<PlaybackFailure>({
            reason: 'unknown',
            stage: ctx.stage,
            providerId: ctx.providerId,
            providerStage: 'no-source',
        });
    }
    return compact<PlaybackFailure>({
        reason: 'invalid-response',
        stage: ctx.stage,
        providerId: ctx.providerId,
    });
};

/**
 * 媒体元素的错误码：1（aborted）返回 null 表示不处理；2 是网络；3 / 4（解码 / 格式）以及其他都证据不足。
 * 3 / 4 只有在刷新 URL 后仍失败时才会走到这里。
 */
export const classifyMediaPlaybackFailure = (
    mediaErrorCode: number | null,
    ctx: { providerId?: OnlineProviderId },
): PlaybackFailure | null => {
    if (mediaErrorCode === MEDIA_ERR_ABORTED) return null;
    const isDecodeOrFormat = mediaErrorCode === MEDIA_ERR_DECODE || mediaErrorCode === MEDIA_ERR_SRC_NOT_SUPPORTED;
    return compact<PlaybackFailure>({
        reason: mediaErrorCode === MEDIA_ERR_NETWORK ? 'network' : 'unknown',
        stage: 'media-element',
        providerId: ctx.providerId,
        mediaErrorCode: isDecodeOrFormat ? mediaErrorCode : undefined,
    });
};

/** 暂时性失败：等一会儿或换个网络可能就好，不该跳歌。 */
export const isTransientPlaybackFailure = (failure: PlaybackFailure): boolean => (
    failure.reason === 'network'
    || failure.reason === 'timeout'
    || failure.reason === 'service-unavailable'
    || failure.reason === 'rate-limited'
);
