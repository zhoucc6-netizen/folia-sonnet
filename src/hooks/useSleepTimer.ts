import { useEffect, useRef } from 'react';
import { runSleepTimerExpiryAction } from './sleepTimerExpiry';
import { useSleepTimerStore } from '../stores/useSleepTimerStore';
import { requestAppExit } from '../platform/foliaNative';
import { hasSleepTimerDelay, resolveSleepTimerDelayMs, type SleepTimerEndAction, type SleepTimerPlan } from '../services/sleepTimerPlan';

// src/hooks/useSleepTimer.ts

type UseSleepTimerState = {
    enabled: boolean;
    plan: SleepTimerPlan;
    endAction: SleepTimerEndAction;
    onExpireFallback: () => void;
};

const TICK_MS = 1000;

/**
 * 三种方式最后都归成一个截止时刻：能用同一套倒计时，也就不必各自担 Broadcasting 一份。
 *
 * 依赖里放具体的数而不是整个 plan 对象：plan 是调用方每次渲染新建的字面量，
 * 直接依赖它会让倒计时每秒重建一次（每次都从零开始数，界面上就是纹丝不动）。
 */
export const useSleepTimer = ({ enabled, plan, endAction, onExpireFallback }: UseSleepTimerState) => {
    const onExpireFallbackRef = useRef(onExpireFallback);
    const endActionRef = useRef(endAction);
    const activationId = useSleepTimerStore(state => state.sleepTimerActivationId);

    useEffect(() => {
        onExpireFallbackRef.current = onExpireFallback;
    }, [onExpireFallback]);

    useEffect(() => {
        endActionRef.current = endAction;
    }, [endAction]);

    const { mode, hours, minutes, clockHour, clockMinute } = plan;

    useEffect(() => {
        // 就地拼而不用外面的 plan 对象：那是每次渲染新建的字面量，放进依赖会让倒计时每秒重建一次
        // （每次都从零开始数，界面上就是那个「明明开了却纹丝不动」的经典 bug）。
        const activePlan: SleepTimerPlan = { mode, hours, minutes, clockHour, clockMinute };
        const now = Date.now();
        if (!enabled || !hasSleepTimerDelay(activePlan, now)) {
            useSleepTimerStore.setState({ sleepTimerDeadlineMs: null });
            return;
        }

        const deadline = now + resolveSleepTimerDelayMs(activePlan, now);
        useSleepTimerStore.setState({ sleepTimerDeadlineMs: deadline });
        const timer = window.setInterval(() => {
            if (Date.now() < deadline) {
                return;
            }
            window.clearInterval(timer);
            useSleepTimerStore.setState({ sleepTimerEnabled: false, sleepTimerDeadlineMs: null });

            void runSleepTimerExpiryAction({
                endAction: endActionRef.current,
                quitApp: requestAppExit,
                onFallback: () => onExpireFallbackRef.current(),
            });
        }, TICK_MS);

        return () => {
            window.clearInterval(timer);
            useSleepTimerStore.setState({ sleepTimerDeadlineMs: null });
        };
    }, [activationId, enabled, mode, hours, minutes, clockHour, clockMinute]);
};
