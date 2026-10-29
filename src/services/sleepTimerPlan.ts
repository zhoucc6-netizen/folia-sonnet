// src/services/sleepTimerPlan.ts
// 睡眠定时的「计划」：怎么算截止时刻、这个配置有没有意义。
//
// 抽出来是因为三个地方都要它，而且都不该各自再算一遍：
// - store：开关定时前要判断「有没有设时间」；
// - useSleepTimer：按它排倒计时；
// - 面板那一行：显示还剩多久、显示下一次几点关。
//
// 这里只有纯函数，不碰 store、不读 Date.now()（nowMs 一律由调用方给），便于单独测。

/** 定时的方式：多少分钟后 / 多少小时后 / 到几点。 */
export type SleepTimerMode = 'minutes' | 'hours' | 'clock';

/** 到点之后干什么：暂停播放，还是退出应用。 */
export type SleepTimerEndAction = 'pause' | 'quit';

export type SleepTimerPlan = {
    mode: SleepTimerMode;
    hours: number;
    minutes: number;
    clockHour: number;
    clockMinute: number;
};

/** 「分钟后」的上限：24 小时。再长就该用「定时」了。 */
export const SLEEP_TIMER_MINUTES_MAX = 24 * 60;

/** 「小时后」的上限：24 小时。 */
export const SLEEP_TIMER_HOURS_MAX = 24;

export const clampSleepTimerMinutes = (value: number): number => (
    Math.min(SLEEP_TIMER_MINUTES_MAX, Math.max(0, Math.floor(value) || 0))
);

export const clampSleepTimerHours = (value: number): number => (
    Math.min(SLEEP_TIMER_HOURS_MAX, Math.max(0, Math.floor(value) || 0))
);

export const clampSleepTimerClockHour = (value: number): number => (
    Math.min(23, Math.max(0, Math.floor(value) || 0))
);

export const clampSleepTimerClockMinute = (value: number): number => (
    Math.min(59, Math.max(0, Math.floor(value) || 0))
);

/** 「分钟后」模式显示的总分钟数。小时那位也是它的一部分（>60 分钟会折算进 hours）。 */
export const readSleepTimerTotalMinutes = (plan: SleepTimerPlan): number => plan.hours * 60 + plan.minutes;

/** 时钟模式那两个数拼成 HH:MM，用来显示。 */
export const formatSleepTimerClock = (plan: SleepTimerPlan): string => `${String(plan.clockHour).padStart(2, '0')}:${String(plan.clockMinute).padStart(2, '0')}`;

/**
 * 距离下一次触发还有多少毫秒。
 *
 * 时钟模式取**下一次**到点：设的是 23:00 而现在已经是 23:20，那它就该是明天的 23:00，
 * 而不是一个已经过去的时刻（拿过去的时间当截止点，定时器会在下一帧就触发）。
 */
export const resolveSleepTimerDelayMs = (plan: SleepTimerPlan, nowMs: number): number => {
    if (plan.mode === 'clock') {
        const target = new Date(nowMs);
        target.setHours(clampSleepTimerClockHour(plan.clockHour), clampSleepTimerClockMinute(plan.clockMinute), 0, 0);
        const diff = target.getTime() - nowMs;
        return diff > 0 ? diff : diff + 24 * 60 * 60 * 1000;
    }

    if (plan.mode === 'hours') {
        return clampSleepTimerHours(plan.hours) * 60 * 60 * 1000;
    }

    return clampSleepTimerMinutes(readSleepTimerTotalMinutes(plan)) * 60 * 1000;
};

/** 时钟模式的截止点换算成一个绝对时刻（毫秒）。 */
export const resolveSleepTimerTargetMs = (plan: SleepTimerPlan, nowMs: number): number => nowMs + resolveSleepTimerDelayMs(plan, nowMs);

/**
 * 时钟模式的那个点是不是已经排到了明天。
 *
 * 设的 23:00 而现在 23:20，「下一次 23:00」是明天的，界面上还写「今天 23:00」就是错的 ——
 * 那一行是用户判断「我到底设了什么」的唯一依据。
 */
export const isSleepTimerTargetTomorrow = (plan: SleepTimerPlan, nowMs: number = Date.now()): boolean => {
    if (plan.mode !== 'clock') return false;
    return new Date(resolveSleepTimerTargetMs(plan, nowMs)).getDate() !== new Date(nowMs).getDate();
};

/** 这个配置排得出一个正的时间吗。排不出的定时器不该被允许开起来。 */
export const hasSleepTimerDelay = (plan: SleepTimerPlan, nowMs: number = Date.now()): boolean => (
    resolveSleepTimerDelayMs(plan, nowMs) > 0
);

const pad = (value: number) => String(Math.max(0, Math.floor(value))).padStart(2, '0');

/**
 * 把毫秒数写成倒计时。超过一天时把小时继续往上堆（01:00:00 → 25:00:00），
 * 而不是翻成「1 天」——这一行的宽度只够放数字。
 */
export const formatSleepTimerRemaining = (remainingMs: number): string => {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`;
};
