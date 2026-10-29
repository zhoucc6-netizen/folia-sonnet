import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getEffectiveRenderPixelRatio, getNativeDevicePixelRatio, subscribeRenderPixelRatio } from '../utils/renderPixelRatio';

// src/hooks/useMediaQuery.ts
// Shared media query subscription so layout branches can read a breakpoint without hand-rolling matchMedia.

/**
 * Tracks whether `query` currently matches, staying in sync as the viewport changes.
 *
 * Reads the initial value straight from `matchMedia` through `useSyncExternalStore` rather than
 * settling it in an effect: a component that branches its markup on the result would otherwise
 * render the wrong branch on the first frame and visibly snap to the right one.
 */
export const useMediaQuery = (query: string): boolean => {
    const subscribe = useCallback((onStoreChange: () => void) => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return () => {};
        }

        const mediaQuery = window.matchMedia(query);
        mediaQuery.addEventListener('change', onStoreChange);
        return () => mediaQuery.removeEventListener('change', onStoreChange);
    }, [query]);

    const getSnapshot = useCallback(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return false;
        }

        return window.matchMedia(query).matches;
    }, [query]);

    return useSyncExternalStore(subscribe, getSnapshot, () => false);
};

/**
 * Current effective `devicePixelRatio`, so raster sources can be picked at the resolution the
 * screen will actually paint them at.
 *
 * Two things move the ratio. Dragging a window onto a display with another density changes the
 * screen's density without changing the CSS viewport, so `resize` misses it: the screen's ratio is
 * watched through a media query pinned to its own current value, which stops matching the instant
 * that ratio moves and lets the effect re-pin. The render-resolution cap (utils/renderPixelRatio.ts)
 * moves the ratio without any screen change at all, so it is watched through its own subscription.
 */
export const useDevicePixelRatio = (): number => {
    const [ratio, setRatio] = useState(getEffectiveRenderPixelRatio);
    const [nativeRatio, setNativeRatio] = useState(getNativeDevicePixelRatio);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const unsubscribeRenderPixelRatio = subscribeRenderPixelRatio(() => {
            setRatio(getEffectiveRenderPixelRatio());
        });
        if (typeof window.matchMedia !== 'function') return unsubscribeRenderPixelRatio;
        const mediaQuery = window.matchMedia(`(resolution: ${nativeRatio}dppx)`);
        const handleScreenChange = () => {
            setNativeRatio(getNativeDevicePixelRatio());
            setRatio(getEffectiveRenderPixelRatio());
        };
        mediaQuery.addEventListener('change', handleScreenChange);
        return () => {
            mediaQuery.removeEventListener('change', handleScreenChange);
            unsubscribeRenderPixelRatio();
        };
    }, [nativeRatio]);

    return ratio;
};

export default useMediaQuery;
