import type { CommandPaletteCommand } from '../components/command-palette/types';

// src/utils/pinnedCommandPreferences.ts
// Normalizes and persists the three positional command palette shortcuts.
//
// 住在 utils 而不是 components/command-palette：它是 localStorage 的读写与规整，
// 不碰 React，却被 stores/useSettingsModalStore 用（store 不能依赖组件目录）。
// 上面那个 `import type` 是类型边 —— 运行时不存在，也不构成对 UI 的依赖。

export type PinnedCommandIds = [
    string | null,
    string | null,
    string | null,
];

export const PINNED_COMMANDS_STORAGE_KEY = 'command_palette_pinned_commands_v1';
export const DEFAULT_PINNED_COMMAND_IDS: PinnedCommandIds = [
    'playback-prev',
    'playback-next',
    'panel-queue',
];

const cloneDefaults = (): PinnedCommandIds => [...DEFAULT_PINNED_COMMAND_IDS];

export const normalizePinnedCommandIds = (
    value: unknown,
    fallback: PinnedCommandIds = [null, null, null],
): PinnedCommandIds => {
    if (!Array.isArray(value)) {
        return [...fallback];
    }

    const seen = new Set<string>();
    const normalized = Array.from({ length: 3 }, (_, index) => {
        const commandId = value[index];
        if (typeof commandId !== 'string' || commandId.length === 0 || seen.has(commandId)) {
            return null;
        }
        seen.add(commandId);
        return commandId;
    });

    return normalized as PinnedCommandIds;
};

export const readPinnedCommandIds = (): PinnedCommandIds => {
    if (typeof window === 'undefined') {
        return cloneDefaults();
    }

    const storedValue = window.localStorage.getItem(PINNED_COMMANDS_STORAGE_KEY);
    if (storedValue === null) {
        return cloneDefaults();
    }

    try {
        return normalizePinnedCommandIds(JSON.parse(storedValue), cloneDefaults());
    } catch {
        return cloneDefaults();
    }
};

export const writePinnedCommandIds = (commandIds: PinnedCommandIds) => {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(
        PINNED_COMMANDS_STORAGE_KEY,
        JSON.stringify(normalizePinnedCommandIds(commandIds)),
    );
};

export const resolvePinnedCommandSlots = (
    commandIds: PinnedCommandIds,
    availableCommands: CommandPaletteCommand[],
) => commandIds.map(commandId => (
    commandId
        ? availableCommands.find(command => command.id === commandId) ?? null
        : null
));
