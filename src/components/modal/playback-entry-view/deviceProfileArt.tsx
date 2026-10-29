import React from 'react';
import { FRAME_PROPS, type ArtProps } from './playbackEntryViewArt';

// src/components/modal/playback-entry-view/deviceProfileArt.tsx
// 首启引导「这是手机还是平板」那页的两张示意图：一台瘦长的手机、一台宽一些的平板。
// 画法和另外两页一致（160×100 的框、currentColor 画结构），一眼看得出是同一组卡片。

/** 手机：瘦长，横过来之后宽度捉襟见肘 —— 这正是要问它的原因。 */
export const PhoneArt: React.FC<ArtProps> = ({ accentColor, className }) => (
    <svg viewBox="0 0 160 100" className={className} role="presentation" aria-hidden="true">
        <rect {...FRAME_PROPS} />
        <rect
            x="62"
            y="14"
            width="36"
            height="72"
            rx="6"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.55"
            strokeWidth="2"
        />
        <rect x="68" y="22" width="24" height="20" rx="3" fill="currentColor" fillOpacity="0.14" />
        <rect x="68" y="48" width="24" height="5" rx="2.5" fill={accentColor} fillOpacity="0.85" />
        <rect x="68" y="58" width="18" height="4" rx="2" fill="currentColor" fillOpacity="0.22" />
        <rect x="68" y="68" width="22" height="4" rx="2" fill="currentColor" fillOpacity="0.16" />
        <rect x="68" y="78" width="14" height="4" rx="2" fill="currentColor" fillOpacity="0.16" />
    </svg>
);

/** 平板：宽，横过来也放得下同一套布局。 */
export const TabletArt: React.FC<ArtProps> = ({ accentColor, className }) => (
    <svg viewBox="0 0 160 100" className={className} role="presentation" aria-hidden="true">
        <rect {...FRAME_PROPS} />
        <rect
            x="40"
            y="18"
            width="80"
            height="64"
            rx="6"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.55"
            strokeWidth="2"
        />
        <rect x="48" y="26" width="30" height="26" rx="3" fill="currentColor" fillOpacity="0.14" />
        <rect x="84" y="26" width="28" height="5" rx="2.5" fill={accentColor} fillOpacity="0.85" />
        <rect x="84" y="36" width="22" height="4" rx="2" fill="currentColor" fillOpacity="0.22" />
        <rect x="84" y="44" width="26" height="4" rx="2" fill="currentColor" fillOpacity="0.16" />
        <rect x="48" y="60" width="64" height="4" rx="2" fill="currentColor" fillOpacity="0.12" />
        <rect x="48" y="70" width="52" height="4" rx="2" fill="currentColor" fillOpacity="0.12" />
    </svg>
);
