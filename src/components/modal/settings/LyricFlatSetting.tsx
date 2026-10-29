import React from 'react';
import { Row, Toggle } from './kit';
import { useLyricFlatSettingsStore } from '../../../stores/useLyricFlatSettingsStore';
import { O } from './pages/appearance/options';

// src/components/modal/settings/LyricFlatSetting.tsx
// 歌词的扁平化：去掉发光，渐变的字改成纯色。
//
// 只管播放页那一层（App 里 [data-folia-lyric-surface] 标记的容器），命令面板、弹窗里的
// 文字不在作用域内 —— 具体规则见 index.css 的 [data-lyric-flat] 段。
//
// 行由 kit 的 Row 画：标签与说明都取自 `O.lyricFlat` 那一条声明（labelKey / noteKey），
// 说明不再铺在标签底下，而是收进「i」。两端都画，不是安卓专属。

const LyricFlatSetting: React.FC = () => {
    const enabled = useLyricFlatSettingsStore(state => state.flatLyrics);
    const setEnabled = useLyricFlatSettingsStore(state => state.setFlatLyrics);

    return (
        <Row option={O.lyricFlat}>
            <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} />
        </Row>
    );
};

export default LyricFlatSetting;
