// src/services/foliaCloud.ts
// 云服务地址与开关。云缓存（AI 主题 / AI 导演的结果复用）和字体市场共用同一份配置：
// 它们是同一个后端提供的两项能力，用户只需要填一次地址。
//
// 默认指向官方那个地址，自建的用户把地址换成自己的即可。

/*
 * 换过一次键名，别再换回来。
 *
 * 这个开关出厂就是开的，但老版本把它存成了「关」—— 那些值已经躺在用户的
 * localStorage 里了。沿用旧键名的话，读出来的是老版本那个 false，代码里写的
 * 「默认打开」根本轮不上生效，升级上来的用户等于没这个功能。
 *
 * 所以这里挂个 v2：读不到新键 = 第一次用这个版本 = 走默认值（开）。
 * 以后再改默认值，同理再升一位。
 */
const STORAGE_KEY = 'foliaCloudSettings.v2';
export const FOLIA_CLOUD_SETTINGS_CHANGED_EVENT = 'folia-ai-cloud-cache-settings-changed';

export const DEFAULT_CLOUD_BASE_URL = 'https://apif.tangbot.xyz';

export interface FoliaCloudSettings {
    /** 云缓存开关。默认打开 —— 没填 Key 的人也能靠它拿到主题。 */
    enabled: boolean;
    /** 云服务地址（不含 /api）。 */
    baseUrl: string;
}

export const DEFAULT_FOLIA_CLOUD_SETTINGS: FoliaCloudSettings = {
    enabled: true,
    baseUrl: DEFAULT_CLOUD_BASE_URL,
};

let cachedSettings: FoliaCloudSettings | null = null;
let settingsVersion = 0;
const listeners = new Set<() => void>();

const normalizeBaseUrl = (value: unknown): string => {
    const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    // A bare host is the common hand-typed case; the API always lives under /api.
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

export const readFoliaCloudSettings = (): FoliaCloudSettings => {
    if (cachedSettings) return { ...cachedSettings };
    let parsed: Partial<FoliaCloudSettings> | null = null;
    if (typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) parsed = JSON.parse(raw) as Partial<FoliaCloudSettings>;
        } catch {
            parsed = null;
        }
    }
    cachedSettings = {
        enabled: parsed?.enabled === undefined ? true : parsed.enabled !== false,
        baseUrl: normalizeBaseUrl(parsed?.baseUrl) || DEFAULT_CLOUD_BASE_URL,
    };
    return { ...cachedSettings };
};

export const updateFoliaCloudSettings = (patch: Partial<FoliaCloudSettings>): FoliaCloudSettings => {
    const current = readFoliaCloudSettings();
    const next: FoliaCloudSettings = {
        enabled: patch.enabled === undefined ? current.enabled : patch.enabled !== false,
        baseUrl: patch.baseUrl === undefined
            ? current.baseUrl
            : (normalizeBaseUrl(patch.baseUrl) || DEFAULT_CLOUD_BASE_URL),
    };
    cachedSettings = next;
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Quota or private mode: the session value still applies.
        }
    }
    settingsVersion += 1;
    listeners.forEach(listener => listener());
    return { ...next };
};

export const subscribeFoliaCloudSettings = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const getFoliaCloudSettingsVersion = (): number => settingsVersion;

export const isFoliaCloudCacheEnabled = (): boolean => readFoliaCloudSettings().enabled;

export const resolveCloudBaseUrl = (): string => readFoliaCloudSettings().baseUrl;

/** `<base>/api/<path>`，`path` 里不要带前导斜杠。 */
export const resolveCloudApiUrl = (path: string): string => (
    `${resolveCloudBaseUrl()}/api/${String(path).replace(/^\/+/, '')}`
);
