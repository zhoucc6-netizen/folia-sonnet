import type { ModRuntimeInfo } from '../types';
import { isAiConfigured, readAiSettings } from '../../services/aiSettings';
import {
    describeAiTarget,
    requestAiCompletion,
    type AiCompletionRequest,
} from '../../services/aiCompletion';
import type {
    FoliumAiCompletionRequest,
    FoliumAiCompletionResult,
    FoliumAiService,
    FoliumContextKind,
} from './contract';

// src/mods/folium/ai.ts
// `folium.ai`: one prompt through the AI service the user configured in the
// host's own AI settings, so a mod never has to hold a credential of its own.
//
// The transport lives in services/aiCompletion, shared with the built-in AI
// lyric animation director: same credentials, same endpoint quirks, and
// Settings → AI stays the single place to configure it. What this file adds is
// the mod contract — the permission gate and the context gate — and nothing
// else.
//
// The request goes out from whichever window the mod runs in, which is also what
// lets an Android build reach an endpoint at all: it has no Node main process,
// and a plain fetch from its WebView is stopped by CORS.
//
// The credential never leaves the shared service: read per request, handed
// straight to the transport, and absent from every result, error and log line.
// A mod can ask whether one is configured — it can never read it back.

const AI_PERMISSION = 'ai.request';

const toCompletionRequest = (request: FoliumAiCompletionRequest): AiCompletionRequest => ({
    system: request.system,
    prompt: request.prompt,
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.json === undefined ? {} : { json: request.json }),
    ...(request.signal ? { signal: request.signal } : {}),
});

export const createFoliumAiService = (mod: ModRuntimeInfo, context: FoliumContextKind): FoliumAiService => Object.freeze({
    isConfigured: () => isAiConfigured(readAiSettings()),
    describe: () => describeAiTarget(),
    complete: async (request: FoliumAiCompletionRequest): Promise<FoliumAiCompletionResult> => {
        if (!mod.permissions.includes(AI_PERMISSION)) {
            throw new Error(`permission-denied:${AI_PERMISSION}`);
        }
        if (context !== 'main') throw new Error(`ai-unavailable-in-${context}-context`);
        if (!request || typeof request.system !== 'string' || typeof request.prompt !== 'string') {
            throw new Error('ai-complete requires { system: string, prompt: string }');
        }
        return requestAiCompletion(toCompletionRequest(request));
    },
});
