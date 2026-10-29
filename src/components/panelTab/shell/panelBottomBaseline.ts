// src/components/panelTab/shell/panelBottomBaseline.ts
// 播放条那条基线（usePlayerBottomBarBottomPx）之外，还要再往上抬多少。
//
// 那条基线只保证**不压到播放条** —— 系统手势条 / 导航栏那一截不在它的账上，于是挂在它上面的
// 东西下半截会落进那一带，手感就是「有一部分在屏幕外面」。
//
// 手柄（右下角那颗展开面板的圆按钮）与展开后的面板**共用这一条基线** —— PanelShell 里就写着
// 「与手柄同一条基线」。所以这个抬升量必须**两处同源**：以前只有一个抬了，两者一错开，
// 手柄看着就掉到面板外头去了。

export const PANEL_BOTTOM_LIFT_PX = 16;
