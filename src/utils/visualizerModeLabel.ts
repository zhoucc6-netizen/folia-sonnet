// src/utils/visualizerModeLabel.ts
// 切模式时那条 toast 要一个显示名，而显示名住在各模式的 entry.tsx（components/visualizer/**）。
// store 是低层，不能反向依赖 UI 目录 —— 也不该为了一个字符串把整个 visualizer 层拉进来
// （registry 用 eager glob 发现成员，连带 183 个模块与 three.js）。
//
// 所以这里只留一个挂载点：registry 在自己的模块里注册解析器（它本来就持有全部 entry），
// store 只调这里的取值函数。与 utils/frameRateLimiter 的 setGlobalVisualizerFrameRate
// 同一形状 —— 低层持有接口，装配方在初始化时把实现放进来。
//
// **解析器一旦注册必须优先用它**：mod 投稿的模式（`mod:<id>:<mode>`）只有活注册表认得，
// 退回静态表会把它们说成内建模式的名字。没注册时（单测、只用 store 的脚本）原样返回
// 模式 id，不编一个可能错的名字。

/** 返回 null 表示「不认识这个模式」，由调用方决定怎么兜底。 */
type VisualizerModeLabelResolver = (mode: string, t: (key: string) => string) => string | null;

let resolveVisualizerModeLabel: VisualizerModeLabelResolver | null = null;

/**
 * 由 components/visualizer/registry 在模块初始化时调用。
 *
 * 重复注册以最后一次为准：HMR 会重新执行注册方的模块。
 */
export const registerVisualizerModeLabelResolver = (resolver: VisualizerModeLabelResolver): void => {
    resolveVisualizerModeLabel = resolver;
};

/** 取某个模式的显示名。解析器没注册或认不出这个模式时返回模式 id 本身。 */
export const getVisualizerModeLabel = (mode: string, t: (key: string) => string): string =>
    resolveVisualizerModeLabel?.(mode, t) ?? mode;
