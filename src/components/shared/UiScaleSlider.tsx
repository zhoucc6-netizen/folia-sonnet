import React from 'react';
import { useTranslation } from 'react-i18next';
import { RangeInput } from '../modal/settings/kit';
import {
    UI_SCALE_MAX,
    UI_SCALE_MIN,
    UI_SCALE_STEP,
    compactUiScaleFor,
} from '../../services/androidPhoneLayout';

// src/components/shared/UiScaleSlider.tsx
// 「界面缩放」滑条。首启引导（手机 / 平板那页底下）与设置页「设备类型」共用同一份，
// 两处的行为与文案才不会各写各的。
//
// 本身不知道自己写到了哪：值由外面给（生效值，见 resolveUiScale），改动也交给外面
// （useDeviceProfileStore.setUiScale）。它只负责画与报数。
//
// 设置页那一处由 kit 的 Row 包着，标题与说明由那一行给（见 DeviceTypeSetting），
// 所以这里可以只要滑条那一排 —— `compact`。

type UiScaleSliderProps = {
    isDaylight: boolean;
    /** 滑条与滑块的着色；不给就退回当前文字色。 */
    accentColor?: string;
    /** 当前生效的缩放（百分比）。 */
    value: number;
    onChange: (value: number) => void;
    /** 要不要把「横屏再收一档」写出来 —— 只有手机那一档才有意义。 */
    showCompactHint?: boolean;
    /** 只画滑条那一排：标题与说明由外面那一行负责。 */
    compact?: boolean;
    className?: string;
};

export const UiScaleSlider: React.FC<UiScaleSliderProps> = ({
    isDaylight,
    accentColor,
    value,
    onChange,
    showCompactHint = false,
    compact = false,
    className,
}) => {
    const { t } = useTranslation();

    if (compact) {
        return (
            <div className={`flex items-center gap-3 ${className ?? ''}`} data-folia-ui-scale-slider="true">
                <span className="text-[11px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                    {UI_SCALE_MIN}%
                </span>
                <RangeInput
                    min={UI_SCALE_MIN}
                    max={UI_SCALE_MAX}
                    step={UI_SCALE_STEP}
                    value={value}
                    onChange={onChange}
                    ariaLabel={t('uiScale.title')}
                    className="min-w-0 flex-1 cursor-pointer accent-current"
                />
                <span className="text-[11px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                    {UI_SCALE_MAX}%
                </span>
            </div>
        );
    }

    return (
        <div className={className} data-folia-ui-scale-slider="true">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('uiScale.title')}
                </span>
                <span className="font-mono text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {value}%
                </span>
            </div>
            <div className="mt-1 text-xs leading-relaxed opacity-50" style={{ color: 'var(--text-secondary)' }}>
                {t('uiScale.desc')}
            </div>
            <div className="mt-3 flex items-center gap-3">
                <span className="text-[11px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                    {UI_SCALE_MIN}%
                </span>
                <RangeInput
                    min={UI_SCALE_MIN}
                    max={UI_SCALE_MAX}
                    step={UI_SCALE_STEP}
                    value={value}
                    onChange={onChange}
                    ariaLabel={t('uiScale.title')}
                    className="min-w-0 flex-1 cursor-pointer accent-current"
                />
                <span className="text-[11px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                    {UI_SCALE_MAX}%
                </span>
            </div>
            {showCompactHint && (
                <div className="mt-1.5 text-[11px] leading-relaxed opacity-40" style={{ color: 'var(--text-secondary)' }}>
                    {t('uiScale.landscapeHint', { value: `${compactUiScaleFor(value)}%` })}
                </div>
            )}
        </div>
    );
};

export default UiScaleSlider;
