import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PhoneArt, TabletArt } from './deviceProfileArt';
import { OnboardingChoiceCards, type OnboardingChoiceCard } from './OnboardingChoiceCards';
import { resolveCurrentUiScale, useDeviceProfileStore } from '../../../stores/useDeviceProfileStore';
import UiScaleSlider from '../../shared/UiScaleSlider';
import {
    resolveDeviceType,
    type DeviceType,
} from '../../../services/androidPhoneLayout';

// src/components/modal/playback-entry-view/DeviceTypeOptions.tsx
// 首启引导里问「这是手机还是平板」，底下再挂一条缩放滑条。
//
// 设备类型只影响一件事：选了手机的话，横屏时整屏再收一档，同一块屏才塞得下桌面那套布局
// （见 services/androidPhoneLayout 的 applyDeviceProfile）。
// 缩多少不写死 —— 由底下滑条定，默认按类型给一档（手机缩、平板不缩）。
// 写入走设置页同一个 store，之后随时能改。

type DeviceTypeOptionsProps = {
    isDaylight: boolean;
    accentColor: string;
};

export const DeviceTypeOptions: React.FC<DeviceTypeOptionsProps> = ({ isDaylight, accentColor }) => {
    const { t } = useTranslation();
    const deviceType = useDeviceProfileStore(state => state.deviceType);
    const setDeviceType = useDeviceProfileStore(state => state.setDeviceType);
    const uiScale = useDeviceProfileStore(state => state.uiScale);
    const setUiScale = useDeviceProfileStore(state => state.setUiScale);

    // 没调过时滑条停在默认档上，一拖就落盘 —— 之后换设备类型也不再跟着默认值走。
    const currentScale = resolveCurrentUiScale(uiScale, deviceType);

    const cards = useMemo<OnboardingChoiceCard<DeviceType>[]>(() => [
        {
            value: 'phone',
            art: PhoneArt,
            title: t('deviceTypeOnboarding.phone.title'),
            description: t('deviceTypeOnboarding.phone.description'),
        },
        {
            value: 'tablet',
            art: TabletArt,
            title: t('deviceTypeOnboarding.tablet.title'),
            description: t('deviceTypeOnboarding.tablet.description'),
        },
    ], [t]);

    return (
        <div className="space-y-4">
            <OnboardingChoiceCards
                cards={cards}
                value={deviceType}
                onChange={setDeviceType}
                isDaylight={isDaylight}
                accentColor={accentColor}
                dataAttribute="data-onboarding-device-type"
                gridClassName="grid-cols-2"
            />
            <UiScaleSlider
                isDaylight={isDaylight}
                accentColor={accentColor}
                value={currentScale}
                onChange={setUiScale}
                showCompactHint={resolveDeviceType(deviceType) === 'phone'}
            />
        </div>
    );
};

export default DeviceTypeOptions;
