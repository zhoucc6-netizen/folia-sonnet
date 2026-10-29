// src/stores/useSleepTimerStore.ts
// The sleep timer: how long until it fires, what it does when it fires, plus the armed deadline.
//
// Split out of useSettingsUiStore. The deadline and activation id are runtime state rather than
// settings, which is precisely why they no longer sit in the settings snapshot.
//
// 计划本身（三种方式、两种方式怎么换算）在 src/services/sleepTimerPlan.ts，这里只负责记住
// 用户选了哪一种，并把旧的 hours / minutes 那一对维持住 —— 命令面板那套 UI 还在用它。

import { create } from 'zustand';
import i18n from '../i18n/config';
import { setStatusMessage } from './useStatusMessageStore';
import {
    clampSleepTimerClockHour,
    clampSleepTimerClockMinute,
    clampSleepTimerHours,
    clampSleepTimerMinutes,
    hasSleepTimerDelay,
    readSleepTimerTotalMinutes,
    type SleepTimerEndAction,
    type SleepTimerMode,
    type SleepTimerPlan,
} from '../services/sleepTimerPlan';

export const SLEEP_TIMER_HOURS_STORAGE_KEY = 'sleep_timer_hours';

export const SLEEP_TIMER_MINUTES_STORAGE_KEY = 'sleep_timer_minutes';

export const SLEEP_TIMER_MODE_STORAGE_KEY = 'sleep_timer_mode';

export const SLEEP_TIMER_END_ACTION_STORAGE_KEY = 'sleep_timer_end_action';

/** 时钟那两个数合成一个 `HH:MM` 存，省得两个 key 各自漂移。 */
export const SLEEP_TIMER_CLOCK_STORAGE_KEY = 'sleep_timer_clock';

/** 从没配过时长时的兜底：30 分钟。 */
const DEFAULT_SLEEP_TIMER_MINUTES = 30;

const readStoredSleepTimerPart = (key: string, max: number): number => {
    if (typeof window === 'undefined') {
        return 0;
    }

    const saved = Number(localStorage.getItem(key));
    return Number.isInteger(saved) && saved >= 0 && saved <= max ? saved : 0;
};

const readStoredSleepTimerHours = () => readStoredSleepTimerPart(SLEEP_TIMER_HOURS_STORAGE_KEY, 999);

const readStoredSleepTimerMinutes = () => readStoredSleepTimerPart(SLEEP_TIMER_MINUTES_STORAGE_KEY, 59);

const readStoredSleepTimerMode = (): SleepTimerMode => {
    if (typeof window === 'undefined') {
        return 'minutes';
    }

    const saved = localStorage.getItem(SLEEP_TIMER_MODE_STORAGE_KEY);
    return saved === 'hours' || saved === 'clock' ? saved : 'minutes';
};

const readStoredSleepTimerEndAction = (): SleepTimerEndAction => {
    if (typeof window === 'undefined') {
        return 'pause';
    }

    return localStorage.getItem(SLEEP_TIMER_END_ACTION_STORAGE_KEY) === 'quit' ? 'quit' : 'pause';
};

/** `HH:MM` 还原成两个数；没存过给 23:00（一个不用解释的默认值）。 */
/*
 * 这里的键名必须和 `SleepTimerState` 里的字段名一致 —— 返回值是整体展开进 store 的
 * （见下面 return 里的 `...readStoredSleepTimerClock()`），叫 clockHour 只会多出两个
 * 没人读的字段，真正的 sleepTimerClockHour / sleepTimerClockMinute 反而一直是 undefined。
 */
const readStoredSleepTimerClock = (): { sleepTimerClockHour: number; sleepTimerClockMinute: number } => {
    const raw = typeof window === 'undefined' ? null : localStorage.getItem(SLEEP_TIMER_CLOCK_STORAGE_KEY);
    const matched = raw ? /^(\d{1,2}):(\d{2})$/.exec(raw) : null;
    if (!matched) {
        return { sleepTimerClockHour: 23, sleepTimerClockMinute: 0 };
    }
    return {
        sleepTimerClockHour: clampSleepTimerClockHour(Number(matched[1])),
        sleepTimerClockMinute: clampSleepTimerClockMinute(Number(matched[2])),
    };
};

const writeStoredValue = (key: string, value: string) => {
    if (typeof window === 'undefined') {
        return;
    }
    localStorage.setItem(key, value);
};

export type SleepTimerState = {
    sleepTimerEnabled: boolean;
    sleepTimerHours: number;
    sleepTimerMinutes: number;
    sleepTimerMode: SleepTimerMode;
    sleepTimerClockHour: number;
    sleepTimerClockMinute: number;
    sleepTimerEndAction: SleepTimerEndAction;
    sleepTimerDeadlineMs: number | null;
    sleepTimerActivationId: number;
    handleToggleSleepTimer: (enable: boolean) => void;
    handleSetSleepTimerHours: (hours: number) => void;
    handleSetSleepTimerMinutes: (minutes: number) => void;
    handleSetSleepTimerMode: (mode: SleepTimerMode) => void;
    handleSetSleepTimerTotalMinutes: (minutes: number) => void;
    handleSetSleepTimerClock: (clockHour: number, clockMinute: number) => void;
    handleSetSleepTimerEndAction: (action: SleepTimerEndAction) => void;
};

export const useSleepTimerStore = create<SleepTimerState>((set, get) => {
    /** 取出当前这份计划（给 sleepTimerPlan 那边的纯函数用）。 */
    const currentPlan = (): SleepTimerPlan => {
        const state = get();
        return {
            mode: state.sleepTimerMode,
            hours: state.sleepTimerHours,
            minutes: state.sleepTimerMinutes,
            clockHour: state.sleepTimerClockHour,
            clockMinute: state.sleepTimerClockMinute,
        };
    };

    /** 改完配置后：排不出时间的就把定时器放下，别让它开着看起来像在工作。 */
    const autoDisableWhenEmpty = () => {
        if (get().sleepTimerEnabled && !hasSleepTimerDelay(currentPlan())) {
            set({ sleepTimerEnabled: false, sleepTimerDeadlineMs: null });
        }
    };

    /** 时钟那两个数合成一个 `HH:MM`，免得两个 key 各自漂移。 */
    const writeClock = (clockHour: number, clockMinute: number) => {
        writeStoredValue(
            SLEEP_TIMER_CLOCK_STORAGE_KEY,
            `${String(clampSleepTimerClockHour(clockHour)).padStart(2, '0')}:${String(clampSleepTimerClockMinute(clockMinute)).padStart(2, '0')}`,
        );
    };

    /**
     * 从没填过时长就先给 30 分钟：控制页那一行会带着禁用的开关出场，看着像坏了，
     * 而「定时关闭」本来就该是能直接用的一步操作，不是先配后开的设备。
     */
    const storedHours = readStoredSleepTimerHours();
    const storedMinutes = readStoredSleepTimerMinutes();
    const hasStoredDuration = storedHours > 0 || storedMinutes > 0;

    return {
        // A sleep timer is a one-shot action. Persist its preferred duration, never an armed state.
        sleepTimerEnabled: false,
        sleepTimerHours: storedHours,
        sleepTimerMinutes: hasStoredDuration ? storedMinutes : DEFAULT_SLEEP_TIMER_MINUTES,
        sleepTimerMode: readStoredSleepTimerMode(),
        ...readStoredSleepTimerClock(),
        sleepTimerEndAction: readStoredSleepTimerEndAction(),
        sleepTimerDeadlineMs: null,
        sleepTimerActivationId: 0,
        handleToggleSleepTimer: (enable) => {
            if (enable && !hasSleepTimerDelay(currentPlan())) {
                setStatusMessage({
                    type: 'error',
                    text: i18n.t('commandPalette.sleepTimerDurationRequired'),
                });
                return;
            }
            set(state => ({
                sleepTimerEnabled: enable,
                // Every explicit activation starts a fresh countdown, even when its duration is unchanged.
                sleepTimerActivationId: enable
                    ? state.sleepTimerActivationId + 1
                    : state.sleepTimerActivationId,
            }));
            setStatusMessage({
                type: 'info',
                text: i18n.t('notifications.' + (enable ? 'sleepTimerOn' : 'sleepTimerOff')),
            });
        },
        handleSetSleepTimerHours: (hours) => {
            const clamped = clampSleepTimerHours(hours);
            writeStoredValue(SLEEP_TIMER_HOURS_STORAGE_KEY, String(clamped));
            set({ sleepTimerHours: clamped });
            autoDisableWhenEmpty();
        },
        handleSetSleepTimerMinutes: (minutes) => {
            const clamped = Math.min(59, Math.max(0, Math.floor(minutes) || 0));
            writeStoredValue(SLEEP_TIMER_MINUTES_STORAGE_KEY, String(clamped));
            set({ sleepTimerMinutes: clamped });
            autoDisableWhenEmpty();
        },
        /**
         * 「分钟后」那一行用：分钟可以超过 59，多出来的折算成小时。
         *
         * 底下那一对 hours / minutes 是命令面板那套 UI 的形状，两者必须始终是同一段时间，
         * 否则面板上写着「90 分钟后」，别处读出来却是 1 小时 30 分之外的值。
         */
        handleSetSleepTimerTotalMinutes: (minutes) => {
            const clamped = clampSleepTimerMinutes(minutes);
            writeStoredValue(SLEEP_TIMER_HOURS_STORAGE_KEY, String(Math.floor(clamped / 60)));
            writeStoredValue(SLEEP_TIMER_MINUTES_STORAGE_KEY, String(clamped % 60));
            set({ sleepTimerHours: Math.floor(clamped / 60), sleepTimerMinutes: clamped % 60 });
            autoDisableWhenEmpty();
        },
        handleSetSleepTimerMode: (mode) => {
            writeStoredValue(SLEEP_TIMER_MODE_STORAGE_KEY, mode);
            if (mode === 'minutes') {
                // 原来的时长整段留着（1 小时 → 60 分钟），换方式不该把已经填好的数丢掉。
                const carried = clampSleepTimerMinutes(readSleepTimerTotalMinutes(currentPlan()));
                get().handleSetSleepTimerTotalMinutes(carried > 0 ? carried : 30);
                set({ sleepTimerMode: 'minutes' });
                return;
            }
            if (mode === 'hours') {
                // 只按小时算，分钟那位必须清掉，否则界面显示「2 小时」实际是 2 小时 30 分。
                const hours = clampSleepTimerHours(Math.round(readSleepTimerTotalMinutes(currentPlan()) / 60));
                writeStoredValue(SLEEP_TIMER_MINUTES_STORAGE_KEY, '0');
                writeStoredValue(SLEEP_TIMER_HOURS_STORAGE_KEY, String(hours));
                set({ sleepTimerMode: 'hours', sleepTimerHours: hours, sleepTimerMinutes: 0 });
                autoDisableWhenEmpty();
                return;
            }
            set({ sleepTimerMode: 'clock' });
        },
        handleSetSleepTimerClock: (clockHour, clockMinute) => {
            const nextHour = clampSleepTimerClockHour(clockHour);
            const nextMinute = clampSleepTimerClockMinute(clockMinute);
            writeClock(nextHour, nextMinute);
            set({ sleepTimerClockHour: nextHour, sleepTimerClockMinute: nextMinute });
        },
        handleSetSleepTimerEndAction: (action) => {
            writeStoredValue(SLEEP_TIMER_END_ACTION_STORAGE_KEY, action);
            set({ sleepTimerEndAction: action });
        },
    };
});

/**
 * The SleepTimer half of the former settings snapshot, for the surfaces that
 * legitimately edit this whole domain at once. Ordinary consumers select one field instead.
 */
export const selectSleepTimerSnapshot = (state: SleepTimerState) => ({
    sleepTimerEnabled: state.sleepTimerEnabled,
    sleepTimerHours: state.sleepTimerHours,
    sleepTimerMinutes: state.sleepTimerMinutes,
    sleepTimerMode: state.sleepTimerMode,
    sleepTimerClockHour: state.sleepTimerClockHour,
    sleepTimerClockMinute: state.sleepTimerClockMinute,
    sleepTimerEndAction: state.sleepTimerEndAction,
    sleepTimerDeadlineMs: state.sleepTimerDeadlineMs,
    sleepTimerActivationId: state.sleepTimerActivationId,
    handleToggleSleepTimer: state.handleToggleSleepTimer,
    handleSetSleepTimerHours: state.handleSetSleepTimerHours,
    handleSetSleepTimerMinutes: state.handleSetSleepTimerMinutes,
    handleSetSleepTimerMode: state.handleSetSleepTimerMode,
    handleSetSleepTimerTotalMinutes: state.handleSetSleepTimerTotalMinutes,
    handleSetSleepTimerClock: state.handleSetSleepTimerClock,
    handleSetSleepTimerEndAction: state.handleSetSleepTimerEndAction,
});
