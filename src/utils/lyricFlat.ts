// src/utils/lyricFlat.ts
// 播放页歌词「扁平化」开关的读取方式。
//
// 开关本身在 useLyricFlatSettingsStore 里，它把状态写到 `<html data-lyric-flat>`；index.css 依据
// 这个属性压掉 DOM 上的 text-shadow 与背景渐变字。
//
// 但发光不止那一条路：还有 `filter: drop-shadow()`，以及 canvas 上画的 `shadowBlur` —— 这两个里
// 前者是内联样式（可以用 !important 压），后者压根进不了 CSS，只能让绘制方自己别画。后者要读
// 这个值，所以单独放在这里：
//
// - 渲染器每帧、甚至每个字都要问一次，模块级的 utils 不该反过来依赖某个 store（store 之间都不许
//   互相 import），从 DOM 读那个属性是它们共同的、成本最低的契约；
// - 属性由 store 负责维护，这里只认属性本身，开关怎么存、有哪些入口都不关它的事。

const LYRIC_FLAT_ATTRIBUTE = 'data-lyric-flat';

/** 歌词要画成扁平的（无发光、纯色字）。每帧调用，不做缓存。 */
export const isLyricFlat = (): boolean => (
    typeof document === 'undefined'
        ? false
        : document.documentElement.getAttribute(LYRIC_FLAT_ATTRIBUTE) === '1'
);
