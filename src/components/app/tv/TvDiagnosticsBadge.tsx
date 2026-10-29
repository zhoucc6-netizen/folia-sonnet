import React, { useEffect, useState } from 'react';
import { resolveDeviceType } from '../../../services/androidPhoneLayout';
import { useDeviceProfileStore } from '../../../stores/useDeviceProfileStore';

// src/components/app/tv/TvDiagnosticsBadge.tsx
// 电视调试角标：把「只有电视上才看得到、而写代码的人看不到」的事实显示出来。
//
// 为什么需要它：这台电视开不了网络调试，拿不到 adb / logcat，于是每次排查都只能靠用户描述
// 加照片，来回一轮要出一次包。角标把三样东西直接画在屏幕上：
//   · 真实的视口尺寸与 devicePixelRatio（决定 4K 那条分支到底有没有生效）；
//   · 亮层判断出来的设备类型与根字号（整套电视适配的开关）；
//   · 最后按下的那个键的 key / code / keyCode —— 遥控器上按键到底发成什么，一眼就能读到，
//     不用猜。
//
// 只在电视态渲染；class 里全是 fixed + pointer-events-none，不会挡住任何操作。

type BadgeInfo = {
    width: number;
    height: number;
    dpr: number;
    deviceAttribute: string;
    uiScale: string;
};

export const TvDiagnosticsBadge: React.FC = () => {
    const deviceType = useDeviceProfileStore(state => state.deviceType);
    const isTv = resolveDeviceType(deviceType) === 'tv';
    const [info, setInfo] = useState<BadgeInfo>({
        width: 0, height: 0, dpr: 0, deviceAttribute: '?', uiScale: '',
    });
    const [lastKey, setLastKey] = useState('键: (还没按过)');

    useEffect(() => {
        if (!isTv || typeof window === 'undefined') return undefined;

        const read = () => {
            const root = document.documentElement;
            setInfo({
                width: window.innerWidth,
                height: window.innerHeight,
                dpr: window.devicePixelRatio,
                deviceAttribute: root.getAttribute('data-folia-device-resolved') ?? '?',
                uiScale: getComputedStyle(root).getPropertyValue('--folia-ui-scale-normal').trim(),
            });
        };
        read();
        window.addEventListener('resize', read);
        window.addEventListener('orientationchange', read);

        // 捕获阶段：要在各个处理者 preventDefault 之前就能读到原样的键。
        const onKeyDown = (event: KeyboardEvent) => {
            setLastKey(`键: ${event.key} / code=${event.code || '(空)'} / kc=${event.keyCode}`);
        };
        window.addEventListener('keydown', onKeyDown, { capture: true });

        return () => {
            window.removeEventListener('resize', read);
            window.removeEventListener('orientationchange', read);
            window.removeEventListener('keydown', onKeyDown, { capture: true });
        };
    }, [isTv]);

    if (!isTv) return null;

    return (
        <div
            data-folia-tv-diagnostics="true"
            className="pointer-events-none fixed bottom-1 left-1 z-[300] rounded bg-black/70 px-2 py-1 font-mono text-[12px] leading-4 text-emerald-300"
        >
            <div>
                {info.width}×{info.height}
                {` dpr=${info.dpr}`}
                {` type=${info.deviceAttribute}`}
                {` scale=${info.uiScale || '-'}`}
            </div>
            <div>{lastKey}</div>
        </div>
    );
};

export default TvDiagnosticsBadge;
