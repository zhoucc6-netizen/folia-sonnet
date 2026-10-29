// src/services/analysis/modelAvailability.ts
// Which model weights are actually on disk, as a value the rest of the app can read synchronously.
//
// Every capability question in automix used to be answered with "am I running in Electron", which
// was the same answer as "are the weights here" only because the weights shipped inside the
// installer. They are 249MB of a 436MB download that most listeners never switch the feature on
// for, so they are becoming something a user chooses to fetch - and the moment that is true,
// "Electron" and "has weights" are different questions and the old one is wrong for the common case.
//
// So the whole question here is disk presence, answered in one place. The worker returns the same
// null for "no weights on disk" and "this runtime will not start", and this file deliberately does
// NOT try to tell those apart with a session-long "declined" latch - see `modelCanRun` for why that
// latch was removed and what replaced it. Presence heals when a download lands, so it is re-asked.
//
// Since 2026-10-17 the weights ship inside the installer again (electron/analysis/modelPaths.cjs), so
// in a packaged build every answer is true; false is a checkout without the files, or an install
// missing one. The download history above is why the question is still asked rather than assumed.
//
// A leaf on purpose - it imports nothing from the app. beatThis.ts and stems.ts both read it, and
// stems.ts already imports beatThis.ts, so anything shared between them has to sit below both.
// modelStore.ts is the same kind of leaf (it reads the cache and nothing else), so this can ask it
// without either of them becoming part of the app's graph.

import { modelStoreSnapshot, refreshModelStore, subscribeModelStore } from './modelStore';

/** htdemucs_gpu: htdemucs' WebGPU export, the drum stem of 智能动感模式 (electron/analysis/modelPaths.cjs). */
export type AutomixModelName = 'beat_this' | 'htdemucs' | 'htdemucs_gpu';

export type AutomixModelsPresent = Readonly<Record<AutomixModelName, boolean>>;

/**
 * What the browser build answers forever, and what every build answers until the first check lands.
 *
 * False rather than "unknown", because the two consumers of this turn it into a claim shown to the
 * listener: the engine badge and the 表现模式 switch. Starting at false understates this build for
 * one IPC round trip and then corrects upward; starting at true is a page promising stem separation
 * over an empty directory, which is the exact failure that let a gesture run zero times for a day.
 */
const ABSENT: AutomixModelsPresent = Object.freeze({ beat_this: false, htdemucs: false, htdemucs_gpu: false });

let present: AutomixModelsPresent = ABSENT;

const listeners = new Set<() => void>();

/** Subscribe/getSnapshot in the shape `useSyncExternalStore` wants. */
export const subscribeModelAvailability = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/**
 * The current answer. Never null and never throws, so callers stay one boolean rather than a state.
 *
 * The returned object is only replaced when a value actually changed, which is what lets it be a
 * `useSyncExternalStore` snapshot without re-rendering on every refresh.
 */
export const modelsPresent = (): AutomixModelsPresent => present;

/**
 * Whether this model can run right now. Its weights being on disk is the whole of the question.
 *
 * There is deliberately no "this runtime refused, give up for the session" latch on top of this.
 * That latch was safe only while the weights shipped inside the installer: a run that came back
 * empty with the files present had no explanation left but a runtime that would not start. Once the
 * weights became an optional download the same empty answer started arriving for an ordinary reason
 * - the host restarts the worker on every folder switch and every finished download, and an
 * in-flight request cut off by one of those comes back with nothing. Telling the two apart after the
 * fact meant re-statting disk, which reads wherever the directory points NOW; switch folders or
 * re-download in that window and a transient empty answer latched the model off for good, curable
 * only by relaunching. The worker keeps its own per-process guard against re-initialising a runtime
 * that genuinely failed, which is that same protection without the false positive - so this stays a
 * single question about the files.
 */
export const modelCanRun = (name: AutomixModelName): boolean => present[name];

/**
 * Re-asks where the weights can be. Safe to call at any time and from anywhere; failures leave the
 * last answer in place rather than downgrading a working build on one bad round trip.
 *
 * Two places hold weights now, and this asks about both:
 *
 * - the desktop app's own copy (the installer's models directory), which is what this used to ask
 *   about and the only one that needs `electron`;
 * - the copy this app downloaded from the CDN and cached (modelStore.ts), which is how a build that
 *   ships no weights at all - every mobile one - gets them.
 *
 * `htdemucs_gpu` is not a third file: the WebGPU export is the same `htdemucs-wgsl.bin` the CPU stems
 * read, so wherever that one is, the drum stem of 智能动感模式 can run too.
 */
export const refreshModelAvailability = async (): Promise<AutomixModelsPresent> => {
    // 从「现在这份答案」起算，而不是从 false 起算：一次失败的检查不是「文件没了」的证据，
    // 那条 IPC 通道在窗口重建、主进程忙的时候都会抖一下。旧写法把失败当成「全都没有」，
    // 于是一次抖动就把正在跑的引擎从徽章和表现模式开关里抹掉，直到下一次刷新才回来。
    let beatThis = present.beat_this;
    let htdemucs = present.htdemucs;
    let htdemucsGpu = present.htdemucs_gpu;

    const ask = typeof window !== 'undefined' ? window.electron?.getAutomixModelsPresent : undefined;
    if (typeof ask === 'function') {
        try {
            const answer = await ask();
            if (answer) {
                beatThis = answer.beat_this === true;
                htdemucs = answer.htdemucs === true;
                htdemucsGpu = answer.htdemucs_gpu === true;
            }
        } catch (error) {
            console.warn('[Analysis] could not check which models are installed', error);
        }
    } else {
        // 没有桥就没有宿主那份，只剩下面下载来的那份说了算 —— 这里必须清掉旧答案，
        // 否则「浏览器构建」会沿用上一次（桌面构建时）读到的 true。
        beatThis = false;
        htdemucs = false;
        htdemucsGpu = false;
    }

    // The downloaded copy. Read from the snapshot rather than re-reading the cache: modelStore says
    // when its answer changes, and this is asked often enough that probing disk each time is waste.
    const stored = modelStoreSnapshot();
    const storedBeatThis = stored.beat_this.phase === 'ready';
    const storedHtdemucs = stored.htdemucs.phase === 'ready';
    beatThis = beatThis || storedBeatThis;
    htdemucs = htdemucs || storedHtdemucs;
    htdemucsGpu = htdemucsGpu || storedHtdemucs;

    const next: AutomixModelsPresent = { beat_this: beatThis, htdemucs, htdemucs_gpu: htdemucsGpu };
    if (next.beat_this === present.beat_this && next.htdemucs === present.htdemucs && next.htdemucs_gpu === present.htdemucs_gpu) return present;

    present = Object.freeze(next);
    for (const listener of listeners) listener();
    return present;
};

/**
 * Re-checks disk after a run came back with nothing, so the rest of the app stops believing in an
 * engine whose weights just vanished. The engine badge and the 表现模式 switch are drawn from this.
 *
 * It does NOT disable the model for the session - see `modelCanRun` for why that latch was removed.
 * An empty answer is not evidence the runtime is broken: the worker returns the same nothing when
 * the weights are missing and when an in-flight request was cut off by the worker restarting under
 * it, and both of those heal on their own. So the only thing to do here is make the on-disk answer
 * current again, and say so on the one branch that is actionable - the weights are gone.
 */
export const noteModelFailed = async (name: AutomixModelName): Promise<void> => {
    const stillThere = (await refreshModelAvailability())[name];
    if (!stillThere) console.warn(`[Analysis] ${name} produced nothing and its weights are gone;`
        + ' will use it again if they come back');
};

// Asked once as the module loads, so the answer is usually in hand before anything renders. The
// desktop copy is two `existsSync` calls behind one IPC hop and the downloaded copy is one cache
// match; there is nothing to defer. It is asked here because a launch that never opens the settings
// page ran whole sessions believing it had no weights (see useAutomixDecks).
void refreshModelStore().then(() => refreshModelAvailability());

// A download landing, or the listener deleting one, changes what is on disk - so the answer above has
// to follow it. One direction only: modelStore never asks this file anything, which is what keeps the
// two leaves from becoming a cycle.
if (typeof window !== 'undefined') {
    subscribeModelStore(() => { void refreshModelAvailability(); });
}
