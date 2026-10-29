import type { StatusMessage } from '../../types';
import type { OnlineFailureCaseId } from '../../types/onlineMusic';
import type {
    PlaybackFailure,
    PlaybackFailureAction,
    PlaybackFailureContext,
    PlaybackFailureMessageKey,
    PlaybackFailurePolicy,
    PlaybackFailureReason,
} from '../../types/playbackFailure';

// src/services/playbackRecovery/playbackFailurePolicy.ts
// 播放失败的集中策略表：每个原因对应的文案、是否停播、是否倒计时跳歌、给哪些按钮、是否静默重试、是否冷却。
//
// 一律「出错就自动下一首」：倒计时期间不停播，倒计时自带「跳过 / 取消」；连跳次数用尽
// （见 maxAutoSkips 与 usePlaybackQueueController 的 MAX_UNAVAILABLE_AUTO_SKIP_COUNT）
// 或没有下一首可播时，才落到停播 + 一条普通消息。
//
// 以前只有「就是这一首放不出来」的原因才跳，没登录、登录过期、断网这类整条链路的事停在
// 原地带一句消息 —— 在手机上是灾难：人是把 App 丢在后台听的，停在那儿就是「放着放着没声
// 了」，回到前台才看见一行字。现在全部跳：至少下一首可能是本地文件、也可能是另一个平台，
// 值得一试；真的一首都放不出来时，连跳预算会把它停下来。
//
// 代价靠 maxAutoSkips 收敛：整条链路的原因跳一两首就够（再跳多半还是同一个平台），
// 单曲的原因才给足预算。
//
// 上游后来加了一个「无法播放时自动跳过」开关，只覆盖受限类与原因不明的失败。fork 的表格
// 比它更彻底（所有原因本来就跳），所以那个开关不接进设置；下面的 options 仍按上游的形状
// 留着，传进来也不会改变结果。

const NO_RETRY: readonly number[] = [];

/** 出错后自动跳下一首的倒计时文案（与本地 / 转码那条旧路径同一条）。 */
const AUTO_SKIP_COUNTDOWN_KEY = 'status.playbackErrorPrompt';

/**
 * 整条链路都放不了的原因：跳一两首碰碰运气（下一首可能是本地文件或别的平台），
 * 再往后基本是重复同一个失败，不如停下来把话说清楚。
 */
const PLATFORM_WIDE_SKIP_BUDGET = 1;

/** 解析策略时的用户设置；由调用方在解析那一刻读出传入，本模块不读 store。 */
export interface PlaybackFailurePolicyOptions {
    /** 「无法播放时自动跳过」：受限类与原因不明的失败也倒计时跳歌。fork 一律跳过，这一项不会改变结果。 */
    autoSkipUnplayable?: boolean;
}

/** 「无法播放时自动跳过」打开时倒计时用的文案；不说原因，只说放不了、几秒后跳过。 */
export const UNPLAYABLE_SKIP_PROMPT_KEY = 'status.songUnplayableSkipPrompt' as const;

// 「无法播放时自动跳过」覆盖的原因：受限类（会员、购买、权限、试听、地区）与原因不明的失败。
// 登录类和网络类不在其中：登录或网络恢复后这首歌就能放，自动跳走反而让用户错过它。
const UNPLAYABLE_AUTO_SKIP_REASONS: ReadonlySet<PlaybackFailureReason> = new Set<PlaybackFailureReason>([
    'membership-required', 'purchase-required', 'entitlement-required', 'preview-only', 'region-restricted',
    'invalid-response', 'unknown',
]);

// 原因不明但后端说登录可能有用（文案会提示登录）时，按登录类处理：不跳。
const isUnplayableAutoSkipCandidate = (failure: PlaybackFailure): boolean => (
    UNPLAYABLE_AUTO_SKIP_REASONS.has(failure.reason)
    && !(failure.reason === 'unknown' && failure.hint === 'sign-in-may-help')
);
// 停播、只给“跳过”：账号、权限、试听、地区这类重试也不会变好的原因。
// 一律倒计时跳歌；`maxAutoSkips` 收紧那些换了哪首都一样的原因。
const stopWithSkip = (
    messageKey: PlaybackFailureMessageKey,
    options: { autoSkipCountdown?: boolean; maxAutoSkips?: number } = {},
): PlaybackFailurePolicy => {
    const autoSkipCountdown = options.autoSkipCountdown !== false;
    return {
        messageKey,
        ...(autoSkipCountdown ? { countdownKey: AUTO_SKIP_COUNTDOWN_KEY } : {}),
        stopPlayback: true,
        autoSkip: autoSkipCountdown ? 'countdown' : 'none',
        actions: ['skip'],
        autoRetryDelaysMs: NO_RETRY,
        cooldown: null,
        offerReplacement: false,
        ...(typeof options.maxAutoSkips === 'number' ? { maxAutoSkips: options.maxAutoSkips } : {}),
    };
};

// 停播、给“重试 / 跳过”：可能是暂时的，或证据不足的原因。
// 同样一律倒计时跳歌：界面在后台时没人会去点「重试」，停在原地带一句消息等于静音。
// 网络、超时这些还会先静默重试（autoRetryDelaysMs），重试成功了就不跳。
const stopWithRetry = (
    messageKey: PlaybackFailureMessageKey,
    overrides: Partial<Pick<PlaybackFailurePolicy, 'autoRetryDelaysMs' | 'cooldown' | 'maxAutoSkips'>> & { autoSkipCountdown?: boolean } = {},
): PlaybackFailurePolicy => {
    const { autoSkipCountdown = true, ...rest } = overrides;
    return {
        messageKey,
        ...(autoSkipCountdown ? { countdownKey: AUTO_SKIP_COUNTDOWN_KEY } : {}),
        stopPlayback: true,
        autoSkip: autoSkipCountdown ? 'countdown' : 'none',
        actions: ['retry', 'skip'],
        autoRetryDelaysMs: NO_RETRY,
        cooldown: null,
        offerReplacement: false,
        ...rest,
    };
};

/** 每个原因的基础策略；用 Record 穷举，漏掉任何原因 tsc 都会报错。随 failure 变化的变体在 resolvePlaybackFailurePolicy 里解析。 */
export const PLAYBACK_FAILURE_POLICY: Readonly<Record<PlaybackFailureReason, PlaybackFailurePolicy>> = {
    // 未登录 / 登录过期：这一首肯定放不了，但下一首也许是本地文件或另一个平台，值得一试；
    // 只是预算给到 1 —— 一个平台没登录时，同一个平台的歌连着来十首也一样放不了。
    'not-signed-in': stopWithSkip('status.songLoginRequired', { maxAutoSkips: PLATFORM_WIDE_SKIP_BUDGET }),
    'session-expired': stopWithSkip('status.loginExpired', { maxAutoSkips: PLATFORM_WIDE_SKIP_BUDGET }),
    'membership-required': stopWithSkip('status.songMembershipRequired'),
    'purchase-required': stopWithSkip('status.songPurchaseRequired'),
    'entitlement-required': stopWithSkip('status.songEntitlementRequired'),
    'preview-only': stopWithSkip('status.songPreviewOnly'),
    'region-restricted': stopWithSkip('status.songRegionRestricted'),
    // 倒计时期间不暂停；倒计时自带“跳过 / 取消”，次数用尽后只留一条消息。
    'taken-down': {
        messageKey: 'status.songUnavailable',
        countdownKey: 'status.songUnavailablePrompt',
        stopPlayback: false,
        autoSkip: 'countdown',
        actions: [],
        autoRetryDelaysMs: NO_RETRY,
        cooldown: null,
        offerReplacement: true,
    },
    network: stopWithRetry('status.songNetworkFailed', { autoRetryDelaysMs: [1000, 3000], maxAutoSkips: PLATFORM_WIDE_SKIP_BUDGET }),
    timeout: stopWithRetry('status.songRequestTimedOut', { autoRetryDelaysMs: [2000], maxAutoSkips: PLATFORM_WIDE_SKIP_BUDGET }),
    'service-unavailable': stopWithRetry('status.songServiceUnavailable', { cooldown: 'retry-after', maxAutoSkips: PLATFORM_WIDE_SKIP_BUDGET }),
    'rate-limited': stopWithRetry('status.songRateLimitedNoWait', { cooldown: 'retry-after', maxAutoSkips: PLATFORM_WIDE_SKIP_BUDGET }),
    // 响应不对 / 说不清为什么（含媒体元素解码失败、源不支持）：重试过一次还是不行，
    // 基本就是这一首的问题，交给倒计时跳下一首。
    'invalid-response': stopWithRetry('status.songTemporarilyUnavailable'),
    unknown: stopWithRetry('status.songTemporarilyUnavailable'),
};

/** 文案及其变体：限流带等待秒数、服务未配置、证据不足但登录可能有用或后端认出了「可能」原因。 */
export const getPlaybackFailureMessage = (
    failure: PlaybackFailure,
): { key: PlaybackFailureMessageKey; params?: { seconds: number } } => {
    /*
     * 登录相关的两条优先用带平台名的版本。
     *
     * 手机上一首歌可能来自任意一个平台，「登录已失效，请重新登录」不点名的话，用户
     * 只能挨个平台试。providerId 有就带上（{{provider}} 由展示层补成平台显示名）。
     */
    if (failure.providerId && failure.reason === 'session-expired') {
        return { key: 'status.providerLoginExpired' };
    }
    if (failure.providerId && failure.reason === 'not-signed-in') {
        return { key: 'status.songLoginRequiredForProvider' };
    }
    switch (failure.reason) {
        case 'rate-limited':
            if (typeof failure.retryAfterMs === 'number' && failure.retryAfterMs > 0) {
                return { key: 'status.songRateLimited', params: { seconds: Math.max(1, Math.ceil(failure.retryAfterMs / 1000)) } };
            }
            return { key: 'status.songRateLimitedNoWait' };
        case 'service-unavailable':
            return { key: failure.transient === false ? 'status.songServiceNotConfigured' : 'status.songServiceUnavailable' };
        case 'unknown':
            // 「可能」原因只换一句带「可能」的话，原因与策略仍是 unknown（证据不足，保留重试）。
            switch (failure.hint) {
                case 'sign-in-may-help': return { key: 'status.songTemporarilyUnavailableSignInHint' };
                case 'maybe-membership': return { key: 'status.songTemporarilyUnavailableMaybeMembership' };
                case 'maybe-region-restricted': return { key: 'status.songTemporarilyUnavailableMaybeRegion' };
                default: return { key: 'status.songTemporarilyUnavailable' };
            }
        default:
            return { key: PLAYBACK_FAILURE_POLICY[failure.reason].messageKey };
    }
};

/**
 * 解析一次失败在给定上下文下的最终策略：先套变体（文案、未配置时去掉重试），再套上下文覆盖。
 * 'restore' 只显示一条消息，不倒计时也不给按钮；'mid-playback' 与 'play' 相同（停播时由 presenter 置 PAUSED）。
 * 用户设置 autoSkipUnplayable 在上下文覆盖之前套用（所以 restore 仍不跳），只加上倒计时：stopPlayback 与 actions
 * 保持该原因原本的值，连跳次数用尽或用户取消倒计时时 presenter 退回它们。
 */
export const resolvePlaybackFailurePolicy = (
    failure: PlaybackFailure,
    context: PlaybackFailureContext,
    options: PlaybackFailurePolicyOptions = {},
): PlaybackFailurePolicy => {
    const base = PLAYBACK_FAILURE_POLICY[failure.reason];
    const message = getPlaybackFailureMessage(failure);
    let policy: PlaybackFailurePolicy = {
        ...base,
        messageKey: message.key,
        ...(message.params ? { messageParams: message.params } : {}),
    };

    // 未配置 / 需要桌面版：重试不会变好，只留“跳过”。歌照样跳 —— 下一首可能是别的平台，
    // 而停在原地只有一个没在响的播放器。
    if (failure.reason === 'service-unavailable' && failure.transient === false) {
        policy = { ...policy, actions: ['skip'] };
    }

    if (options.autoSkipUnplayable && policy.autoSkip === 'none' && isUnplayableAutoSkipCandidate(failure)) {
        policy = { ...policy, autoSkip: 'countdown', countdownKey: UNPLAYABLE_SKIP_PROMPT_KEY };
    }

    if (context === 'restore') {
        policy = { ...policy, autoSkip: 'none', actions: [] };
        delete policy.countdownKey;
    }

    return policy;
};

/**
 * 这次失败按策略是否倒计时跳歌（不看连跳次数和有没有下一首）。presenter 用同一个判断决定倒计时，
 * 队列控制器用它决定「跳过」是否累计连跳次数：只有走倒计时的原因才累计，否则受限类在设置打开时会无限连跳。
 */
/**
 * 两套失败分类之间的桥：这套策略表按 PlaybackFailureReason 分（界面文案、倒计时、按钮都挂在它上面），
 * 而 host 往扩展层（Folium 的 playback.failed）报的是上游那套 OnlineFailureCaseId。
 * 只用于报告，不参与策略判定 —— 上面对不上号的都归 'unknown'。
 */
const FAILURE_REASON_TO_CASE: Readonly<Record<PlaybackFailureReason, OnlineFailureCaseId>> = {
    'not-signed-in': 'sign-in-needed',
    'session-expired': 'sign-in-needed',
    'membership-required': 'subscription-required',
    'purchase-required': 'purchase-required',
    'entitlement-required': 'entitlement-required',
    'preview-only': 'preview-only',
    'region-restricted': 'region-restricted',
    'taken-down': 'taken-down',
    network: 'unreachable',
    timeout: 'retry-later',
    'service-unavailable': 'retry-later',
    'rate-limited': 'retry-later',
    'invalid-response': 'unknown',
    unknown: 'unknown',
};

/** 报告给扩展层时用的情况代号。 */
export const toOnlineFailureCaseId = (reason: PlaybackFailureReason): OnlineFailureCaseId => (
    FAILURE_REASON_TO_CASE[reason] ?? 'unknown'
);

export const isAutoSkipFailure = (
    failure: PlaybackFailure,
    context: PlaybackFailureContext,
    options: PlaybackFailurePolicyOptions = {},
): boolean => resolvePlaybackFailurePolicy(failure, context, options).autoSkip === 'countdown';

export const PLAYBACK_RETRYING_MESSAGE_KEY = 'status.songRetrying';

// 用对象字面量登记全部文案 key：漏掉 PlaybackFailureMessageKey 的任何成员 tsc 都会报错。
const MESSAGE_KEY_REGISTRY: Record<PlaybackFailureMessageKey, true> = {
    'status.songLoginRequired': true,
    'status.loginExpired': true,
    'status.songLoginRequiredForProvider': true,
    'status.providerLoginExpired': true,
    'status.songMembershipRequired': true,
    'status.songPurchaseRequired': true,
    'status.songEntitlementRequired': true,
    'status.songPreviewOnly': true,
    'status.songRegionRestricted': true,
    'status.songUnavailable': true,
    'status.songNetworkFailed': true,
    'status.songRequestTimedOut': true,
    'status.songServiceUnavailable': true,
    'status.songServiceNotConfigured': true,
    'status.songRateLimited': true,
    'status.songRateLimitedNoWait': true,
    'status.songTemporarilyUnavailable': true,
    'status.songTemporarilyUnavailableSignInHint': true,
    'status.songTemporarilyUnavailableMaybeMembership': true,
    'status.songTemporarilyUnavailableMaybeRegion': true,
};

/**
 * 只有这两条文案需要 {{provider}}。
 *
 * 平台名只对「登录」那两条有意义 —— 别的文案塞进去只是噪音（i18next 会静默忽略，
 * 但会让文案参数看起来莫名其妙，测试也会跟着乱）。
 */
const PROVIDER_LABEL_MESSAGE_KEYS: ReadonlySet<PlaybackFailureMessageKey> = new Set<PlaybackFailureMessageKey>([
    'status.songLoginRequiredForProvider',
    'status.providerLoginExpired',
]);

/** 需要平台名的文案才补上 {{provider}}；其余原样返回策略自己的参数。 */
export const withProviderLabel = (
    message: { key: PlaybackFailureMessageKey; params?: { seconds: number } },
    providerLabel: string | undefined,
): Record<string, unknown> | undefined => {
    if (!providerLabel || !PROVIDER_LABEL_MESSAGE_KEYS.has(message.key)) return message.params;
    return { provider: providerLabel, ...(message.params ?? {}) };
};

/** 全部 messageKey（含变体）、倒计时 key 和重试中提示；供文案覆盖测试使用。 */
export const PLAYBACK_FAILURE_MESSAGE_KEYS: readonly string[] = Array.from(new Set<string>([
    ...Object.keys(MESSAGE_KEY_REGISTRY),
    ...Object.values(PLAYBACK_FAILURE_POLICY).flatMap(policy => (policy.countdownKey ? [policy.countdownKey] : [])),
    UNPLAYABLE_SKIP_PROMPT_KEY,
    PLAYBACK_RETRYING_MESSAGE_KEY,
]));

export const PLAYBACK_FAILURE_ACTION_LABEL_KEYS = ['ui.retry', 'status.skipUnavailableAction', 'status.cancel'] as const;

const ACTION_LABEL_KEY: Record<PlaybackFailureAction, string> = {
    retry: 'ui.retry',
    skip: 'status.skipUnavailableAction',
};

// 本模块发出的常驻失败消息。“重试 / 跳过”两个按钮占满了消息，没有单独的关闭按钮，
// transport 和 audio bridge 的 autoplay 在播放真正恢复时据此收起它；倒计时等其他常驻消息不在其中，不受影响。
const PLAYBACK_FAILURE_STATUSES = new WeakSet<StatusMessage>();

/** 这条消息是不是 buildPlaybackFailureStatus 发出的常驻失败消息。 */
export const isPlaybackFailureStatus = (message: StatusMessage | null | undefined): boolean => (
    Boolean(message && PLAYBACK_FAILURE_STATUSES.has(message))
);

/**
 * 策略 + 插值 → 最终文案。
 *
 * 状态消息与后台气泡共用这一句：两处各拼一次的话，用户在气泡里看到的和回前台看到的
 * 迟早会不一样。
 */
export const buildPlaybackFailureMessageText = (
    policy: PlaybackFailurePolicy,
    t: (key: string, options?: Record<string, unknown>) => string,
    /** 额外插值（目前只有 {{provider}}：平台显示名）。策略自己带的 params 优先。 */
    extraParams?: Record<string, unknown>,
): string => {
    const params = { ...(extraParams ?? {}), ...(policy.messageParams ?? {}) };
    return Object.keys(params).length > 0 ? t(policy.messageKey, params) : t(policy.messageKey);
};

/**
 * 把策略变成一条状态消息：先过滤掉没有 handler 的按钮；有按钮时第一个是主按钮，
 * 第二个是副按钮（没有就用“取消”关闭消息），消息常驻；没有按钮时是一条普通错误消息。
 */
export const buildPlaybackFailureStatus = (
    policy: PlaybackFailurePolicy,
    t: (key: string, options?: Record<string, unknown>) => string,
    handlers: { retry?: () => void; skip?: () => void; dismiss: () => void },
    /** 额外插值（目前只有 {{provider}}：平台显示名）。策略自己带的 params 优先。 */
    extraParams?: Record<string, unknown>,
): StatusMessage => {
    const text = buildPlaybackFailureMessageText(policy, t, extraParams);
    const actions = policy.actions.filter(action => Boolean(handlers[action]));
    if (actions.length === 0) return { type: 'error', text };

    const [primary, secondary] = actions;
    const status: StatusMessage = {
        type: 'error',
        text,
        persistent: true,
        actionLabel: t(ACTION_LABEL_KEY[primary]),
        onAction: handlers[primary],
        cancelLabel: secondary ? t(ACTION_LABEL_KEY[secondary]) : t('status.cancel'),
        onCancel: secondary ? handlers[secondary] : handlers.dismiss,
    };
    PLAYBACK_FAILURE_STATUSES.add(status);
    return status;
};

/** loader 自动重试之间的等待；用 globalThis.setTimeout，Node 测试环境和浏览器都能用。 */
export const sleepForPlaybackRetry = (ms: number): Promise<void> => new Promise(resolve => {
    globalThis.setTimeout(resolve, ms);
});
