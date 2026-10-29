import type { ReplayGainInfo } from '../types';
import type { SkipPromptMessageKey } from './appPlayback';
import type { OnlineProviderId, ProviderErrorCode, ProviderPlaybackAttempt } from './onlineMusic';

// src/types/playbackFailure.ts
// 一次播放请求失败的跨层契约；与歌曲的静态可用性（ProviderSongAvailability）分开表达。

export type PlaybackFailureReason =
    | 'not-signed-in' | 'session-expired'
    | 'membership-required' | 'purchase-required' | 'entitlement-required'
    | 'preview-only' | 'region-restricted'
    | 'taken-down'
    | 'network' | 'timeout' | 'service-unavailable' | 'rate-limited'
    | 'invalid-response' | 'unknown';

export type PlaybackFailureHint = 'sign-in-may-help' | 'maybe-membership' | 'maybe-region-restricted';

export type PlaybackFailureStage =
    | 'static' | 'replacement' | 'cooldown' | 'resolve-url'
    | 'refresh' | 'restore' | 'media-element' | 'prefetch';

export interface PlaybackFailure {
    reason: PlaybackFailureReason;
    stage: PlaybackFailureStage;
    providerId?: OnlineProviderId;
    providerCode?: ProviderErrorCode;   // 诊断
    providerStage?: string;             // 诊断（details.stage）
    upstreamCode?: number | string;     // 诊断
    httpStatus?: number;
    retryAfterMs?: number;
    transient?: boolean;
    /** 证据不足时的补充说法：登录可能有用，或后端按实测特征认出的「可能」原因（只换文案，不改原因与策略）。 */
    hint?: PlaybackFailureHint;
    mediaErrorCode?: number;
    attempts?: readonly ProviderPlaybackAttempt[];
    message?: string;
    cause?: unknown;
}

export type PlaybackFailureContext = 'play' | 'restore' | 'mid-playback';
export type PlaybackFailureAction = 'retry' | 'skip';

export type PlaybackFailureMessageKey =
    | 'status.songLoginRequired' | 'status.loginExpired'
    // 与上两条同一件事，但带上平台名（{{provider}}）：同一句「登录已失效」不点名是哪个平台，
    // 用户根本不知道该去重新登录哪一个 —— cookie 过期时这条尤其重要。
    | 'status.songLoginRequiredForProvider' | 'status.providerLoginExpired'
    | 'status.songMembershipRequired' | 'status.songPurchaseRequired' | 'status.songEntitlementRequired'
    | 'status.songPreviewOnly' | 'status.songRegionRestricted' | 'status.songUnavailable'
    | 'status.songNetworkFailed' | 'status.songRequestTimedOut'
    | 'status.songServiceUnavailable' | 'status.songServiceNotConfigured'
    | 'status.songRateLimited' | 'status.songRateLimitedNoWait'
    | 'status.songTemporarilyUnavailable' | 'status.songTemporarilyUnavailableSignInHint'
    | 'status.songTemporarilyUnavailableMaybeMembership' | 'status.songTemporarilyUnavailableMaybeRegion';

export interface PlaybackFailurePolicy {
    messageKey: PlaybackFailureMessageKey;
    messageParams?: { seconds: number };
    countdownKey?: SkipPromptMessageKey;     // 仅 autoSkip==='countdown'
    stopPlayback: boolean;                   // 暂停旧音频、shouldAutoPlay=false；play 置 IDLE，mid-playback 置 PAUSED
    autoSkip: 'countdown' | 'none';
    actions: readonly PlaybackFailureAction[]; // 'skip' 只在有下一首可播歌曲时渲染
    /**
     * 这个原因允许连着跳几首（不设就用队列控制器的默认上限）。
     *
     * 「整条链路都放不了」的原因（没登录、登录过期、断网、超时、限流、音源没配置）给一个
     * 很小的值：跳一两首多半还是同一个平台、同样的结果，真去把整个队列扫一遍只会让手机在
     * 后台一首接一首地空转。单曲的问题（试听、会员、地区、下架）才值得多试几首。
     */
    maxAutoSkips?: number;
    autoRetryDelaysMs: readonly number[];    // [] = 不自动重试
    cooldown: 'retry-after' | null;
    offerReplacement: boolean;
}

export type OnlineAudioSourceResult =
    | { kind: 'ok'; audioSrc: string; blobUrl?: string; replayGain?: ReplayGainInfo }
    | { kind: 'failed'; failure: PlaybackFailure };   // 原来的 'unavailable' 改名，避免暗示“下架”

export interface OnlineRecoveryOptions {
    failedSrc?: string | null;
    resumeAt?: number;
    autoplay: boolean;
    shouldAutoplay?: () => boolean;
    force?: boolean;             // 跳过按媒体文件去重（手动重试）
    bypassMediaCache?: boolean;  // 跳过媒体缓存 blob（缓存 blob 解码失败）
}

export type OnlineRecoveryResult =
    | { status: 'recovered' }
    | { status: 'stale' }          // 歌曲已切换或 audio 元素已不在：调用方什么都不做
    | { status: 'not-attempted' }  // 不适用，或这个媒体文件已经刷新过
    | { status: 'failed'; failure: PlaybackFailure };

export interface PlaybackFailureSkipOptions {
    failedSongKey?: string;   // getPlaybackSongKey(失败歌曲)，在 await 之前捕获
    failedGeneration?: number; // 出错时的播放代次（playbackGenerationRef），在 await 之前捕获；同一首歌重新点播落地后旧失败不再算当前
    retry?: () => void;
}

export type RestorePlaybackSourceOutcome = 'restored' | 'failed' | 'stale';

export type OmniPlaybackFailure = PlaybackFailure;
export type OmniPlaybackFailureReason = PlaybackFailureReason;
