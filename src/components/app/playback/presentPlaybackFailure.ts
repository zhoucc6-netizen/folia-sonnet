import { PlayerState, type SongResult, type StatusMessage } from '../../../types';
import type { SkipPromptMessageKey } from '../../../types/appPlayback';
import type { PlaybackFailure, PlaybackFailureContext } from '../../../types/playbackFailure';
import type { StatusSetter } from '../../../stores/useStatusMessageStore';
import {
    buildPlaybackFailureMessageText,
    buildPlaybackFailureStatus,
    resolvePlaybackFailurePolicy,
    toOnlineFailureCaseId,
} from '../../../services/playbackRecovery/playbackFailurePolicy';
import {
    isPlaybackInterfaceHidden,
    notifyBackgroundPlaybackNotice,
} from '../../../services/playbackRecovery/backgroundFailureNotice';
import { omni } from '../../../services/onlineMusic/omni';
import type { PlaybackFailedNotice } from '../../../services/hostExtensionHooks';

// src/components/app/playback/presentPlaybackFailure.ts
// 播放失败的展示层：按策略表决定倒计时跳歌、停播，还是给出带“重试 / 跳过”的常驻消息；倒计时被取消时退回该原因原本的停播与按钮。
// 只负责展示和停播，不决定原因；队列控制器在点歌失败和播放中失败时都交给这里。
//
// 界面没人看时（后台）走另一条路：不排倒计时，直接跳下一首，并把原因交给系统小气泡。
// 倒计时是 timer 驱动的，而 WebView 退到后台后 timer 会被节流甚至整页冻结 —— 一个“5 秒后
// 自动跳过”在后台可以变成“再也没跳过”，用户只感觉到 App 放着放着就哑了。
//
// 展示完（消息或倒计时已写入）后经 deps.notifyFailure 报告一次失败（Folium 的 playback.failed），陈旧请求不报。

export interface PlaybackFailurePresentation {
    failure: PlaybackFailure;
    /** 失败的那首歌：点歌时是请求的那首（不一定是正在显示的），播放中失败时是当前歌曲。只用于报告。 */
    song: SongResult | null;
    context: PlaybackFailureContext;      // 'play' | 'mid-playback'
    isCurrent: () => boolean;
    skipCount: number;
    retry?: () => void;
    skip?: () => void;                    // 没有下一首可播歌曲时为 undefined
}

export interface PlaybackFailurePresenterDeps {
    t: (key: string, options?: Record<string, unknown>) => string;
    setStatusMsg: StatusSetter;
    setPlayerState: (state: PlayerState) => void;
    audioRef: { current: { pause(): void } | null };
    shouldAutoPlayRef: { current: boolean };
    setIsLyricsLoading: (value: boolean) => void;
    /** 倒计时跳歌；onCancel 在用户点「取消」、倒计时收起之后调用。 */
    showTimedSkipPrompt: (key: SkipPromptMessageKey, onSkip: () => void, onCancel?: () => void) => void;
    maxAutoSkipCount: number;
    /** 报告一次用户看得到的失败（hostExtensionHooks.notifyPlaybackFailed）；在界面状态写完之后调用。 */
    notifyFailure: (notice: PlaybackFailedNotice) => void;
}

/** 按策略表展示一次失败：倒计时跳歌、停播提示或带按钮的持久消息。陈旧请求直接忽略。 */
export const presentPlaybackFailure = (input: PlaybackFailurePresentation, deps: PlaybackFailurePresenterDeps): void => {
    const { failure, song, context, isCurrent, skipCount, retry, skip } = input;
    // 报告用的是上游那套情况代号（扩展层只认它），策略与文案仍按这套原因走。
    const reportedReason = toOnlineFailureCaseId(failure.reason);
    if (!isCurrent()) return;

    const policy = resolvePlaybackFailurePolicy(failure, context);
    deps.setIsLyricsLoading(false);

    // 连跳预算：整条链路的原因（没登录、断网…）只给一两首，单曲的问题用控制器的默认上限。
    const maxAutoSkips = policy.maxAutoSkips ?? deps.maxAutoSkipCount;

    /*
     * 登录过期 / 未登录这类文案要带平台名（{{provider}}）。
     * 平台名在这层才能取：策略表是纯函数，拿不到运行时的 provider 注册表。
     */
    const needsProviderLabel = policy.messageKey === 'status.songLoginRequiredForProvider'
        || policy.messageKey === 'status.providerLoginExpired';
    const providerLabel = needsProviderLabel && failure.providerId
        ? omni.getProviderLabel(failure.providerId)
        : undefined;
    const extraParams = providerLabel ? { provider: providerLabel } : undefined;
    const messageText = buildPlaybackFailureMessageText(policy, deps.t, extraParams);
    const isHidden = isPlaybackInterfaceHidden();

    // 该原因原本的处理：按策略停播，再给出它自己的消息与按钮。不倒计时时直接走这里，倒计时被取消时也退回这里。
    // 平台名已经在上面取过了（后台气泡也要用同一句文案），这里复用同一份参数。
    const showReasonMessage = () => {
        if (policy.stopPlayback) {
            deps.shouldAutoPlayRef.current = false;
            deps.audioRef.current?.pause();
            deps.setPlayerState(context === 'mid-playback' ? PlayerState.PAUSED : PlayerState.IDLE);
        }

        // 按钮可能在用户切歌之后才被点：先确认仍是这次请求，再清掉消息、执行动作。
        // 陈旧时不执行动作，但仍收起这条常驻消息（只收起自己那条，期间换上的新消息不动），否则它关不掉。
        let built: StatusMessage | null = null;
        const wrap = (action?: () => void) => action && (() => {
            if (!isCurrent()) {
                deps.setStatusMsg(current => (current === built ? null : current));
                return;
            }
            deps.setStatusMsg(null);
            action();
        });

        built = buildPlaybackFailureStatus(policy, deps.t, {
            retry: wrap(retry),
            skip: wrap(skip),
            dismiss: () => deps.setStatusMsg(null),
        }, extraParams);
        deps.setStatusMsg(built);
    };

    // 能跳就跳（次数用尽或没有下一首可播时落到下面的停播 + 普通消息）。
    // 后台不排倒计时：timer 在后台靠不住，等满 5 秒往往等于永远不跳 —— 当场跳走，
    // 并用系统气泡说明原因，那是后台唯一看得见的东西。
    if (policy.autoSkip === 'countdown' && policy.countdownKey && skip && skipCount < maxAutoSkips) {
        if (isHidden) {
            notifyBackgroundPlaybackNotice(`${messageText} · ${deps.t('status.autoSkippedNext')}`);
            if (isCurrent()) skip();
            deps.notifyFailure({ song, reason: reportedReason, phase: context, willAutoSkip: true });
            return;
        }
        // 用户点「取消」就是这次不跳：退回该原因原本的停播与按钮，和倒计时没出现时一样。否则播放中失败会停在 PLAYING
        // （出错的 deck 的 pause 事件被忽略），「重试」这个唯一的强制刷新入口也没了。taken-down 原本既不停播也没有按钮，
        // 取消照旧只收起倒计时。取消后不再报告：倒计时出现时已经报过一次。
        const onCancel = policy.stopPlayback || policy.actions.length > 0
            ? () => { if (isCurrent()) showReasonMessage(); }
            : undefined;
        deps.showTimedSkipPrompt(policy.countdownKey, () => {
            if (isCurrent()) skip();
        }, onCancel);
        deps.notifyFailure({ song, reason: reportedReason, phase: context, willAutoSkip: true });
        return;
    }

    // 跳不动了：同样在后台补一句气泡，否则用户连「为什么没声了」都无从知道。
    if (isHidden) notifyBackgroundPlaybackNotice(messageText);

    showReasonMessage();
    deps.notifyFailure({ song, reason: reportedReason, phase: context, willAutoSkip: false });
};
