import { Clapperboard } from 'lucide-react';
import type { CommandPaletteCommand } from '../types';
import {
    restoreLyricDirectorSnapshot,
    runLyricDirectorDecision,
} from '../../../services/lyricDirector/director';

// src/components/command-palette/commands/aiDirectorCommands.ts
// The AI lyric animation director's three commands. They reach the service
// directly rather than through a panel prop: the same decision has to be
// reachable from a song change, from the panel tab and from here, and only one
// of those has a component in hand.

type Announce = (text: string) => void;

const report = async (announce: Announce) => {
    const outcome = await runLyricDirectorDecision({ announce: true });
    if (outcome.kind === 'no-song') announce('aiDirector.noSong');
    else if (outcome.kind === 'queued') announce('aiDirector.queued');
    else if (outcome.kind === 'stale') announce('aiDirector.stale');
    /* 手动点的：本机发不出去就说清楚，别让人以为点了没反应。 */
    else if (outcome.kind === 'unavailable') announce('aiDirector.unavailable');
};

export const aiDirectorCommands: CommandPaletteCommand[] = [
    {
        id: 'ai-director-decide',
        group: 'visualizer',
        title: 'AI director: pick this song\'s animation',
        description: 'Let the AI choose and tune the lyric animation for the current song',
        keywords: ['ai', 'director', 'animation', 'visualizer', '动画', '歌词', '导演'],
        icon: Clapperboard,
        scope: 'player-surface',
        execute: async (_input, context) => {
            await report((key) => context.shared.setStatusMsg({
                type: 'info',
                text: context.shared.t(key),
                nonce: Date.now(),
            }));
            return true;
        },
    },
    {
        id: 'ai-director-decide-again',
        group: 'visualizer',
        title: 'AI director: decide this song again',
        description: 'Ignore this song’s memory and ask the AI again',
        keywords: ['ai', 'director', 'again', 'redecide', '重新决策', '重来'],
        icon: Clapperboard,
        scope: 'player-surface',
        execute: async (_input, context) => {
            const announce: Announce = (key) => context.shared.setStatusMsg({
                type: 'info',
                text: context.shared.t(key),
                nonce: Date.now(),
            });
            const outcome = await runLyricDirectorDecision({ announce: true, force: true });
            if (outcome.kind === 'no-song') announce('aiDirector.noSong');
            else if (outcome.kind === 'queued') announce('aiDirector.queued');
            else if (outcome.kind === 'stale') announce('aiDirector.stale');
            else if (outcome.kind === 'unavailable') announce('aiDirector.unavailable');
            return true;
        },
    },
    {
        id: 'ai-director-restore',
        group: 'visualizer',
        title: 'AI director: restore the previous animation settings',
        description: 'Put the mode and parameters back to what they were before the director first changed them',
        keywords: ['ai', 'director', 'restore', 'reset', '恢复', '还原'],
        icon: Clapperboard,
        execute: (_input, context) => {
            context.shared.setStatusMsg({
                type: 'info',
                text: restoreLyricDirectorSnapshot(),
                nonce: Date.now(),
            });
            return true;
        },
    },
];
