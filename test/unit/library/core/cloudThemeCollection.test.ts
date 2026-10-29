import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import {
    CLOUD_THEME_PAGE_SIZE,
    createCloudThemeCollectionResource,
    isCloudThemePendingTrack,
    type CloudThemeCollectionDeps,
    type CloudThemeNameEntry,
} from '@/library/core/collection/resource/cloudThemeCollection.service';

// test/unit/library/core/cloudThemeCollection.test.ts
// 「AI 主题」那一屏的懒加载：云端只给歌名，曲目要客户端一首一首搜出来。
// 这里钉的是**加载形状**，不是数据内容：
//
//   1. 先把整屏铺满占位行（条数 == 本页歌名数），之后只替换、不增删 ——
//      反过来（搜到一条 push 一条）每来一条整张表重排一次，屏幕上先空白后一路往下长，很卡；
//   2. 搜不到的整行拿掉，且不能把别的行换错（并发 worker 各自按下标写，中途删行会带偏）；
//   3. 下一批的 offset 按**名字数**走，不按下标 —— 删过行之后两者不是一回事；
//   4. 离开这一屏（pause）之后不再取下一批、也不再往里插歌；
//   5. **只铺一批**：不再自动一页一页翻到底 —— 一直往里进新歌会让刚点开的那张卡片被挤走。
//
// 资源在头一页前会先探一次总数；总数多于一页时会跳到一个随机起点。所以下面凡是
// 涉及 offset 的断言都不写死具体数字，只钉「只向前、且每步推进一整页」—— 按下标算
// 偏移的话步长会不足一整页，取过的名字被再要一遍，屏幕上就是重复的歌。

/** 云端那份歌名清单：测试按 limit / offset 从这里切片。 */
const titlesOf = (count: number): string[] => Array.from({ length: count }, (_, index) => `Song ${index}`);

const songOf = (title: string): SongResult => ({
    id: `r-${title}`,
    name: title,
    artists: [],
    album: { id: '', name: '' },
    durationMs: 1,
} as unknown as SongResult);

const idsOf = (tracks: SongResult[]) => tracks.map(track => String(track.id));
const namesOf = (tracks: SongResult[]) => tracks.map(track => String(track.name));

/** 一次「搜歌」：由测试决定什么时候落定，好断言「还没搜回来」那一帧。 */
type Gate = {
    title: string;
    settled: boolean;
    resolve: (value: SongResult | null) => void;
    promise: Promise<SongResult | null>;
};

const createGate = (title: string): Gate => {
    const gate = {
        title,
        settled: false,
        resolve: () => {},
        promise: Promise.resolve<SongResult | null>(null),
    } as unknown as Gate;
    gate.promise = new Promise<SongResult | null>((res) => {
        gate.resolve = (value) => {
            if (gate.settled) return;
            gate.settled = true;
            res(value);
        };
    });
    return gate;
};

/** 让排队的微任务（含多层 await）全部跑完。 */
const settle = async () => {
    for (let i = 0; i < 80; i += 1) await Promise.resolve();
};

type Harness = {
    resource: ReturnType<typeof createCloudThemeCollectionResource>;
    /** 正式取页（limit == CLOUD_THEME_PAGE_SIZE）用过的 offset，按先后排列。 */
    offsets: number[];
    /** 正式取页实际发出去的名字，按先后拼接 —— 用来查「有没有把同一条名字要两遍」。 */
    served: string[];
    /** 把当前还没落定的搜索按 mapper 落定；新冒出来的继续，直到没有为止。 */
    drain: (mapper: (title: string) => SongResult | null) => Promise<void>;
};

const createHarness = (options: {
    /** 云端那份歌名清单。 */
    titles?: readonly string[];
    /** 云端报的总数；默认等于清单长度。 */
    total?: number;
    /** 第几次正式取页时抛错，用来看中断与续传。 */
    failOnPage?: number;
} = {}): Harness => {
    const titles = options.titles ?? titlesOf(5);
    const total = options.total ?? titles.length;
    const offsets: number[] = [];
    const served: string[] = [];
    const gates: Gate[] = [];
    let takenPages = 0;

    const readNames = async ({ limit, offset }: { limit: number; offset: number }): Promise<{ total: number; songs: CloudThemeNameEntry[] }> => {
        /*
         * 探总数那次只带 limit 1：它不取歌名、也不推进分页游标，只是问「一共多少条」。
         * 所以不计入取页序列 —— offsets 里装的就只是真正拿过名字的那些页。
         */
        if (limit >= CLOUD_THEME_PAGE_SIZE) {
            takenPages += 1;
            if (options.failOnPage === takenPages) throw new Error('cloud down');
            offsets.push(offset);
            served.push(...titles.slice(offset, offset + limit));
        }
        return {
            total,
            songs: titles.slice(offset, offset + limit).map(songTitle => ({ songTitle } as CloudThemeNameEntry)),
        };
    };

    const resolveSong = (songTitle: string): Promise<SongResult | null> => {
        const gate = createGate(songTitle);
        gates.push(gate);
        return gate.promise;
    };

    const deps: CloudThemeCollectionDeps = { readNames, resolveSong };
    const resource = createCloudThemeCollectionResource('cloud:ai-theme', deps);

    const drain = async (mapper: (title: string) => SongResult | null): Promise<void> => {
        for (let round = 0; round < 400; round += 1) {
            await settle();
            const pending = gates.filter(gate => !gate.settled);
            if (pending.length === 0) return;
            pending.forEach(gate => gate.resolve(mapper(gate.title)));
        }
    };

    return { resource, offsets, served, drain };
};

const start = (harness: Harness) => {
    harness.resource.ensure({} as never, {});
};

/** 云端都搜得到。 */
const allFound = (title: string) => songOf(title);

describe('cloudThemeCollection', () => {
    beforeEach(() => {
        /*
         * 资源在头一页前会先探一次总数，总数多于一页时跳到一个**随机**起点 ——
         * 钉死随机数，offset 序列才是可断言的（否则每跑一次数字都不一样）。
         */
        vi.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fills the screen with placeholders before any song is resolved', async () => {
        const harness = createHarness();
        start(harness);
        await settle();

        const snapshot = harness.resource.getSnapshot();
        // 关键是「先占位」：一条都还没搜出来，屏幕上已经是满的五行。
        expect(snapshot.tracks).toHaveLength(5);
        expect(snapshot.tracks.every(isCloudThemePendingTrack)).toBe(true);
        expect(namesOf(snapshot.tracks)).toEqual(titlesOf(5));
        // 头一页铺完就先放开：用户这时已经看得见整屏歌名，后面接着补。
        expect(snapshot.status).toBe('ready');
    });

    it('replaces rows in place once the songs come back, keeping the row count', async () => {
        const harness = createHarness();
        start(harness);
        await settle();
        const before = harness.resource.getSnapshot().tracks.length;

        await harness.drain(allFound);

        // 之后只替换、不增删：行数一直是铺出来的那么多。
        expect(harness.resource.getSnapshot().tracks).toHaveLength(before);
        expect(idsOf(harness.resource.getSnapshot().tracks)).toEqual(titlesOf(5).map(title => `r-${title}`));
    });

    it('drops the whole row when the platform has no match', async () => {
        const harness = createHarness();
        start(harness);
        // 每第 5 首（下标 4）在平台上搜不到 → 那一行被整行拿掉。
        await harness.drain(title => (title === 'Song 4' ? null : songOf(title)));

        const tracks = harness.resource.getSnapshot().tracks;
        expect(idsOf(tracks)).toEqual(['r-Song 0', 'r-Song 1', 'r-Song 2', 'r-Song 3']);
        // 不能留下没匹配上的占位行（点不动也播不了）。
        expect(tracks.some(isCloudThemePendingTrack)).toBe(false);
    });

    it('fills exactly one batch and stops there', async () => {
        /*
         * 云端 130 条名字、每批 60 条 —— 一轮取不完，但**不该**自己接着取。
         *
         * 以前这里是个 while 循环，一直翻到 offset >= total：用户刚点开的那张卡片会被
         * 源源不断的新歌挤到别的位置、跟着离中心的远近缩回去，手正按着的播放按钮就跑了。
         * 这一屏的规矩改成「一批就是一批」，想再看是右上角那颗「换一批」（reload）。
         */
        const titles = titlesOf(130);
        const missing = new Set(['Song 4', 'Song 9', 'Song 14']);
        const harness = createHarness({ titles });
        start(harness);
        await harness.drain(title => (missing.has(title) ? null : songOf(title)));

        expect(harness.offsets).toEqual([0]);
        expect(harness.served).toEqual(titles.slice(0, CLOUD_THEME_PAGE_SIZE));
        const ids = idsOf(harness.resource.getSnapshot().tracks);
        expect(ids).toHaveLength(CLOUD_THEME_PAGE_SIZE - missing.size);
        // 一批铺完就收工，不该挂着「还在补页」。
        expect(harness.resource.getSnapshot().sync).toEqual({ status: 'none' });
    });

    it('fills the rows in batches instead of committing once per song', async () => {
        /*
         * 每搜到一条就整表提交一次的话，一屏 60 条就是 60 次重排 —— 每次都把刚点开的那张
         * 卡片排到别处、缩回去，卡片上的播放按钮（只在居中时可点，见 `--play-pe`）当场
         * 变成点不到。攒批之后整屏只抖几下。
         */
        const harness = createHarness({ titles: titlesOf(CLOUD_THEME_PAGE_SIZE) });
        let trackCommits = 0;
        let last = harness.resource.getSnapshot().tracks;
        harness.resource.subscribe(() => {
            const next = harness.resource.getSnapshot().tracks;
            if (next === last) return;
            last = next;
            trackCommits += 1;
        });
        start(harness);
        await harness.drain(allFound);

        // 铺占位行 1 次 + 攒批的几次；「一条一次」的话这里是 60 往上。
        expect(trackCommits).toBeGreaterThan(0);
        expect(trackCommits).toBeLessThanOrEqual(12);
        expect(idsOf(harness.resource.getSnapshot().tracks)).toEqual(titlesOf(CLOUD_THEME_PAGE_SIZE).map(title => `r-${title}`));
    });

    it('asks for the next batch by name offset, not by row index', async () => {
        /*
         * resumeSync = 「接着往下看」。中途有一些在平台上搜不到，那几行会被整行拿掉，
         * 于是「列表显示到第几行」与「名字取到第几条」不再是同一个数。
         *
         * 游标必须按**名字数**推进：改回按下标算偏移的话，步长不足一整页，
         * 取过的名字会被再要一遍（屏幕上出现重复的歌）。所以这条断言盯的是
         * 「步长正好一整页」+「名字一条不重」，而不是某个具体的 offset 值。
         */
        const titles = titlesOf(130);
        const missing = new Set(['Song 4', 'Song 9', 'Song 14', 'Song 70', 'Song 71']);
        const harness = createHarness({ titles });
        start(harness);
        await harness.drain(title => (missing.has(title) ? null : songOf(title)));

        harness.resource.resumeSync();
        await harness.drain(title => (missing.has(title) ? null : songOf(title)));
        harness.resource.resumeSync();
        await harness.drain(title => (missing.has(title) ? null : songOf(title)));

        // 起点钉死在 0，于是取页序列是确定的：每批 60 条，最后一批只剩 10 条。
        expect(harness.offsets).toEqual([0, 60, 120]);
        // 取回来的名字一条不重 —— 按下标推进游标会重复取名（屏幕上出现重复的歌）。
        expect(harness.served).toEqual(titles);
        const ids = idsOf(harness.resource.getSnapshot().tracks);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toHaveLength(130 - missing.size);
    });

    it('stops asking and stops filling after the screen is left', async () => {
        const harness = createHarness();
        start(harness);
        await settle();

        // 用户滑走了：正在搜的那些即便回来了也不许再往里插。
        harness.resource.pause();
        await harness.drain(allFound);

        // 取页只发生过一次（第一轮的头一页），探总数那次不算。
        expect(harness.offsets).toEqual([0]);
        expect(harness.resource.getSnapshot().tracks.every(isCloudThemePendingTrack)).toBe(true);
    });

    it('stops after dispose', async () => {
        const harness = createHarness();
        start(harness);
        await settle();
        harness.resource.dispose();
        await harness.drain(allFound);

        expect(harness.offsets).toEqual([0]);
    });

    it('marks the run as interrupted at the offset it stopped at', async () => {
        // 云端 130 条、每批 60 条：头一批取到并铺出来，接着往下看时第二页取失败
        // → 中断在第二页的起点。
        const titles = titlesOf(130);
        const harness = createHarness({ titles, failOnPage: 2 });
        start(harness);
        await harness.drain(allFound);

        // 头一批是好的：只铺一批，所以不会再撞上第二页那次失败。
        expect(harness.resource.getSnapshot().status).toBe('ready');

        harness.resource.resumeSync();
        await harness.drain(allFound);

        const snapshot = harness.resource.getSnapshot();
        expect(snapshot.status).toBe('error');
        const sync = snapshot.sync as { status: string; message: string; offset: number };
        expect(sync.status).toBe('interrupted');
        expect(sync.offset).toBe(CLOUD_THEME_PAGE_SIZE);
        /*
         * 头一批铺出来的 60 行整整齐齐留在屏上 —— 中断只发生在**取下一批**那一步，
         * 已经铺出来的内容不该被回滚（用户正看着这一屏，抽走就闪一下空白）。
         */
        expect(snapshot.tracks.length).toBe(CLOUD_THEME_PAGE_SIZE);
        expect(idsOf(snapshot.tracks)).toEqual(titles.slice(0, CLOUD_THEME_PAGE_SIZE).map(title => `r-${title}`));
    });

    it('reloads from the first name again', async () => {
        const titles = titlesOf(130);
        const harness = createHarness({ titles });
        start(harness);
        await harness.drain(allFound);
        const first = idsOf(harness.resource.getSnapshot().tracks);
        const firstRound = [...harness.offsets];

        harness.resource.reload();
        await harness.drain(allFound);

        // 重新加载：清掉重来，offset 从头再走一遍。
        expect(harness.offsets).toEqual([...firstRound, ...firstRound]);
        expect(idsOf(harness.resource.getSnapshot().tracks)).toEqual(first);
    });
});
