import { useMediaQuery } from '../../../hooks/useMediaQuery';

// src/components/panelTab/shell/panelViewport.ts
// 面板的「矮屏」两种形态，一处定义，面板的框（PanelShell）与各页签共用。
//
// 手机横过来正是这个样子：宽（844）而矮（390）。面板贴在播放条之上、底下还压着那颗圆按钮，
// 纵向扣掉之后只剩一百多像素 —— 而横向还剩一大半。所以矮屏该做的不是把面板压扁，
// 而是**摊宽 + 分两栏**：横向有的是地方，纵向才没有。

/** 纵向不够：横过来的手机、被压矮的桌面窗口。 */
export const SHORT_VIEWPORT_QUERY = '(max-height: 600px)';

/** 又矮又宽：只有这种情况下摊宽面板、让内容分两栏才划算（竖屏手机横向没有余量）。 */
export const WIDE_SHORT_VIEWPORT_QUERY = '(min-width: 680px) and (max-height: 600px)';

/** 纵向局促：能省的上下留白都要让出来。 */
export const useIsShortViewport = (): boolean => useMediaQuery(SHORT_VIEWPORT_QUERY);

/** 纵向局促而横向宽裕：面板摊宽、页签分两栏、封面与文字并排。 */
export const useIsWideShortViewport = (): boolean => useMediaQuery(WIDE_SHORT_VIEWPORT_QUERY);
