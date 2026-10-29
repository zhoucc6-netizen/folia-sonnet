import React, { useRef } from 'react';
import { Segments } from './Segments';
import { useMeasuredSize } from './useMeasuredSize';

// src/components/panelTab/shell/TabDock.tsx
// The panel's row of tabs, at its bottom edge. Every tab shows its name while the names fit the
// row. When they do not (a mod adds a tab, a longer language, a narrow window) the tabs that are
// not open show their icon and the open one shows icon and name. Whether they fit is measured: the
// names are laid out once more, out of sight, and their width is held against the row's.

export type DockTab<T extends string> = {
    id: T;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
};

type TabDockProps<T extends string> = {
    tabs: ReadonlyArray<DockTab<T>>;
    currentTab: T;
    onTabChange: (tab: T) => void;
    /**
     * 竖着排：矮而宽的窗口（横过来的手机）里页签改成右侧一条竖轨，把底边那 48px
     * 让给页签内容 —— 那种窗口横向还剩一大半，纵向才是缺的。
     */
    vertical?: boolean;
};

export const TabDock = <T extends string>({ tabs, currentTab, onTabChange, vertical }: TabDockProps<T>): React.ReactElement => {
    const rowRef = useRef<HTMLDivElement>(null);
    const namesRef = useRef<HTMLDivElement>(null);
    const row = useMeasuredSize(rowRef);
    const names = useMeasuredSize(namesRef);
    // One pixel of slack for widths the browser rounds.
    const showNames = !vertical && names.width <= row.width + 1;
    // 竖轨只有 56px 宽，放不下名字：一格一个图标，名字交给 tooltip（Segments 那边已经这么做）。
    const iconOnly = vertical || !showNames;

    return (
        <div ref={rowRef} className="relative h-full">
            <Segments
                size="l"
                fill
                vertical={vertical}
                value={currentTab}
                onChange={onTabChange}
                options={tabs.map(tab => ({
                    value: tab.id,
                    label: tab.label,
                    icon: iconOnly ? <tab.icon size={vertical ? 18 : 16} /> : undefined,
                    // 竖轨 52px 宽放不下名字：连选中的那一格也只给图标，名字一律交给 tooltip。
                    iconOnly: vertical ? true : (iconOnly && tab.id !== currentTab),
                    // 每一格各自是一个思索目标：停在哪一格，讲的就是那一页。
                    data: { 'data-ponder-panel-tab-button': tab.id },
                }))}
            />
            {/* The names as the row would show them, laid out to be measured. */}
            {!vertical && (
                <div aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
                    <div ref={namesRef} className="inline-flex px-0.5 text-[13px]">
                        {tabs.map(tab => (
                            <span key={tab.id} className="whitespace-nowrap px-2.5">{tab.label}</span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TabDock;
