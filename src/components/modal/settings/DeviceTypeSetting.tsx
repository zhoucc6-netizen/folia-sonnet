import React from 'react';
import { useTranslation } from 'react-i18next';
import { Row, Segmented } from './kit';
import { useSettingsKitTheme } from './kit/kitTheme';
import { resolveCurrentUiScale, useDeviceProfileStore } from '../../../stores/useDeviceProfileStore';
import UiScaleSlider from '../../shared/UiScaleSlider';
import { DEVICE_TYPES, DEVICE_TYPE_LABEL_KEYS, resolveDeviceType, type DeviceType } from '../../../services/androidPhoneLayout';
import { isAndroidNativeRuntime } from '../../../services/nativeLocalMusic';
import { O } from './pages/appearance/options';

// src/components/modal/settings/DeviceTypeSetting.tsx
// 设备类型（手机 / 平板）+ 界面缩放。首启引导里问过一次，这里随时改。
//
// 设备类型只影响横屏：选了手机的话横屏时再收一档，同一块屏才塞得下桌面那套布局（见
// services/androidPhoneLayout）。缩放是另一回事，由滑条定，拉过一次就以它为准。
// 桌面端不问也不显示 —— 窗口多宽自己说了算。
//
// 两行都由 kit 的 Row 画：标签与说明都取自各自的 option 声明（labelKey / noteKey），
// 说明不再铺在标签底下，而是收进「i」。

// 档位与文案键都取自 services/androidPhoneLayout：加一档（比如电视）只改那一处。

const DeviceTypeSetting: React.FC = () => {
    const { t } = useTranslation();
    const { isDaylight } = useSettingsKitTheme();
    const deviceType = useDeviceProfileStore(state => state.deviceType);
    const setDeviceType = useDeviceProfileStore(state => state.setDeviceType);
    const uiScale = useDeviceProfileStore(state => state.uiScale);
    const setUiScale = useDeviceProfileStore(state => state.setUiScale);

    if (!isAndroidNativeRuntime()) return null;

    return (
        <>
            <Row option={O.deviceType}>
                <Segmented<DeviceType>
                    // 存里那一份是 `DeviceType | null`（null = 还没问过，按屏幕尺寸推断），
                    // 而档位必须落在某一档上 —— 所以过一遍 resolveDeviceType，跟下面
                    // 缩放那行判手机用的是同一个口径。
                    value={resolveDeviceType(deviceType)}
                    options={DEVICE_TYPES.map(type => ({
                        value: type,
                        label: t(DEVICE_TYPE_LABEL_KEYS[type]),
                    }))}
                    onChange={setDeviceType}
                />
            </Row>
            <Row
                option={O.uiScale}
                below={(
                    <UiScaleSlider
                        isDaylight={isDaylight}
                        value={resolveCurrentUiScale(uiScale, deviceType)}
                        onChange={setUiScale}
                        showCompactHint={resolveDeviceType(deviceType) === 'phone'}
                        compact
                    />
                )}
            />
        </>
    );
};

export default DeviceTypeSetting;
