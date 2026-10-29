import React from 'react';

// src/components/panelTab/shell/GroupLine.tsx
// The line between two groups of rows in a panel tab.

/** `col-span-full`：矮而宽时控制页是两栏（见 ControlsTab），分隔线要横跨两栏；不在网格里时这条无效。 */
export const GroupLine: React.FC = () => <div className="col-span-full mx-1 my-2 h-px bg-[var(--st-line)]" />;

export default GroupLine;
