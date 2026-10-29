import React from 'react';
import { useTranslation } from 'react-i18next';
import { Row, Segmented } from './kit';
import { resolveDeviceType } from '../../../services/androidPhoneLayout';
import { useDeviceProfileStore } from '../../../stores/useDeviceProfileStore';
import { useTvKeyboardPreferenceStore } from '../../../stores/useTvKeyboardPreferenceStore';
import { O } from './pages/appearance/options';

// src/components/modal/settings/TvKeyboardSetting.tsx
// 电视上输入走哪一套：应用内虚拟键盘，还是电视自己的输入法。
//
// 只在电视上出现：手机 / 平板 / 桌面本来就有输入法，这一项对它们没有意义。
// 说明收在「i」里，由 option 的 noteKey 给（见 options.tvKeyboardMode）。

const TvKeyboardSetting: React.FC = () => {
    const { t } = useTranslation();
    const deviceType = useDeviceProfileStore(state => state.deviceType);
    const useSystemIme = useTvKeyboardPreferenceStore(state => state.useSystemIme);
    const setUseSystemIme = useTvKeyboardPreferenceStore(state => state.setUseSystemIme);

    if (resolveDeviceType(deviceType) !== 'tv') return null;

    return (
        <Row option={O.tvKeyboardMode}>
            <Segmented<'builtin' | 'system'>
                value={useSystemIme ? 'system' : 'builtin'}
                options={[
                    { value: 'builtin', label: t('options.tvKeyboardBuiltin') },
                    { value: 'system', label: t('options.tvKeyboardSystem') },
                ]}
                onChange={choice => setUseSystemIme(choice === 'system')}
            />
        </Row>
    );
};

export default TvKeyboardSetting;
