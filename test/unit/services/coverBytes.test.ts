// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/coverBytes.test.ts
// 「把封面交给原生」那两处（原生歌词壁纸的模糊底图、通知栏的 Bitmap）只在乎拿到像素。
// 这里钉的是**取字节那三条路的顺序**，不是图片本身：
//
//   1. 页内匿名 fetch —— 封面图床不需要 cookie，而带凭据的请求会被「回通配符」的图床
//      直接判死（带凭据时通配符不作数），那正是壁纸 / 通知栏常年没有封面的来处；
//   2. 原生 OkHttp —— 没有同源这一说，压根不下发 CORS 头的那几个 CDN 只有这条路；
//   3. 带凭据的页内请求 —— 自建服务那类「要 cookie 才给图」的地址，且没有原生桥时。

const { handlers } = vi.hoisted(() => ({
    handlers: {
        nativeAvailable: false,
        nativeFetch: null as null | ((url: string, init?: RequestInit) => Promise<Response>),
    },
}));

vi.mock('@/services/nativeHttpFetch', () => ({
    isNativeHttpFetchAvailable: () => handlers.nativeAvailable,
    createNativeFetch: () => (input: RequestInfo | URL, init?: RequestInit) =>
        (handlers.nativeFetch as NonNullable<typeof handlers.nativeFetch>)(String(input), init),
}));

const { fetchCoverBytes } = await import('@/services/coverBytes');

const COVER_URL = 'https://picture.example.com/abc.jpg';

/** 一个够用的响应：被测代码只碰 ok 与 blob()。 */
const okResponse = (): Response => ({
    ok: true,
    status: 200,
    blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }),
}) as unknown as Response;

/** 跨域被拦时浏览器给的就是这么一句，没有别的信息。 */
const corsFailure = (): never => {
    throw new TypeError('Failed to fetch');
};

const setFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>): void => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = impl as unknown as typeof fetch;
};

describe('fetchCoverBytes', () => {
    beforeEach(() => {
        handlers.nativeAvailable = false;
        handlers.nativeFetch = null;
        setFetch(async () => corsFailure());
    });

    it('takes the in-page answer without asking the native bridge', async () => {
        handlers.nativeAvailable = true;
        handlers.nativeFetch = async () => {
            throw new Error('原生那条不该被走到');
        };
        setFetch(async () => okResponse());

        const blob = await fetchCoverBytes(COVER_URL);
        expect(blob?.type).toBe('image/jpeg');
    });

    /* 页内那一条被跨域拦掉（图床不给 CORS 头）时的退路。 */
    it('falls back to the native bridge when the page request is blocked', async () => {
        handlers.nativeAvailable = true;
        handlers.nativeFetch = async () => okResponse();
        setFetch(async () => corsFailure());

        const blob = await fetchCoverBytes(COVER_URL);
        expect(blob?.type).toBe('image/jpeg');
    });

    /*
     * 关键在这一条：**第一跳不带凭据**。带凭据的请求撞上 `Access-Control-Allow-Origin: *`
     * 会被浏览器判死（通配符在带凭据的请求里不作数），而那正是一家的图床回的东西。
     */
    it('asks for the cover without credentials on the first attempt', async () => {
        /*
         * 没有原生桥（桌面 / 网页）时页内会试两次，顺序就是这条要钉的东西：
         * 先匿名，拿不到才带凭据 —— 「要 cookie 才给图」的自建服务靠后一跳。
         */
        const seen: Array<RequestInit | undefined> = [];
        handlers.nativeAvailable = false;
        setFetch(async (_url, init) => {
            seen.push(init);
            return corsFailure();
        });

        await fetchCoverBytes(COVER_URL);

        expect(seen).toHaveLength(2);
        expect(seen[0]?.credentials).toBeUndefined();
        expect(seen[1]?.credentials).toBe('include');
    });

    /* blob: 只有页内这条路走得通，别拿它去问原生。 */
    it('reads a blob url in the page only', async () => {
        handlers.nativeAvailable = true;
        handlers.nativeFetch = async () => {
            throw new Error('原生那边不认 blob:');
        };
        setFetch(async () => okResponse());

        const blob = await fetchCoverBytes('blob:https://localhost/9f2c');
        expect(blob?.type).toBe('image/jpeg');
    });

    it('gives up quietly when nothing can fetch it', async () => {
        handlers.nativeAvailable = false;
        setFetch(async () => corsFailure());

        expect(await fetchCoverBytes(COVER_URL)).toBeNull();
    });
});
