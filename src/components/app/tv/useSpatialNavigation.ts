import { useEffect } from 'react';
import { effectiveKeyCode, isSliderKey, isTextEntryTarget } from '../../../utils/keyboardTargets';
import { resolveDeviceType } from '../../../services/androidPhoneLayout';
import { useDeviceProfileStore } from '../../../stores/useDeviceProfileStore';

// src/components/app/tv/useSpatialNavigation.ts
// 电视上「方向键在可聚焦控件之间跳」的那一层。
//
// 为什么需要它：曲库的几个界面（bravais / grid / tui）自带方向键模型，它们操作自己的焦点下标，
// 按键盘就能走；但标签栏、设置页、弹窗、播放控制这一大片只有鼠标能点 —— 遥控器停在那里按什么
// 都没反应。这一层补的就是它们。
//
// 与已有模型的共存靠三件事，按优先级：
//   1. `event.defaultPrevented` —— 已经有人处理过的按键（bravais 的 move、滑杆的方向键、
//      菜单上下选条目）直接让出。React 的子组件 effect 先于父组件执行，所以这里的监听器
//      注册得更晚、在同一冒泡阶段里后跑，看得到别人的 preventDefault。
//   2. `isTextEntryTarget` / `isSliderKey` —— 焦点在输入框或滑杆上时不抢。
//   3. 只在电视态挂载（见 resolveDeviceType），手机、平板、桌面完全不受影响。
//
// 键位一律经 `effectiveKeyCode()`：安卓遥控器的按键在 WebView 里是合成的，`event.code` 可能是
// 空串，只剩 `event.key`（实测 Chromium 91 / `input keyevent` 都是这样）。

type Direction = 'up' | 'down' | 'left' | 'right';

const DIRECTION_BY_KEY: Record<string, Direction> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
};

/**
 * 可聚焦候选。**不包含** `[tabindex]` 以外的自定义容器：电视上真正能按的东西就是这些。
 * `tabindex="-1"` 的是「代码里可以 focus、但不是给用户停的」（仓库里大量用它做程序化聚焦）。
 */
const CANDIDATE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]:not([aria-disabled="true"])',
    '[role="tab"]',
    '[role="option"]',
    '[role="menuitem"]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 元素在不在「看得见、能点」的状态。零尺寸、隐藏、`aria-hidden` / `inert` 祖先都算不可达。 */
const isReachable = (element: HTMLElement): boolean => {
    if (element.hasAttribute('disabled') || element.getAttribute('aria-hidden') === 'true') return false;
    if (element.closest('[inert], [aria-hidden="true"]')) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
};

/**
 * 焦点候选的搜索范围：有弹窗就只在最上面那个弹窗里找。
 *
 * 两个选择器都认：`data-folia-keyboard-window="true"` 是本仓库接管键盘的窗口约定
 * （见 utils/keyboardTargets），`[aria-modal="true"]` 是首启引导那几个弹窗唯一的标记
 * （PlaybackEntryViewPrompt 这类没挂 data 属性的）。少认一个，弹窗里的按钮就又按不到了。
 */
const resolveScope = (): ParentNode => {
    const windows = document.querySelectorAll(
        '[data-folia-keyboard-window="true"], [aria-modal="true"]',
    );
    if (windows.length > 0) return windows[windows.length - 1] as HTMLElement;
    return document.body;
};

const collectCandidates = (scope: ParentNode): HTMLElement[] => (
    Array.from(scope.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)).filter(isReachable)
);

type Box = { cx: number; cy: number; width: number; height: number };

const boxOf = (element: Element): Box => {
    const r = element.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width, height: r.height };
};

/**
 * 在给定方向上找最近的一个候选。
 *
 * 打分的口径：主方向的距离 + 2 倍的垂直偏移。乘 2 是为了让「同一个方向、但更对齐」的元素赢过
 * 「斜着更近」的元素 —— 电视上一排放得很开的卡片，按下键应该进到正下方那张，不是斜对角那张。
 * 主方向距离必须严格为正，否则同一条线上会被选回自己。
 */
const pickNext = (
    from: Box,
    direction: Direction,
    candidates: HTMLElement[],
): HTMLElement | null => {
    let best: HTMLElement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const box = boxOf(candidate);
        let primary: number;
        let perpendicular: number;
        switch (direction) {
            case 'right':
                primary = box.cx - from.cx;
                perpendicular = box.cy - from.cy;
                break;
            case 'left':
                primary = from.cx - box.cx;
                perpendicular = box.cy - from.cy;
                break;
            case 'down':
                primary = box.cy - from.cy;
                perpendicular = box.cx - from.cx;
                break;
            default:
                primary = from.cy - box.cy;
                perpendicular = box.cx - from.cx;
                break;
        }
        // 2px 的容差：同一行的两个控件中心可能差不到 1px，严格大于会把它们判成「不在这个方向」。
        if (primary <= 2) continue;
        // 垂直偏移超过主方向距离的两倍就是「斜得太远」，宁可让按键落空（交给页面滚动），
        // 也不要跳到画面另一头去。
        if (Math.abs(perpendicular) > primary * 2) continue;
        const score = primary + Math.abs(perpendicular) * 2;
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }

    return best;
};

/** 当前没有焦点时的入口：按下键进第一项，按上/左键进最后一项。 */
const pickEntry = (direction: Direction, candidates: HTMLElement[]): HTMLElement | null => {
    if (candidates.length === 0) return null;
    return direction === 'down' || direction === 'right'
        ? candidates[0]
        : candidates[candidates.length - 1];
};

/**
 * 这一下方向键该不该归我们管。
 *
 * 曲库的几个界面在 window 上用**冒泡**阶段的监听无条件接管方向键（useBravaisKeyboard 那套），
 * 只要舞台可交互，方向键就全是它的，我们的监听根本轮不到 —— 实测弹窗开在曲库上面时，前四下
 * 方向键都被它吃掉，焦点一动不动。
 *
 * 所以这里定两条优先规则，只在其中一条成立时才接管：
 *   · 有弹窗开着：弹窗盖在最上面，方向键理应先服务它。仓库里各 suite 看到
 *     `data-folia-keyboard-window` 会让路，但首启那几个弹窗只挂了 aria-modal，它们不会让。
 *   · 已经有 DOM 焦点：用户已经在按钮之间走了，接下来的移动自然归我们。
 * 其余情况（没弹窗、焦点在 body）让给已有的模型，我们一个键都不碰。
 *
 * 接管时在捕获阶段直接 preventDefault：后面的冒泡监听看到 defaultPrevented 就会让路
 * （useBravaisKeyboard 第一行查的就是这个）。
 */
const shouldTakeOver = (): boolean => {
    if (resolveScope() !== document.body) return true;
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body && document.body.contains(active);
};

const moveFocus = (direction: Direction): boolean => {
    const scope = resolveScope();
    const candidates = collectCandidates(scope);
    if (candidates.length === 0) return false;

    const active = document.activeElement;
    const hasFocus = active instanceof HTMLElement && active !== document.body && scope.contains(active);
    const next = hasFocus
        ? pickNext(boxOf(active as HTMLElement), direction, candidates)
        : pickEntry(direction, candidates);

    if (!next) return false;

    // preventScroll 之后自己滚：`scrollIntoView` 的 nearest 不会把整页顶走，
    // 只把这一项挪进视野，而且认 CSS 里给电视设的 scroll-margin（焦点框才不会被边缘切掉）。
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
};

/** 电视态下接管方向键。非电视设备上是空操作。 */
export const useSpatialNavigation = (): void => {
    const deviceType = useDeviceProfileStore(state => state.deviceType);
    const active = resolveDeviceType(deviceType) === 'tv';

    useEffect(() => {
        if (!active) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing) return;
            if (!shouldTakeOver()) return;
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            if (isTextEntryTarget(event.target) || isSliderKey(event)) return;

            const direction = DIRECTION_BY_KEY[effectiveKeyCode(event)];
            if (!direction) return;

            // 只有真的把焦点挪走了才吃掉这一下：没挪走说明这个方向没有可去的地方，
            // 那就让页面照常滚动，别把遥控器按死。
            if (moveFocus(direction)) event.preventDefault();
        };

        // 捕获阶段：必须早于曲库那几套冒泡监听，否则它们先 preventDefault，这里永远轮不到。
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [active]);
};
