import React from 'react';
import { Row, Toggle } from './kit';
import { useGlassSurfaceSettingsStore } from '../../../stores/useGlassSurfaceSettingsStore';
import { O } from './pages/appearance/options';

// src/components/modal/settings/GlassSurfaceSetting.tsx
// 「关闭毛玻璃」：把界面上那一百多处 backdrop-blur 面板（搜索框、侧栏、命令面板、弹层）
// 换成不透明实色。开着更好看，关掉更省 —— 中低端机上这些模糊层是掉帧的主要来源。
//
// 行由 kit 的 Row 画：标签与说明都取自 `O.glassSurface` 那一条声明（labelKey / noteKey），
// 说明不再铺在标签底下，而是收进「i」。两端都画，不是安卓专属。

const GlassSurfaceSetting: React.FC = () => {
    // 开关的语义是「关掉」，存的是 disabled，UI 上按「保留毛玻璃」来呈现更直观。
    const disabled = useGlassSurfaceSettingsStore(state => state.glassSurfacesDisabled);
    const setDisabled = useGlassSurfaceSettingsStore(state => state.setGlassSurfacesDisabled);
    const glassEnabled = !disabled;

    return (
        <Row option={O.glassSurface}>
            <Toggle checked={glassEnabled} onChange={() => setDisabled(!disabled)} />
        </Row>
    );
};

export default GlassSurfaceSetting;
