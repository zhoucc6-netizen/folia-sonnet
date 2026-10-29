// src/hooks/useCompactUiScale.ts
// 手机横屏那档（`<html data-folia-ui-scale="compact">`）的实时状态。

import { useEffect, useState } from 'react';

/**
 * 手机横屏紧凑档是否生效。
 *
 * 属性由 services/androidPhoneLayout 在启动、转屏、改设备类型时写；样式全在
 * styles/androidPhoneFit.css 里读它。**需要跟 CSS 完全一致**的判断必须走这里，
 * 不要自己按宽度/高度推：组件里那套 `isNarrowLayout || isShortLayout` 跟它并不等价 ——
 * 竖屏手机也是窄屏、桌面窗口拉矮也是矮屏，但都没有这一档；反过来平板横屏够宽够高，
 * 也不会有。
 *
 * 用 MutationObserver 而不是自己维护一份状态：属性只有一个写入方，谁的判断都不该
 * 有自己的一套「什么时候是紧凑档」。
 */
export const useCompactUiScale = (): boolean => {
    const read = (): boolean => (
        typeof document !== 'undefined'
        && document.documentElement.getAttribute('data-folia-ui-scale') === 'compact'
    );
    const [isCompact, setIsCompact] = useState(read);

    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const root = document.documentElement;
        const update = () => {
            setIsCompact(root.getAttribute('data-folia-ui-scale') === 'compact');
        };
        update();
        const observer = new MutationObserver(update);
        observer.observe(root, { attributes: true, attributeFilter: ['data-folia-ui-scale'] });
        return () => observer.disconnect();
    }, []);

    return isCompact;
};

export default useCompactUiScale;
