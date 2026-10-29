import type { AppView } from '../../../../stores/useAppViewStore';
import type { StageTrackPillMode } from '../NowPlayingToast';

// src/components/app/overlays/now-playing-toast/nowPlayingToastVisibility.ts
// Keeps the card and its next-track countdown on exactly the same set of app surfaces.
// The home page is opt-in (showOnHome), except when the library there is a wall like Lattice (bravais): the wall
// and Lattice are the same kind of surface, so the card is there as it is on Lattice (2026-10-10).

export const shouldShowNowPlayingToast = ({
    mode,
    view,
    showOnHome,
    homeIsWall = false,
}: {
    mode: StageTrackPillMode;
    view: AppView;
    showOnHome: boolean;
    /** The home page shows a wall library (bravais), which carries the card the way Lattice does. */
    homeIsWall?: boolean;
}) => mode !== 'never' && (
    view === 'player'
    || view === 'lattice'
    || (view === 'home' && (showOnHome || homeIsWall))
);

/**
 * 播放页把界面收起来时这张卡片跟着收（点空白那一族手势，见 App 的 handleVisualSurfaceClick）。
 *
 * 判据是显式传进来的 `view`，**不是** `useIsPlayerBottomBarHost()`：那个 Provider 只包住
 * `VisualizerRenderer`，而这张卡片挂在 AppOverlays 里 —— 是可视化层的**兄弟节点**，在这里读
 * context 永远拿到默认的 false，卡片就永远不隐藏（这个 bug 出过一次）。
 * 字幕层（VisualizerSubtitleOverlay）确实长在那棵 Provider 里面，所以那边用它是对的。
 *
 * 「自动隐藏控制栏」那一档不算：那一档里「藏着」是常态，跟着收等于卡片再也不出现。
 */
export const isNowPlayingToastHiddenWithChrome = ({
    view,
    isPlayerChromeHidden,
    autoHidePlayerChrome,
    hdrProjectionActive = false,
}: {
    view: AppView;
    isPlayerChromeHidden: boolean;
    autoHidePlayerChrome: boolean;
    /**
     * HDR 投影开着：整屏只留画面，这张卡片也跟着收 —— 它比上面那一族判据更硬，
     * 连「自动隐藏控制栏」那一档（那一档里它本来不跟着收）也一起收掉。
     */
    hdrProjectionActive?: boolean;
}) => hdrProjectionActive || (view === 'player' && isPlayerChromeHidden && !autoHidePlayerChrome);
