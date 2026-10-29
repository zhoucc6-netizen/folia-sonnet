import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui';
import { resolveDeviceType } from '../../../services/androidPhoneLayout';
import { useDeviceProfileStore } from '../../../stores/useDeviceProfileStore';
import { useTvKeyboardStore, type TvKeyboardTarget } from './tvKeyboardStore';

// src/components/app/tv/TvKeyboard.tsx
// 电视上的应用内虚拟键盘。
//
// 为什么需要它：安卓 WebView 聚焦 <input> 时会向系统请求输入法，而 Android TV 一般没有可用的
// 默认输入法 —— 要么什么都不弹，要么弹出一个遥控器根本操作不了的系统键盘。搜索、改歌单名、
// 填 navidrome 地址这些全卡在这一步。
//
// 工作方式：
//   · 电视态下任何输入框获得焦点就收下它（focusin），把焦点交给键盘第一颗键 —— 输入框自己留着
//     光标位置，但不持有 DOM 焦点，方向键才归空间导航管。
//   · 按键直接写进目标元素的 value，并用**原生 setter + input 事件**提交，React 的受控组件才
//     收得到（直接赋 value 会被 React 的 value 追踪吞掉）。
//   · 面板挂 data-folia-keyboard-window，空间导航会把候选范围收进这个面板，页面上别的控件
//     在这期间不会被误选。
//   · Esc / 返回键关掉键盘，焦点还给刚才那个输入框。

const ROWS: readonly (readonly { key: string; label: string }[])[] = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(key => ({ key, label: key })),
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'].map(key => ({ key, label: key })),
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'].map(key => ({ key, label: key })),
    ['z', 'x', 'c', 'v', 'b', 'n', 'm'].map(key => ({ key, label: key })),
    ['.', '/', ':', '@', '-', '_'].map(key => ({ key, label: key })),
];

/**
 * 把文本写进目标控件并让 React 看见。
 *
 * 受控组件会在实例上装一个 value 的拦截器，直接 `element.value = x` 之后它记录的快照还是旧值，
 * 于是 onChange 里比对不出变化、界面不更新。绕法是拿原型上的原生 setter 写进去，再派发一次
 * input 事件，React 的 onChange 就会照常触发。
 */
const writeValue = (element: TvKeyboardTarget, next: string): void => {
    const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, next);
    else element.value = next;
    element.dispatchEvent(new Event('input', { bubbles: true }));
};

/** 在光标处插入文本，插完把光标放到插入内容之后（和真的打字一样）。 */
const insertText = (element: TvKeyboardTarget, text: string): void => {
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    const next = `${element.value.slice(0, start)}${text}${element.value.slice(end)}`;
    writeValue(element, next);
    const caret = start + text.length;
    element.setSelectionRange?.(caret, caret);
};

/** 删掉光标前面一个字（有选区时删选区）。 */
const deleteBackward = (element: TvKeyboardTarget): void => {
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    if (start === end && start === 0) return;
    const from = start === end ? start - 1 : start;
    writeValue(element, `${element.value.slice(0, from)}${element.value.slice(end)}`);
    element.setSelectionRange?.(from, from);
};

const Key: React.FC<{
    label: string;
    wide?: boolean;
    onPress: () => void;
}> = ({ label, wide, onPress }) => (
    <Button
        variant="bare"
        onClick={onPress}
        // 键帽自己就是焦点环的落点：电视上一眼能看出遥控器停在哪颗键上。
        className={`h-14 rounded-xl border border-white/10 bg-white/[0.06] text-[20px] font-medium text-white/90 outline-none transition-colors hover:bg-white/[0.12] focus-visible:bg-white/20 ${wide ? 'min-w-[9rem] px-6 text-[17px]' : 'w-14'}`}
    >
        {label}
    </Button>
);

/**
 * 关掉键盘时会把焦点还给输入框，而那个 focus 会再触发一次 focusin —— 不加这个闸门就会
 * 「关掉又立刻弹回来」。置位 -> 还焦点 -> 下一个任务复位。
 */
let suppressKeyboardOpen = false;

export const TvKeyboard: React.FC = () => {
    const { t } = useTranslation();
    const deviceType = useDeviceProfileStore(state => state.deviceType);
    const target = useTvKeyboardStore(state => state.target);
    const open = useTvKeyboardStore(state => state.open);
    const close = useTvKeyboardStore(state => state.close);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const isTv = resolveDeviceType(deviceType) === 'tv';

    // 输入框一拿到焦点就接管：电视上没有可用的系统输入法。
    useEffect(() => {
        if (!isTv || typeof document === 'undefined') return undefined;
        const onFocusIn = (event: FocusEvent) => {
            if (suppressKeyboardOpen) return;
            const node = event.target;
            if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return;
            if (useTvKeyboardStore.getState().target === node) {
                // 键盘已经开着、焦点又跑回输入框（用户点了它、或程序化聚焦）：把焦点抢回键帽，
                // 否则方向键变成在输入框里移光标，遥控器再也走不出这个框。
                panelRef.current?.querySelector('button')?.focus();
                return;
            }
            open(node);
        };
        document.addEventListener('focusin', onFocusIn);
        return () => document.removeEventListener('focusin', onFocusIn);
    }, [isTv, open]);

    // 打开时把焦点交给第一颗键，方向键才归空间导航（焦点还在输入框里的话，方向键是走光标的）。
    useEffect(() => {
        if (!target) return;
        const first = panelRef.current?.querySelector('button');
        first?.focus();
    }, [target]);

    const dismiss = useCallback(() => {
        const element = target;
        suppressKeyboardOpen = true;
        close();
        element?.focus();
        window.setTimeout(() => { suppressKeyboardOpen = false; }, 0);
    }, [target, close]);

    /*
     * Esc / 遥控器返回键关键盘。
     *
     * 挂在 window 而不是面板上：面板的 onKeyDown 只在焦点位于面板内部时才收得到，而焦点有可能
     * 已经被别的东西拿走（比如某个输入框自己抢焦）。键盘开着的时候，返回键的唯一合理语义就是关掉它。
     */
    useEffect(() => {
        if (!target) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            dismiss();
        };
        window.addEventListener('keydown', onKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
    }, [target, dismiss]);

    if (!target) return null;

    return (
        <div
            ref={panelRef}
            data-folia-keyboard-window="true"
            // 和电视档的 overscan 一致：3.5vw / 3.5vh 是 styles/androidTv.css 给 app shell 的内边距。
            className="fixed inset-x-0 bottom-0 z-[240] flex flex-col items-center gap-2 border-t border-white/10 bg-[#0b0b0f]/95 px-8 pb-[3.5vh] pt-4 backdrop-blur-xl"
            onKeyDown={event => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    dismiss();
                }
            }}
        >
            {ROWS.map((row, index) => (
                <div key={index} className="flex flex-wrap justify-center gap-2">
                    {row.map(item => (
                        <Key
                            key={item.key}
                            label={item.label}
                            onPress={() => insertText(target, item.key)}
                        />
                    ))}
                </div>
            ))}
            <div className="flex flex-wrap justify-center gap-2">
                <Key label={t('tvKeyboard.space', '空格')} wide onPress={() => insertText(target, ' ')} />
                <Key label={t('tvKeyboard.backspace', '退格')} wide onPress={() => deleteBackward(target)} />
                <Key label={t('tvKeyboard.clear', '清空')} wide onPress={() => writeValue(target, '')} />
                <Key label={t('tvKeyboard.close', '关闭')} wide onPress={dismiss} />
                <Key label={t('tvKeyboard.done', '确定')} wide onPress={dismiss} />
            </div>
        </div>
    );
};

export default TvKeyboard;
