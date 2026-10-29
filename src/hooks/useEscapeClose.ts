import { useEffect, useRef } from 'react';
import { isTextEntryTarget } from '../utils/keyboardTargets';

// src/hooks/useEscapeClose.ts
// 按 Esc（或安卓的返回键 / 边缘返回手势）关掉自己：给那些盖在最上面、又挂了 data-folia-keyboard-window
// （让底下的墙与全局热键让路）的面板用。
//
// 监听必须挂在 window 上：原生把返回转成一次 Escape 派发到 window（useNativeBackButton），而 React 的
// onKeyDown 挂在 root container 上 —— 派发到 window 的事件不经过它，于是这类面板上的返回等于「没人接管」，
// App 直接退到后台。挂了 data-folia-keyboard-window 的面板更是两头落空：底下的人让给它，它自己又接不到。
//
// 焦点在输入框里时 Esc 归输入框（取消输入），不关面板；安卓返回派发时事件目标是 window，不在这条里让出。

// 打开的先后顺序（后注册的压在上面）：一次 Esc 只关最上面那一个。面板会套面板（整理歌曲信息 → 手动匹配），
// 而外层先挂载、先注册监听，没有这条栈的话一次返回会连着把外层的也关掉。
const stack: object[] = [];

export const useEscapeClose = (onClose: () => void): void => {
    const latest = useRef(onClose);
    latest.current = onClose;

    useEffect(() => {
        const entry = {};
        stack.push(entry);
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
            if (stack[stack.length - 1] !== entry) return;
            if (isTextEntryTarget(event.target)) return;
            event.preventDefault();
            latest.current();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            const index = stack.indexOf(entry);
            if (index >= 0) stack.splice(index, 1);
        };
    }, []);
};

export default useEscapeClose;
