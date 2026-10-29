// sync-server/scripts/scan-dirty-cache.mts
//
// 扫一遍云端的 AI 缓存，把「键是这首的、内容是别首的」那批条目点出来。
//
// 为什么会有这种条目：早年的拉缓存是「精确键没中 → 按歌名随便挑一条 → 回填到自己的键
// 上」。回填之后每次都是精确命中，于是错一次就一直错下去 —— 用户报的「风清云净」就是
// 这样来的：高亮词 `留住 / 我 / 什么 / 把 / 你` 里，这首的歌词只有「我 / 什么 / 你」。
// 判定收紧之后新条目不会再脏，可**已经写进去的那些还躺在那儿**，得有人去点出来。
//
// 判据跟客户端拉缓存那一侧**同一条规矩**：AI 标的高亮词里能当证据的那几个（去掉单字与
// 虚词），在这首歌的歌词里必须 100% 全在；差一个就是脏。歌词由服务端那套歌词源去平台
// 上搜，最多取 3 个版本 —— 同一首歌换个版本的 LRC 照样算数。
//
// ⭐ **只读是默认**：不给 `--delete` 就一个字节都不改。删除走管理接口（要管理员账号密码），
// 而且必须先看清 `--out` 那份报告。
//
// 跑法（在 sync-server/ 下）：
//   npx tsx scripts/scan-dirty-cache.mts
//   npx tsx scripts/scan-dirty-cache.mts --only 晴天
//   npx tsx scripts/scan-dirty-cache.mts --limit 40 --out /tmp/dirty.json
//   npx tsx scripts/scan-dirty-cache.mts --delete --admin-user xxx --admin-pass yyy --yes
//
// 依赖只有 tsx（sync-server 自己的 devDependency）与出网，不需要 wrangler、不需要登录
// Cloudflare —— 扫的那两个接口本来就是公开的。
//
// ⚠️ 一个歌名最多看到 12 条候选（服务端 `MAX_RESOLVE_CANDIDATES`）：同一首歌攒了更多版本
// 时，超出那部分扫不到。要清干净可以拿 `--only <歌名>` 分片，或者直接上管理员面板
// （/admin/cache）按歌名搜。

import { writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import {
  countEvidenceHits,
  highlightEvidenceWords,
  highlightWordsPresent,
} from '../src/stageVerifier.js';
import { searchLyricCandidates } from '../src/stageLyricSources.js';

/** 客户端 `DEFAULT_CLOUD_BASE_URL` 的那一个。 */
const DEFAULT_BASE = 'https://apif.tangbot.xyz';
/** 歌名清单一次取多少（接口上限 200）。 */
const SONGS_PAGE = 200;
/** 同时判几个歌名。太猛会被平台上那些搜索接口当成刷。 */
const DEFAULT_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 20_000;

type Candidate = {
  key: string;
  songTitle: string;
  platform: string;
  provider: string;
  model: string;
  updatedAt: string;
  words: string[];
};

type Verdict = 'clean' | 'dirty' | 'no_evidence' | 'no_lyric' | 'orphan';

type EntryReport = {
  key: string;
  songTitle: string;
  platform: string;
  updatedAt: string;
  /** 服务端记的这一条原有的高亮词。 */
  words: string[];
  /** 去掉单字与虚词之后真正拿来判的那些。 */
  evidence: string[];
  verdict: Verdict;
  hits: number;
  total: number;
  /** 最像的那份歌词里没找到的证据词 —— 「脏在哪」就写在这儿。 */
  missing: string[];
  /** 比的是平台上哪一首（判定取的就是它的歌词）。 */
  matchedLyric: string;
};

type ScanReport = {
  base: string;
  scannedAt: string;
  songCount: number;
  entryCount: number;
  counts: Record<Verdict, number>;
  entries: EntryReport[];
  /** 歌名在库里，可按歌名一条也捞不回来 —— 死条目，永远不会有人拉到。 */
  orphanTitles: string[];
};

const readArg = (name: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] ?? '').trim() : '';
};
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const getJson = async (url: string, init?: RequestInit): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/** 云端现在有哪些歌名（按歌名去重）。 */
const fetchSongTitles = async (base: string, query: string): Promise<string[]> => {
  const out: string[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const search = new URLSearchParams({ limit: String(SONGS_PAGE), offset: String(offset) });
    if (query) search.set('q', query);
    const data = await getJson(`${base}/api/ai-cache/songs?${search.toString()}`);
    if (!isRecord(data)) break;
    const rows = Array.isArray(data.songs) ? data.songs : [];
    if (rows.length === 0) break;
    rows.forEach((row) => {
      if (!isRecord(row)) return;
      const title = String(row.songTitle ?? '').trim();
      if (title) out.push(title);
    });
    total = Number(data.total ?? 0);
    offset += rows.length;
    /* 接口把 total 说少了（或干脆没给）时不至于死循环。 */
    if (!Number.isFinite(total) || total <= 0) total = offset;
  }
  return [...new Set(out)];
};

/** 按歌名问云端要候选：只回高亮词，不回 payload（跟客户端拉缓存那一问同一条）。 */
const fetchCandidates = async (base: string, songTitle: string): Promise<Candidate[]> => {
  const data = await getJson(`${base}/api/ai-cache/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ kind: 'stage', songTitle }),
  });
  if (!isRecord(data) || !Array.isArray(data.candidates)) return [];
  const out: Candidate[] = [];
  for (const entry of data.candidates) {
    if (!isRecord(entry)) continue;
    const key = String(entry.key ?? '').trim();
    if (!/^[a-f0-9]{32}$/.test(key)) continue;
    out.push({
      key,
      songTitle: String(entry.songTitle ?? songTitle).trim(),
      platform: String(entry.platform ?? ''),
      provider: String(entry.provider ?? ''),
      model: String(entry.model ?? ''),
      updatedAt: String(entry.updatedAt ?? ''),
      words: Array.isArray(entry.words)
        ? entry.words.filter((word): word is string => typeof word === 'string' && word.trim().length > 0)
        : [],
    });
  }
  return out;
};

/**
 * 平台上这首歌的歌词正文，最多 3 个版本。
 *
 * 同一首歌在平台上有好几个版本（翻唱、现场、别人重新传的 LRC），只比第一条会把大量
 * 正常条目误判成脏 —— 跟上传校验那一侧同一个道理。
 */
const fetchLyricVariants = async (
  platform: string,
  songTitle: string,
): Promise<{ texts: string[]; titles: string[] }> => {
  const { candidates } = await searchLyricCandidates(platform, songTitle);
  const texts: string[] = [];
  const titles: string[] = [];
  for (const candidate of candidates) {
    const text = await candidate.readLyric();
    if (!text) continue;
    texts.push(text);
    titles.push(candidate.title);
  }
  return { texts, titles };
};

/**
 * 判一条。
 *
 * `no_lyric`（平台上搜不到这首歌）与 `no_evidence`（这条没标任何能当证据的词）都**不算
 * 脏** —— 那是「没得判」，不是「判出来不对」。宁可漏，不可错杀：删掉一条别人做好的
 * 主题，比留着一条可能错的糟得多。
 */
const judgeEntry = async (
  candidate: Candidate,
  lyricTexts: string[],
  lyricTitles: string[],
): Promise<EntryReport> => {
  const evidence = highlightEvidenceWords(candidate.words);
  const base = {
    key: candidate.key,
    songTitle: candidate.songTitle,
    platform: candidate.platform,
    updatedAt: candidate.updatedAt,
    words: candidate.words,
    evidence,
  };

  if (evidence.length === 0) {
    return { ...base, verdict: 'no_evidence', hits: 0, total: 0, missing: [], matchedLyric: '' };
  }
  if (lyricTexts.length === 0) {
    return { ...base, verdict: 'no_lyric', hits: 0, total: evidence.length, missing: [...evidence], matchedLyric: '' };
  }

  /* 有一份歌词把它们全凑齐就干净 —— 判定取的是那一份。 */
  for (let index = 0; index < lyricTexts.length; index += 1) {
    if (highlightWordsPresent(candidate.words, lyricTexts[index])) {
      return {
        ...base,
        verdict: 'clean',
        hits: evidence.length,
        total: evidence.length,
        missing: [],
        matchedLyric: lyricTitles[index] ?? '',
      };
    }
  }

  /* 都不齐：把**最接近**那份的缺口报出来（缺最少、词最多，报告才看得懂）。 */
  let best = countEvidenceHits(candidate.words, lyricTexts[0]);
  let bestTitle = lyricTitles[0] ?? '';
  for (let index = 1; index < lyricTexts.length; index += 1) {
    const current = countEvidenceHits(candidate.words, lyricTexts[index]);
    if (current.hits > best.hits) {
      best = current;
      bestTitle = lyricTitles[index] ?? '';
    }
  }
  return {
    ...base,
    verdict: 'dirty',
    hits: best.hits,
    total: best.total,
    missing: best.missing,
    matchedLyric: bestTitle,
  };
};

/** 并发多少个地跑，但**保持输入顺序** —— 报告顺序得跟云端一致才对得上。 */
const mapInOrder = async <T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
};

const login = async (base: string, username: string, password: string): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
      redirect: 'manual',
    });
    if (!response.ok) return '';
    /* 管理接口认的是 cookie，不是返回体里那个 token。 */
    const raw = response.headers.getSetCookie?.() ?? [];
    const hit = raw.find((line) => line.startsWith('folia_admin_session='));
    return hit ? hit.split(';')[0] : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
};

const deleteEntry = async (base: string, cookie: string, key: string): Promise<boolean> => {
  try {
    const response = await fetch(`${base}/admin/api/ai-cache/stage/${key}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    return response.ok;
  } catch {
    return false;
  }
};

/** 中文占两格，终端里才对得齐。 */
const pad = (value: string, width: number): string => {
  let columns = 0;
  for (const char of value) columns += /[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(char) ? 2 : 1;
  return value + ' '.repeat(Math.max(0, width - columns));
};

const main = async (): Promise<void> => {
  const base = (readArg('base') || DEFAULT_BASE).replace(/\/+$/, '');
  const only = readArg('only');
  const limitArg = Number.parseInt(readArg('limit'), 10);
  const concurrency = Number.parseInt(readArg('concurrency'), 10) || DEFAULT_CONCURRENCY;
  const outPath = resolvePath(process.cwd(), readArg('out') || 'dirty-cache-scan.json');
  const wantDelete = hasFlag('delete');
  const confirmed = hasFlag('yes');
  const adminUser = readArg('admin-user') || process.env.ADMIN_USERNAME || '';
  const adminPass = readArg('admin-pass') || process.env.ADMIN_PASSWORD || '';

  process.stdout.write(`扫描 ${base}\n`);
  const titles = await fetchSongTitles(base, only);
  const capped = Number.isFinite(limitArg) && limitArg > 0 ? titles.slice(0, limitArg) : titles;
  process.stdout.write(`歌名 ${capped.length} 个（共 ${titles.length}）\n`);

  const reports: EntryReport[] = [];
  const orphanTitles: string[] = [];
  let done = 0;

  await mapInOrder(capped, concurrency, async (title) => {
    const candidates = await fetchCandidates(base, title);
    /*
     * 歌名在库里却一条候选都捞不回来：不是「判不过」，是**根本没人能拉到它**。
     * 多半是歌名归一之后跟库里对不上（「歌手 - 歌名」那种），留着只是占地方。
     */
    if (candidates.length === 0) {
      orphanTitles.push(title);
      done += 1;
      return;
    }

    /* 歌词按歌名只搜一次：同一个歌名下十几条条目共用这几份歌词。 */
    const platform = candidates.find((entry) => entry.platform)?.platform ?? '';
    const { texts, titles: lyricTitles } = await fetchLyricVariants(platform, title);
    for (const candidate of candidates) {
      reports.push(await judgeEntry(candidate, texts, lyricTitles));
    }
    done += 1;
    if (done % 10 === 0) process.stdout.write(`  … ${done}/${capped.length}\n`);
  });

  const counts: Record<Verdict, number> = { clean: 0, dirty: 0, no_evidence: 0, no_lyric: 0, orphan: 0 };
  reports.forEach((entry) => { counts[entry.verdict] += 1; });

  const dirty = reports.filter((entry) => entry.verdict === 'dirty');
  process.stdout.write('\n');
  if (dirty.length > 0) {
    process.stdout.write('脏条目（高亮词在这首歌的歌词里凑不齐）：\n');
    dirty
      .sort((a, b) => a.songTitle.localeCompare(b.songTitle))
      .forEach((entry) => {
        process.stdout.write(
          `  ${pad(entry.songTitle, 24)}${pad(entry.platform || '-', 9)}${entry.key.slice(0, 8)}…`
          + `  证据 ${entry.hits}/${entry.total}  缺：${entry.missing.join('、') || '-'}\n`,
        );
      });
  } else {
    process.stdout.write('脏条目：0 —— 没有一条是「内容与键对不上」的。\n');
  }
  if (orphanTitles.length > 0) {
    process.stdout.write(`\n按歌名捞不回来的死条目（${orphanTitles.length} 个歌名）：${orphanTitles.slice(0, 20).join('、')}\n`);
  }

  process.stdout.write(
    `\n汇总：干净 ${counts.clean} · 脏 ${counts.dirty} · 没标证据词 ${counts.no_evidence}`
    + ` · 平台上搜不到歌词 ${counts.no_lyric} · 死歌名 ${orphanTitles.length}\n`,
  );

  const report: ScanReport = {
    base,
    scannedAt: new Date().toISOString(),
    songCount: capped.length,
    entryCount: reports.length,
    counts,
    entries: reports,
    orphanTitles,
  };
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`报告：${outPath}\n`);

  if (!wantDelete) {
    process.stdout.write('\n只读扫描结束 —— 没改任何数据。要删再加 --delete（并给 --admin-user/--admin-pass --yes）。\n');
    return;
  }
  if (!confirmed) {
    process.stdout.write('\n要删除得把 --yes 也带上：先看报告，确认了再删。\n');
    return;
  }
  if (!adminUser || !adminPass) {
    process.stdout.write('\n删除走管理接口，需要 --admin-user 与 --admin-pass（或 ADMIN_USERNAME/ADMIN_PASSWORD）。\n');
    return;
  }

  const cookie = await login(base, adminUser, adminPass);
  if (!cookie) {
    process.stdout.write('\n登录失败：账号密码不对，或者这个地址上没有 /admin/login。一个都没删。\n');
    return;
  }

  let removed = 0;
  for (const entry of dirty) {
    const ok = await deleteEntry(base, cookie, entry.key);
    if (ok) removed += 1;
    process.stdout.write(`  ${ok ? '已删' : '删除失败'} ${entry.key} 《${entry.songTitle}》\n`);
  }
  process.stdout.write(`\n删掉 ${removed}/${dirty.length} 条。它们被覆盖前的旧版还在备份表里，管理员面板能捞回来。\n`);
};

await main();
