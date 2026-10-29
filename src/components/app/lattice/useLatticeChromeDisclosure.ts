import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';

// src/components/app/lattice/useLatticeChromeDisclosure.ts
// Mouse hover, keyboard focus and touch taps reveal details without treating a pan as a tap.
//
// 没有指针的设备（手机、平板）上这套揭示根本不会发生：hover 永远不来（下面 onPointerEnter 也
// 明确把 touch 排除了），于是「把控件露出来」这件事只能靠再点一下海报代劳 —— 用户点播放键
// 常常只换来一次「亮起」，中间的上一首 / 下一首还一直被裁着。这类设备上一律常亮：展开即显示，
// 点按钮就是播放。有鼠标的（含能同时用鼠标的二合一设备）照旧走 hover，观感不变。

const HOVER_CAPABLE_QUERY = '(hover: hover)';

export function useLatticeChromeDisclosure(expanded: boolean) {
    const articleRef = useRef<HTMLElement>(null);
    const pointerTypeRef = useRef('mouse');
    const [hovered, setHovered] = useState(false);
    const [touchOpen, setTouchOpen] = useState(false);
    const [keyboardFocus, setKeyboardFocus] = useState(false);
    // 初值按「有鼠标」给：桌面不受影响，触屏在挂载后第一次 effect 里就会被翻成 false。
    const [canHover, setCanHover] = useState(true);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia(HOVER_CAPABLE_QUERY);
        const apply = () => setCanHover(query.matches);
        apply();
        query.addEventListener('change', apply);
        return () => query.removeEventListener('change', apply);
    }, []);

    useEffect(() => {
        if (!expanded) setTouchOpen(false);
    }, [expanded]);
    useEffect(() => {
        if (!touchOpen) return;
        const dismiss = (event: globalThis.PointerEvent) => {
            if (event.target instanceof Node && !articleRef.current?.contains(event.target)) setTouchOpen(false);
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, [touchOpen]);

    // 没有指针的设备：控制条常亮，不再有「点一下才亮」这一档。
    const alwaysRevealed = !canHover;

    return {
        articleRef,
        // Pointer hover is tracked here already, so the poster's own lift reads it rather than
        // running a second gesture; touch pointers are filtered out below, as they must be.
        hovered,
        revealed: expanded && (alwaysRevealed || hovered || touchOpen || keyboardFocus),
        // 常亮的设备上这次点击不该把已经露出来的控件又收回去 —— 那正是「点了只是亮一下」的来处。
        toggleTouch: () => {
            if (alwaysRevealed) return;
            if (pointerTypeRef.current === 'touch') setTouchOpen(value => !value);
        },
        toggleKeyboard: () => {
            if (alwaysRevealed) return;
            setTouchOpen(value => !value);
        },
        onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
            pointerTypeRef.current = event.pointerType;
            setKeyboardFocus(false);
        },
        onPointerEnter: (event: PointerEvent<HTMLElement>) => { if (event.pointerType !== 'touch') setHovered(true); },
        onPointerLeave: () => setHovered(false),
        onFocusCapture: (event: FocusEvent<HTMLElement>) => {
            if (event.target !== event.currentTarget && event.target.matches(':focus-visible')) setKeyboardFocus(true);
        },
        onBlurCapture: (event: FocusEvent<HTMLElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
        },
    };
}
