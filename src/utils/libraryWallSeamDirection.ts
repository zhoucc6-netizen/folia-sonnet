// src/utils/libraryWallSeamDirection.ts
// bravais 信息条的方向偏好（纯数据，叶子层）：竖向（从块与块之间的竖缝裂开）、横向（从块行之间的横缝裂开）、自动（按
// 视口的宽高比：竖着的屏幕用横条，横着的用竖缝）。store、设置分区、命令面板与 stage 共用这一份。
// 「自动」只看视口形状，不判断是不是手机：竖着拿的平板、拉成竖长条的桌面窗口一样该用横条。高至少是宽的 1.1 倍才算竖着，
// 接近方形的窗口在拖动时不会来回换方向。

export type LibraryWallSeamDirection = 'auto' | 'vertical' | 'horizontal';

/** 设置分区与命令面板列出的顺序。 */
export const LIBRARY_WALL_SEAM_DIRECTIONS: readonly LibraryWallSeamDirection[] = Object.freeze(['auto', 'vertical', 'horizontal'] as const);

export const DEFAULT_LIBRARY_WALL_SEAM_DIRECTION: LibraryWallSeamDirection = 'auto';

export const isLibraryWallSeamDirection = (value: unknown): value is LibraryWallSeamDirection => (
    value === 'auto' || value === 'vertical' || value === 'horizontal'
);

/** 存储或导入的取值：认识的原样返回，其余回默认（自动）。 */
export const normalizeLibraryWallSeamDirection = (value: unknown): LibraryWallSeamDirection => (
    isLibraryWallSeamDirection(value) ? value : DEFAULT_LIBRARY_WALL_SEAM_DIRECTION
);

/** 各取值的界面名与说明（设置分区、命令面板 picker、导入确认框共用）。 */
export const LIBRARY_WALL_SEAM_DIRECTION_TEXT: Readonly<Record<LibraryWallSeamDirection, { label: string; description: string }>> = Object.freeze({
    auto: { label: 'options.bravaisSeamDirectionAuto', description: 'options.bravaisSeamDirectionAutoDesc' },
    vertical: { label: 'options.bravaisSeamDirectionVertical', description: 'options.bravaisSeamDirectionVerticalDesc' },
    horizontal: { label: 'options.bravaisSeamDirectionHorizontal', description: 'options.bravaisSeamDirectionHorizontalDesc' },
});

/** 「竖着」的阈值：高 ≥ 宽 × 1.1（宽高比 ≤ 10 / 11）。 */
export const LIBRARY_WALL_PORTRAIT_RATIO = 1.1;

/** 「竖着的屏幕」的媒体查询，留着给只拿得到视口、量不到墙面的地方用。 */
export const LIBRARY_WALL_PORTRAIT_QUERY = '(max-aspect-ratio: 10/11)';

/**
 * 这块画面是不是竖着的。舞台用**墙面的实测尺寸**问这一句，不用媒体查询：
 * 量的是它自己那个盒子（ResizeObserver，转屏 / 分屏 / 抽屉开合都会重新量），
 * 既不会跟窗口尺寸对不上，也不会因为某个 WebView 没派发 `change` 就卡在一边 ——
 * 那正是「自动」在横竖两边都开成横条的样子。
 */
export const isPortraitWall = (width: number, height: number): boolean => (
    width > 0 && height > 0 && height >= width * LIBRARY_WALL_PORTRAIT_RATIO
);

/**
 * 反向（useLibraryWallLookStore 的 seamDirectionReverse）：只翻「自动」那一支。
 * 关着时竖屏→横条、横屏→竖缝；开着时竖屏→竖缝、横屏→横条。明确选了竖向 / 横向的不受影响
 * （那两个取值本身就是答案，再翻一次只是绕远路）。
 *
 * ⚠ 这里是**纯函数的中性默认**（不反向），不是用户那一份默认值 —— 用户的默认在
 * useLibraryWallLookStore 里（2026-10-24：默认开），两处别互相抄。
 */
export const NO_SEAM_DIRECTION_REVERSE = false;

/** 此刻信息条该不该横着开：自动时看屏幕是不是竖着的（反向则反过来）。 */
export const resolveLibraryWallSeamHorizontal = (
    direction: LibraryWallSeamDirection,
    portrait: boolean,
    reverse = NO_SEAM_DIRECTION_REVERSE,
): boolean => {
    if (direction !== 'auto') return direction === 'horizontal';
    return reverse ? !portrait : portrait;
};
