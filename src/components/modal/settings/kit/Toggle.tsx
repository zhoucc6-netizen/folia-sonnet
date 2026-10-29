import React from 'react';
import { useRowAria } from './Row';
import { useSettingsKitTheme } from './kitTheme';

// src/components/modal/settings/kit/Toggle.tsx
// 设置里唯一的开关。样子照「AI 云缓存」那一颗（也是最老的一颗、用户点名要的那颗）：
// 48×24 的跑道、16×16 的白拇指、开时整颗滑到右端、跑道变成那一抹灰蓝。
//
// 以前这里是另一套（40×24、拇指和跑道都跟主题走色），跟云缓存那颗、GridView /
// Lattice / Lab 那些手写的一颗颗并存，同一个设置里能看到两三种开关 —— 现在只有这一种。
//
// 关着时的跑道要分明暗：亮色界面上是黑 15%、暗色界面上是白 15%（云缓存那颗就是这么写的），
// 所以这里读 kit 主题，不再由调用方传底色。

type ToggleProps = {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    /** 名字。不在 kit 的 Row 里（自己拿 div 画的一行）时没有 label 可借，用它当 aria-label。 */
    label?: string;
    /** The id of what names it, where it sits outside a settings row. */
    labelledBy?: string;
};

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled, label, labelledBy }) => {
    const { isDaylight } = useSettingsKitTheme();

    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            {...useRowAria()}
            {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`st-t-move shrink-0 w-12 h-6 rounded-full p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${checked
                ? 'bg-[rgba(114,119,134,1)]'
                : isDaylight ? 'bg-black/15' : 'bg-white/15'}`}
        >
            <span
                className={`st-t-move block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`}
            />
        </button>
    );
};

export default Toggle;
