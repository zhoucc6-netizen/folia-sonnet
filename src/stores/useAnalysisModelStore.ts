// src/stores/useAnalysisModelStore.ts
// Whether the listener wants the analysis models, and whether they have been asked yet.
//
// Deliberately only the wish: what is downloaded, how far along it is and whether it is usable is
// modelStore's answer (services/analysis/modelStore.ts), and a setting reads that directly. Keeping
// the download state in two places is how a page ends up showing "ready" over an empty cache.
//
// The models are not in the installer or the APK - they are fetched from the CDN on request, which is
// why "do you want them" is a question at all, and why it is theirs to answer rather than ours.

import { create } from 'zustand';
import {
    ANALYSIS_MODELS_ENABLED,
    ensureModel,
    modelStoreSnapshot,
    refreshModelStore,
    removeModel,
    type DownloadableModel,
} from '../services/analysis/modelStore';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

const ASKED_KEY = 'folia_analysis_models_asked';

const WANT_KEY: Record<DownloadableModel, string> = {
    beat_this: 'folia_analysis_model_beat_this',
    htdemucs: 'folia_analysis_model_htdemucs',
};

export type AnalysisModelState = {
    /** Whether the one-time question has been answered (or put off for good). */
    asked: boolean;
    /** What the listener chose, per model. Enabling one starts its download. */
    beat_this: boolean;
    htdemucs: boolean;
    /** Called by the prompt, and by the settings row when the listener decides there instead. */
    handleSetModelWanted: (name: DownloadableModel, wanted: boolean) => void;
    handleMarkAsked: () => void;
};

export const useAnalysisModelStore = create<AnalysisModelState>((set, get) => ({
    asked: getStoredBoolean(ASKED_KEY, false),
    beat_this: getStoredBoolean(WANT_KEY.beat_this, false),
    htdemucs: getStoredBoolean(WANT_KEY.htdemucs, false),

    handleSetModelWanted: (name, wanted) => {
        setStoredBoolean(WANT_KEY[name], wanted);
        set({ [name]: wanted } as Partial<AnalysisModelState>);
        // The download runs on its own; the row follows it through modelStore. Turning one off gives
        // the space back rather than leaving the file behind a switch that says it is not in use.
        if (wanted) void ensureModel(name);
        else void removeModel(name);
    },

    handleMarkAsked: () => {
        if (get().asked) return;
        setStoredBoolean(ASKED_KEY, true);
        set({ asked: true });
    },
}));

/**
 * Fetches whatever the listener asked for and no longer has.
 *
 * This is not an error path they need to hear about: the cache is the browser's to drop, and a
 * launch that found the switch on with nothing behind it would otherwise leave a feature silently
 * inert - the exact failure the availability hint under 智能动感模式 exists to prevent.
 *
 * Skipped while the models are not offered: nothing points at them then, so a fetch here would be
 * 133MB moving in the background on behalf of a setting nobody can see, and it would keep failing
 * on whatever it was that failed before.
 */
if (ANALYSIS_MODELS_ENABLED) {
    void refreshModelStore().then(() => {
        const state = useAnalysisModelStore.getState();
        for (const name of Object.keys(WANT_KEY) as DownloadableModel[]) {
            if (state[name] && modelStoreSnapshot()[name].phase !== 'ready') void ensureModel(name);
        }
    });
}
