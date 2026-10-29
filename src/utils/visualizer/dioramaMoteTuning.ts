import {
    DIORAMA_MOTE_CIRCUMFERENCE_MAX,
    DIORAMA_MOTE_CIRCUMFERENCE_MIN,
    DIORAMA_MOTE_RADIAL_MAX,
    DIORAMA_MOTE_RADIAL_MIN,
    DEFAULT_DIORAMA_TUNING,
} from '../../types';

// src/utils/visualizer/dioramaMoteTuning.ts
// 尘埃场的「窗口 + 密度上限」：哪几行常驻、圆周 / 径向各夹在什么范围。
//
// 为什么单独一份：这套夹取是**设置层的取值规则** —— stores/visualizerSettingsPersistence
// 写盘前要夹一次、settingsPanels 拖动滑条时也要夹一次，而它们都在 components/visualizer 之外。
// 真正的几何（把尘埃写进环形缓冲）留在 dioramaMoteField.ts，那份要相机路径，只有渲染期需要。
//
// 住在 utils 而不是 components/visualizer/diorama：渲染期之外也要用，而 utils 与 stores
// 都不能依赖组件目录。

/** Lines of motes kept resident behind / ahead of the read head. */
export const DIORAMA_MOTE_LINES_BEHIND = 2;
export const DIORAMA_MOTE_LINES_AHEAD = 5;
export const DIORAMA_MOTE_WINDOW_LINES = DIORAMA_MOTE_LINES_BEHIND + DIORAMA_MOTE_LINES_AHEAD + 1;

/** Worst-case points the layer can ever draw - the density cap's whole reason for existing. */
export const DIORAMA_MOTE_MAX_POINTS = DIORAMA_MOTE_WINDOW_LINES
    * DIORAMA_MOTE_CIRCUMFERENCE_MAX * DIORAMA_MOTE_RADIAL_MAX;

/** Clamp a requested 圆周 count (motes around each ring) into its safe range. */
export const resolveDioramaMoteCircumference = (requested: number): number => Math.round(Math.min(
    DIORAMA_MOTE_CIRCUMFERENCE_MAX,
    Math.max(
        DIORAMA_MOTE_CIRCUMFERENCE_MIN,
        Number.isFinite(requested) ? requested : DEFAULT_DIORAMA_TUNING.backgroundParticleCircumference,
    ),
));

/** Clamp a requested 径向 count (layers across the shell thickness) into its safe range. */
export const resolveDioramaMoteRadial = (requested: number): number => Math.round(Math.min(
    DIORAMA_MOTE_RADIAL_MAX,
    Math.max(
        DIORAMA_MOTE_RADIAL_MIN,
        Number.isFinite(requested) ? requested : DEFAULT_DIORAMA_TUNING.backgroundParticleRadial,
    ),
));

/** Motes drawn per line = 圆周 x 径向, both already clamped. */
export const resolveDioramaMoteCount = (circumference: number, radial: number): number =>
    resolveDioramaMoteCircumference(circumference) * resolveDioramaMoteRadial(radial);

/** Which ring-buffer slot a line owns. Consecutive lines always land in distinct slots. */
export const dioramaMoteSlot = (line: number): number => (
    ((line % DIORAMA_MOTE_WINDOW_LINES) + DIORAMA_MOTE_WINDOW_LINES) % DIORAMA_MOTE_WINDOW_LINES
);
