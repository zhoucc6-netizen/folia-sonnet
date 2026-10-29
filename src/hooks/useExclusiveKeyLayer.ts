import { useEffect, useRef, type RefObject } from 'react';
import { isTextEntryTarget } from '../utils/keyboardTargets';

// src/hooks/useExclusiveKeyLayer.ts
// 会阻塞流程的层（账户的登录 / 切换确认）显示时独占不带修饰键的按键：在 window 的捕获阶段接管。
// 原是 TUI 账户层的 useLibraryTuiAccountKeys，B10 起 bravais 缝里的登录态 / 确认态共用（suite 之间不能互相 import）。
// 这类层本身就是最上层、必须有人答复，所以不靠「有没有上层窗口」让路：
// - 不带修饰键的按键一律截住（stopPropagation），底下的页面、命令面板的打字即筛选、全局的空格播放 / 暂停都收不到；
//   可打印字符与处理了的键还会 preventDefault（不落进任何输入框、空格不滚动页面）。
// - 带 Ctrl / Alt / Meta 的组合键与 Tab 放过：浏览器与开发者工具的快捷键、Ctrl+K 命令面板与键盘焦点照常。
// - 焦点在层自己的按钮上时，Enter / 空格交还给按钮（原生激活），不当成「主动作」。
// - Enter / Escape 不响应长按重复。
// - **层自己的输入框一律放行**（见 onOwnTextEntry）：那时候这个层里只有按钮，「可打印字符统统截住」才成立；
//   自建服务（飞牛）把用户名 / 密码框搬进缝里之后，沿用旧规矩会把数字键吞掉。
// 层要同时挂 data-folia-keyboard-window（全局热键与各 suite 的按键看到它会让路）；监听只在 isActive 时装上。

/** 处理一次按键；返回 true 表示处理了（会 preventDefault）。 */
export type ExclusiveKeyHandler = (key: string, event: KeyboardEvent) => boolean;

export const useExclusiveKeyLayer = ({
    isActive,
    containerRef,
    onKey,
}: {
    isActive: boolean;
    /** 层的根元素：判断焦点是不是在它自己的按钮上。 */
    containerRef: RefObject<HTMLElement | null>;
    onKey: ExclusiveKeyHandler;
}) => {
    // 监听只装一次，回调每次渲染换成最新的。
    const latest = useRef(onKey);
    latest.current = onKey;

    useEffect(() => {
        if (!isActive) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.altKey || event.metaKey || event.key === 'Tab' || event.isComposing) return;
            const target = event.target instanceof HTMLElement ? event.target : null;

            // 层自己的输入框：可打印字符、退格、方向键全部交还给浏览器，否则这个框根本打不进字。
            //
            // 「长度为一就 preventDefault」原本是给「只有按钮的层」用的兜底；缝里现在放着真的用户名 /
            // 密码框，数字正好是单个字符，被它一口吞掉 —— 而安卓软键盘打汉字 / 字母时 key 是
            // Unidentified（长度不为 1），反倒逃过去了，于是现象成了「只有数字输不进去」。
            // Enter 也一并放给输入框：表单自己的 onSubmit 会接管提交。Escape 仍然收下（关掉登录）。
            const onOwnTextEntry = Boolean(target && isTextEntryTarget(target) && containerRef.current?.contains(target));
            if (onOwnTextEntry && event.key !== 'Escape') return;

            event.stopPropagation();

            const onOwnButton = Boolean(target?.closest('button') && containerRef.current?.contains(target));
            if (onOwnButton && (event.key === 'Enter' || event.key === ' ')) return;

            if (event.repeat && (event.key === 'Enter' || event.key === 'Escape')) {
                event.preventDefault();
                return;
            }
            const handled = latest.current(event.key, event);
            if (handled || event.key.length === 1) event.preventDefault();
        };
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [containerRef, isActive]);
};
