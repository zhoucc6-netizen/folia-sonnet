// src/services/analysis/modelStore.ts
// 模型权重的按需获取，平台无关：CDN 下载 → sha256 校验 → 存进 Cache Storage → 之后从这里读。
//
// 为什么要有这一层：两个权重文件一共 133MB。随安装包附带意味着每个安装包、每个 APK 都要背上
// 它们，而大多数听众从来不开 automix / 智能动感模式。上游那条路是 electron 主进程读 models
// 目录（electron/analysis/modelPaths.cjs），安卓根本没有主进程可读 —— 在 Capacitor 上永远不通，
// 于是那几项能力在安卓上永远显示「仅桌面版」。
//
// 所以改成：不打包进产物，要用的时候从 CDN 下一份，本地存一份，以后直接用。
//
// 校验是这一层的重点，不是顺手加的：shared/modelManifest.json 的注释记过四次「权重下载完整但
// 加载出来是错的」—— 截断的、被镜像替换掉的模型不会报错，它会自信地给出错的节拍，日志里什么
// 都看不出来。所以每个文件下载完必须对 sha256，对不上就当没下过。
//
// 两个文件各服务两处（beat_this：automix 的节拍网格 + 智能动感模式的节拍；htdemucs：automix 的
// 四轨分离 + 智能动感模式的鼓点），所以这里只有两个条目，不是四个。

/** The weights this app can fetch. `htdemucs_gpu` is the same file as `htdemucs` - see modelAvailability. */
export type DownloadableModel = 'beat_this' | 'htdemucs';

/** Where the weights are hosted. They are not in the installer or the APK; this is the only source. */
export const MODEL_CDN_BASE = 'https://cdn.tangbot.xyz/automix';

/** The cache that holds them once downloaded, so a second launch costs nothing. */
const CACHE_NAME = 'folia-automix-models';

type FileSpec = {
    file: string;
    /** Exactly the size in shared/modelManifest.json: a shorter file is a failed download, not a model. */
    bytes: number;
    sha256: string;
};

/**
 * Copied from shared/modelManifest.json rather than imported from it: that file is JSON the build
 * reads (build/fetchModels.mjs), and importing it would pull every model's notes into the web
 * bundle. The two must stay in step - the hash is what makes a downloaded file trustworthy.
 */
const FILES: Record<DownloadableModel, FileSpec> = {
    beat_this: {
        file: 'beat_this-wgsl.bin',
        bytes: 41102271,
        sha256: '6365ae5ba2e42922772da01fbfd0bde8dd20b7362a679018e78a5f251fe8a967',
    },
    htdemucs: {
        file: 'htdemucs-wgsl.bin',
        bytes: 91838176,
        sha256: '27d5331a74a4e23b18172b3d59d0378e698fd79bc0d0fed3316da77e3a37d8d1',
    },
};

/**
 * 分析模型的总开关：现在关着。
 *
 * 三处入口都读这一个常量 —— 启动时的询问、设置里那一组、以及启动时把「上次选了」的模型补回来的
 * 那次自愈；下面取权重、算 sha256、判能力的代码一行不动。要重开，改这一行就够了。
 *
 * 关着是因为它在目标机器上还没跑通过：下了也能导入，但手机上的 WebGPU 不是每个 WebView 都有，
 * 没有它这些一样都跑不起来。一个按下去不会有任何事的开关，比没有这个开关更糟 —— 它先答应，然后
 * 一直坐在那里。要重开，就拿着真机验过再开，别靠推理。
 *
 * 什么都没删：听者选过的保留在设置里，已经下好的权重留在缓存里，所以再打开不是从零开始；桌面端
 * 随包带的权重与它无关，照样可用。
 */
export const ANALYSIS_MODELS_ENABLED = false;

/** What one model is doing, for a setting to draw. */
export type ModelPhase =
    /** Not downloaded, and nothing is happening. */
    | 'absent'
    /** Re-reading the cache, at startup and after anything writes it. */
    | 'checking'
    /** Downloading; `progress` runs 0..1. */
    | 'downloading'
    /** In the cache and verified. */
    | 'ready'
    /** The last attempt failed; `error` says why in one line. */
    | 'error';

export type ModelEntry = {
    phase: ModelPhase;
    /** 0..1 while downloading, 1 when ready, 0 otherwise. */
    progress: number;
    /** Bytes held, once known. */
    bytes: number;
    /** One line, already human-readable, when `phase` is 'error'. */
    error?: string;
};

export type ModelStoreSnapshot = Readonly<Record<DownloadableModel, Readonly<ModelEntry>>>;

const ABSENT: ModelEntry = { phase: 'absent', progress: 0, bytes: 0 };

let snapshot: ModelStoreSnapshot = Object.freeze({ beat_this: ABSENT, htdemucs: ABSENT });

const listeners = new Set<() => void>();

/** Subscribe/getSnapshot in the shape `useSyncExternalStore` wants. */
export const subscribeModelStore = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const modelStoreSnapshot = (): ModelStoreSnapshot => snapshot;

const patch = (name: DownloadableModel, next: Partial<ModelEntry>): void => {
    const merged = { ...snapshot[name], ...next };
    const current = snapshot[name];
    if (merged.phase === current.phase && merged.progress === current.progress
        && merged.bytes === current.bytes && merged.error === current.error) return;
    snapshot = Object.freeze({ ...snapshot, [name]: Object.freeze(merged) }) as ModelStoreSnapshot;
    for (const listener of listeners) listener();
};

/** The URL a file is fetched from, and the key it is cached under - one string, so they cannot drift. */
const urlOf = (name: DownloadableModel): string => `${MODEL_CDN_BASE}/${FILES[name].file}`;

/**
 * The key its size is cached under, next to the file itself.
 *
 * A query and NOT a fragment: `cache.put()` and `cache.match()` both drop everything after a '#', so
 * two URLs differing only in their fragment are the same key here - the meta and the weights would
 * overwrite each other, and did. The symptom was a model read back as 18 bytes, which is exactly how
 * long `{"bytes":91838176}` is: the file in the cache was its own size note.
 *
 * Needed because a cached `Response` will not reliably give its length back: the header is not
 * guaranteed to survive, and asking the body means reading 133MB at every startup to learn a number.
 * So the size is written beside the file and read instead; the file's own presence is still asked
 * from the cache, so a cleared cache takes the entry with it and this says absent.
 */
const metaUrlOf = (name: DownloadableModel): string => `${urlOf(name)}?folia-meta=size`;

const readMeta = async (cache: Cache, name: DownloadableModel): Promise<number> => {
    try {
        const meta = await cache.match(metaUrlOf(name));
        if (!meta) return 0;
        const parsed: unknown = JSON.parse(await meta.text());
        return typeof parsed === 'object' && parsed !== null && 'bytes' in parsed
            ? Number((parsed as { bytes: unknown }).bytes)
            : 0;
    } catch {
        return 0;
    }
};

const openCache = async (): Promise<Cache | null> => {
    if (typeof caches === 'undefined') return null;
    try {
        return await caches.open(CACHE_NAME);
    } catch (error) {
        console.warn('[Models] no cache storage here', error);
        return null;
    }
};

const toHex = (buffer: ArrayBuffer): string => Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

/** Null when the digest cannot be computed (no WebCrypto); the caller decides what that means. */
const sha256Of = async (file: Uint8Array): Promise<string | null> => {
    if (typeof crypto === 'undefined' || !crypto.subtle?.digest) return null;
    try {
        return toHex(await crypto.subtle.digest('SHA-256', file as BufferSource));
    } catch (error) {
        console.warn('[Models] could not hash the download', error);
        return null;
    }
};

/**
 * `[tensors][manifest JSON]["FOLIABTW"][uint64 LE offset of the JSON]`, the layout written by
 * build/beat_this_wgsl/export_weights.py and read on the desktop side by
 * electron/analysis/packedWeights.cjs. The same file is read by both runtimes there and here, which
 * is why this has to agree with it byte for byte.
 */
const MAGIC = 'FOLIABTW';
const TRAILER = MAGIC.length + 8;

const unpackWeights = (file: Uint8Array<ArrayBuffer>): { weights: Uint8Array<ArrayBuffer>; manifest: unknown } | null => {
    try {
        if (file.byteLength < TRAILER) return null;
        const magic = String.fromCharCode(...file.subarray(file.byteLength - TRAILER, file.byteLength - 8));
        if (magic !== MAGIC) return null;
        const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
        const at = Number(view.getBigUint64(file.byteLength - 8, true));
        if (!(at > 0 && at < file.byteLength - TRAILER)) return null;
        const manifest = JSON.parse(new TextDecoder().decode(file.subarray(at, file.byteLength - TRAILER)));
        // The manifest's own `bytes` must equal where it starts: a file cut short, or two exports
        // glued together, fails here rather than as confidently wrong beats.
        if (!manifest || typeof manifest.bytes !== 'number' || manifest.bytes !== at) return null;
        return { weights: file.subarray(0, at), manifest };
    } catch (error) {
        console.warn('[Models] the download is not a packed export', error);
        return null;
    }
};

/**
 * The cached weights, unpacked, or null when they are not there or are not usable.
 *
 * The desktop app's own packed copy is tried first when it exists: an install that still ships the
 * files should keep using them rather than pull 133MB it already has.
 */
export const readModelWeights = async (
    name: DownloadableModel,
): Promise<{ weights: Uint8Array<ArrayBuffer>; manifest: unknown } | null> => {
    const cache = await openCache();
    if (!cache) return null;
    try {
        const cached = await cache.match(urlOf(name));
        if (!cached) return null;
        const file = new Uint8Array(await cached.arrayBuffer());
        if (file.byteLength !== FILES[name].bytes) {
            console.warn(`[Models] ${name} is ${file.byteLength} bytes, expected ${FILES[name].bytes}; discarding`);
            await cache.delete(urlOf(name)).catch(() => undefined);
            return null;
        }
        return unpackWeights(file);
    } catch (error) {
        console.warn(`[Models] could not read ${name} from the cache`, error);
        return null;
    }
};

/** One download at a time per model, so a settings toggle tapped twice does not fetch 133MB twice. */
const inFlight = new Map<DownloadableModel, Promise<boolean>>();

/**
 * Keeps a file that has already been checked: into the cache, and the entry told it is ready.
 *
 * One place because the checks are the expensive part and the writing is not, and because a file
 * arrives by two routes now - fetched from the CDN, or handed over by the listener - that have to end
 * up in exactly the same state.
 */
const keep = async (name: DownloadableModel, file: Uint8Array): Promise<boolean> => {
    const cache = await openCache();
    if (!cache) {
        patch(name, { phase: 'error', progress: 0, error: '这个环境没有可用的缓存存储' });
        return false;
    }
    // TS 5.7 起 `Response` 只收 `Uint8Array<ArrayBuffer>`；缓存里存的是同一段字节，转一次类型即可。
    await cache.put(urlOf(name), new Response(file as unknown as BodyInit, { headers: { 'content-type': 'application/octet-stream' } }));
    await cache.put(metaUrlOf(name), new Response(JSON.stringify({ bytes: file.byteLength })));
    patch(name, { phase: 'ready', progress: 1, bytes: file.byteLength, error: undefined });
    return true;
};

/**
 * Takes the weights from a file the listener picked instead of from the CDN.
 *
 * Verified in exactly the same way as a download: a file is no more trustworthy for having been
 * chosen by hand. It may be a different export than this version reads, or half of one, and either
 * would load and answer confidently and wrongly - the failure this file's hashing exists to prevent.
 *
 * True when the file is now the one this app will use.
 */
export const importModelFile = async (name: DownloadableModel, bytes: ArrayBuffer): Promise<boolean> => {
    patch(name, { phase: 'checking', error: undefined });
    const file = new Uint8Array(bytes);
    if (file.byteLength !== FILES[name].bytes) {
        patch(name, { phase: 'error', progress: 0, error: `文件大小不对（${file.byteLength} / ${FILES[name].bytes}）` });
        return false;
    }
    const hash = await sha256Of(file);
    if (hash === null) {
        patch(name, { phase: 'error', progress: 0, error: '这个环境无法校验文件（需要 WebCrypto）' });
        return false;
    }
    if (hash !== FILES[name].sha256) {
        patch(name, { phase: 'error', progress: 0, error: '文件校验不通过，已丢弃' });
        return false;
    }
    return keep(name, file);
};

/**
 * Makes sure the weights are in the cache, downloading them if they are not.
 *
 * True when they are there afterwards. A failure leaves the entry on 'error' with the reason rather
 * than retrying in a loop: the listener has to ask again (the switch, the next launch), and a network
 * that is down now is not something this can fix by trying harder.
 */
export const ensureModel = async (name: DownloadableModel): Promise<boolean> => {
    const running = inFlight.get(name);
    if (running) return running;

    const job = (async () => {
        if (snapshot[name].phase === 'ready') return true;
        patch(name, { phase: 'downloading', progress: 0, error: undefined });

        const cache = await openCache();
        if (!cache) {
            patch(name, { phase: 'error', progress: 0, error: '这个环境没有可用的缓存存储' });
            return false;
        }

        try {
            const response = await fetch(urlOf(name));
            if (!response.ok) {
                patch(name, { phase: 'error', progress: 0, error: `下载失败（HTTP ${response.status}）` });
                return false;
            }

            // Streamed so a setting can draw progress: 133MB with no feedback looks like a hang.
            const total = Number(response.headers.get('content-length')) || FILES[name].bytes;
            const body = response.body;
            let file: Uint8Array;
            if (body) {
                const reader = body.getReader();
                const chunks: Uint8Array[] = [];
                let received = 0;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    received += value.byteLength;
                    patch(name, { progress: Math.min(1, received / total) });
                }
                file = new Uint8Array(received);
                let at = 0;
                for (const chunk of chunks) { file.set(chunk, at); at += chunk.byteLength; }
            } else {
                file = new Uint8Array(await response.arrayBuffer());
            }

            if (file.byteLength !== FILES[name].bytes) {
                patch(name, { phase: 'error', progress: 0, error: `文件大小不对（${file.byteLength} / ${FILES[name].bytes}）` });
                return false;
            }

            const hash = await sha256Of(file);
            if (hash === null) {
                // No WebCrypto to check with. Accepting an unverified model is the one thing this
                // file exists to prevent, so it is a failure - with the reason said, not a shrug.
                patch(name, { phase: 'error', progress: 0, error: '这个环境无法校验文件（需要 WebCrypto）' });
                return false;
            }
            if (hash !== FILES[name].sha256) {
                patch(name, { phase: 'error', progress: 0, error: '文件校验不通过，已丢弃' });
                return false;
            }

            return keep(name, file);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // A fetch the browser refused throws a TypeError carrying no detail whatsoever: "Failed
            // to fetch" is all it says, and it says it for a missing CORS header, a dead host and a
            // rejected certificate alike - three faults with nothing in common but this string. The
            // header is by far the likeliest of them for a file served from someone's own host, so it
            // is named here rather than left for the listener to guess at from a bare error.
            const reason = /failed to fetch|load failed|networkerror/i.test(message)
                ? `${message}（多半是服务器没给 Access-Control-Allow-Origin 头）`
                : message;
            patch(name, { phase: 'error', progress: 0, error: `下载失败：${reason}` });
            return false;
        } finally {
            inFlight.delete(name);
        }
    })();

    inFlight.set(name, job);
    return job;
};

/** Drops the cached file, for "turn this off and give the space back". */
export const removeModel = async (name: DownloadableModel): Promise<void> => {
    const cache = await openCache();
    if (cache) {
        await cache.delete(urlOf(name)).catch(() => undefined);
        await cache.delete(metaUrlOf(name)).catch(() => undefined);
    }
    patch(name, { phase: 'absent', progress: 0, bytes: 0, error: undefined });
};

/**
 * Re-reads the cache and reports what is really in it. Asked at startup and after anything writes it.
 *
 * Presence is judged from the response's own length, not by unpacking: this runs at every startup,
 * and reading 133MB into memory to look at a trailer is a startup cost nobody asked for. The file was
 * hashed on the way in, and `readModelWeights` unpacks it (magic, manifest offset, `bytes`) before
 * any runtime sees it - so a cache edited since then fails there, at the point where being wrong
 * would matter.
 */
export const refreshModelStore = async (): Promise<ModelStoreSnapshot> => {
    for (const name of Object.keys(FILES) as DownloadableModel[]) {
        if (snapshot[name].phase === 'downloading') continue;
        patch(name, { phase: 'checking' });
        const cache = await openCache();
        let bytes = 0;
        if (cache) {
            try {
                const cached = await cache.match(urlOf(name));
                if (cached) {
                    const declared = await readMeta(cache, name);
                    if (declared === FILES[name].bytes) bytes = declared;
                    else await removeModel(name);
                }
            } catch (error) {
                console.warn(`[Models] could not inspect ${name}`, error);
            }
        }
        patch(name, bytes > 0
            ? { phase: 'ready', progress: 1, bytes, error: undefined }
            : { phase: 'absent', progress: 0, bytes: 0, error: undefined });
    }
    return snapshot;
};
