import React from 'react';
import { Blend } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { noteLoopButtonPress } from '../../../services/ponder/loopShuffleHint';
import { useAutomixSettingsStore } from '../../../stores/useAutomixSettingsStore';
import { loopModeIcon, loopModeLabelName } from '../../shared/loopModeDisplay';
import { QuickTile } from './QuickTile';

// src/components/panelTab/controls/SoundTiles.tsx
// 音量下面的两块：循环（名字就是当前状态）、智能过渡。音频效果器入口已删（issue #107）。

interface SoundTilesProps {
    loopMode: 'off' | 'all' | 'one' | 'shuffle';
    /** Receives the click so the handler can stop it from reaching the panel container. */
    onToggleLoop: (event?: React.MouseEvent) => void;
    loopToggleDisabled: boolean;
}

const SoundTiles: React.FC<SoundTilesProps> = ({ loopMode, onToggleLoop, loopToggleDisabled }) => {
    const { t } = useTranslation();
    const automixEnabled = useAutomixSettingsStore(state => state.automixEnabled);
    const toggleAutomix = useAutomixSettingsStore(state => state.handleToggleAutomix);
    const LoopIcon = loopModeIcon(loopMode);

    return (
        <div className="mt-2 grid grid-cols-2 gap-2">
            <QuickTile
                kind="toggle"
                icon={<LoopIcon size={18} />}
                iconKey={loopMode}
                label={t(`player.${loopModeLabelName(loopMode)}`)}
                lit={loopMode !== 'off'}
                disabled={loopToggleDisabled}
                onClick={(event) => {
                    onToggleLoop(event);
                    noteLoopButtonPress();
                }}
            />
            <QuickTile
                kind="toggle"
                icon={<Blend size={18} />}
                label={t('ui.automix')}
                lit={automixEnabled}
                onClick={() => toggleAutomix(!automixEnabled)}
            />
        </div>
    );
};

export default SoundTiles;
