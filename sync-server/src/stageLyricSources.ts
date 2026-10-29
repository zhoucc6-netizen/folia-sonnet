// sync-server/src/stageLyricSources.ts
// 从音乐平台把歌词原文件取回来 —— 校验一条上传的缓存时，要拿它跟上传者自称的那个
// 哈希对一遍。
//
// 这些是**第三方公开接口**，随时可能改、可能风控、可能整个域名不通。所以这里的定位
// 是「尽力而为」：取不到就返回 null，由校验层决定放行还是拒绝，绝不能因为它把正常
// 上传卡死（缓存的纪律是永不阻塞功能）。
//
// 取回的歌词只是用来算哈希的**中间量**，不落库、不外传。

const FETCH_TIMEOUT_MS = 5000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export type LyricSourceId = 'netease' | 'qq' | 'kugou';

/** 没有平台名字时按这个顺序试，先匹配上谁算谁。 */
export const LYRIC_SOURCE_ORDER: readonly LyricSourceId[] = ['netease', 'qq', 'kugou'];

/** 一个搜索结果。id 是取歌词要用的那个号（各平台各不一样）。 */
export interface LyricSearchHit {
  id: string;
  /** 歌名（顺手带上演唱者，比哈希对不上时好认是哪一首）。 */
  title: string;
}

/*
 * 一次搜索最多取几首候选。
 *
 * 同一首歌在平台上有好几个版本：翻唱、现场、别人重新上传的 LRC。上传者手里那份未必
 * 就是搜索结果里的第一条 —— 只比第一条的哈希会把大量正常上传误判成「不一致」。
 * 所以多留几条，但也不能太多：每多一条就多一次歌词请求，而这是公开接口。
 */
const MAX_SEARCH_RESULTS = 5;
export const MAX_LYRIC_CANDIDATES = 3;

export interface LyricSource {
  id: LyricSourceId;
  label: string;
  /** 搜索：返回最多 MAX_LYRIC_CANDIDATES 条候选，搜不到就是空数组。 */
  searchSongs: (title: string) => Promise<LyricSearchHit[]>;
  /** 按搜索结果给的 id 取歌词正文（已规范化），取不到一律 null。 */
  readLyricById: (id: string) => Promise<string | null>;
}

/** 一个「搜到了、歌词还没拉」的候选 —— 拉一次就记住，重复问不发第二次请求。 */
export interface LyricCandidate {
  title: string;
  source: LyricSourceId;
  /** 惰性取歌词：只有真要比对时才发那一次请求，结果记在闭包里。 */
  readLyric: () => Promise<string | null>;
}

const fetchText = async (url: string, headers: Record<string, string> = {}): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, ...headers },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const readJson = (text: string | null): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/*
 * LRC → 歌词正文。
 *
 * 客户端算指纹用的是「每行正文用 \n 连起来再 trim」（resolveStageLyricSource），
 * 所以这里要还原成同样的形状：把 `[00:12.34]` 这类时间标签与 `[ti:xxx]` 这类元数据
 * 统统剥掉，剩下的才是正文。
 */
const stripLrcTags = (lrc: string): string => (
  lrc.replace(/\[[^\]]*\]/g, '').trim()
);

/** QQ 那份歌词是转义过的（`&#10;` 换行、`&#32;` 空格），要还原。 */
const decodeNumericEntities = (value: string): string => (
  value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/** 搜索结果里「歌名 - 演唱者」；拼不出来就只留歌名。 */
const joinTitle = (name: unknown, artists: unknown): string => {
  const songName = typeof name === 'string' ? name.trim() : '';
  const list = Array.isArray(artists)
    ? artists
      .map((entry) => (isRecord(entry) && typeof entry.name === 'string' ? entry.name.trim() : ''))
      .filter(Boolean)
    : [];
  return list.length > 0 ? `${songName} - ${list.join('/')}` : songName;
};

/** 网易云：搜索走老版 web 接口，歌词接口不需要签名。 */
const neteaseSource: LyricSource = {
  id: 'netease',
  label: '网易云音乐',
  searchSongs: async (title) => {
    const search = await fetchText(
      `https://music.163.com/api/search/get/web?s=${encodeURIComponent(title)}&type=1&offset=0&limit=5`,
      { Referer: 'https://music.163.com/' },
    );
    const songs = (() => {
      const parsed = readJson(search);
      const result = isRecord(parsed) ? parsed.result : null;
      const list = isRecord(result) ? result.songs : null;
      return Array.isArray(list) ? list : [];
    })();

    const hits: LyricSearchHit[] = [];
    for (const entry of songs) {
      if (hits.length >= MAX_SEARCH_RESULTS) break;
      if (!isRecord(entry)) continue;
      const id = typeof entry.id === 'number' ? entry.id : Number(entry.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      hits.push({ id: String(id), title: joinTitle(entry.name, entry.artists) || String(id) });
    }
    return hits;
  },
  readLyricById: async (id) => {
    const lyric = await fetchText(
      `https://music.163.com/api/song/lyric?os=pc&id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`,
      { Referer: 'https://music.163.com/' },
    );
    const parsed = readJson(lyric);
    if (!isRecord(parsed)) return null;
    const lrc = isRecord(parsed.lrc) ? parsed.lrc.lyric : null;
    const text = typeof lrc === 'string' ? stripLrcTags(lrc) : '';
    return text || null;
  },
};

/** QQ：搜索与歌词都在 c.y.qq.com 上，歌词接口要带 Referer 才给。 */
const qqSource: LyricSource = {
  id: 'qq',
  label: 'QQ 音乐',
  searchSongs: async (title) => {
    const search = await fetchText(
      `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(title)}&format=json&p=1&n=5`,
      { Referer: 'https://y.qq.com/' },
    );
    const list = (() => {
      const parsed = readJson(search);
      const data = isRecord(parsed) ? parsed.data : null;
      const song = isRecord(data) ? data.song : null;
      const items = isRecord(song) ? song.list : null;
      return Array.isArray(items) ? items : [];
    })();

    const hits: LyricSearchHit[] = [];
    for (const entry of list) {
      if (hits.length >= MAX_SEARCH_RESULTS) break;
      if (!isRecord(entry)) continue;
      const mid = typeof entry.songmid === 'string' ? entry.songmid.trim() : '';
      if (!mid) continue;
      const singers = Array.isArray(entry.singer)
        ? entry.singer.map((singer) => (isRecord(singer) && typeof singer.name === 'string' ? singer.name.trim() : '')).filter(Boolean)
        : [];
      const name = typeof entry.songname === 'string' ? entry.songname.trim() : '';
      hits.push({ id: mid, title: singers.length > 0 ? `${name} - ${singers.join('/')}` : name || mid });
    }
    return hits;
  },
  readLyricById: async (id) => {
    const lyric = await fetchText(
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(id)}&format=json&nobase64=1`,
      { Referer: 'https://y.qq.com/' },
    );
    const parsed = readJson(lyric);
    if (!isRecord(parsed)) return null;
    const raw = typeof parsed.lyric === 'string' ? parsed.lyric : '';
    const text = stripLrcTags(decodeNumericEntities(raw));
    return text || null;
  },
};

/**
 * 酷狗：搜索给出 FileHash，歌词再拿 Hash 去换。
 *
 * 这一步最容易失败（接口签名/风控改过好几轮），失败就是 null —— 由调用方继续试下一个
 * 平台，或者按「没验证过」放行。
 */
const kugouSource: LyricSource = {
  id: 'kugou',
  label: '酷狗音乐',
  searchSongs: async (title) => {
    const search = await fetchText(
      `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(title)}&page=1&pagesize=5&platform=WebFilter`,
      { Referer: 'https://www.kugou.com/' },
    );
    const list = (() => {
      const parsed = readJson(search);
      const data = isRecord(parsed) ? parsed.data : null;
      const items = isRecord(data) ? data.lists : null;
      return Array.isArray(items) ? items : [];
    })();

    const hits: LyricSearchHit[] = [];
    for (const entry of list) {
      if (hits.length >= MAX_SEARCH_RESULTS) break;
      if (!isRecord(entry)) continue;
      const hash = typeof entry.FileHash === 'string' ? entry.FileHash.trim() : '';
      if (!hash) continue;
      /* 酷狗的 SongName 里带「 - 演唱者」，直接用。 */
      const name = typeof entry.SongName === 'string' ? entry.SongName.trim() : '';
      hits.push({ id: hash, title: name || hash });
    }
    return hits;
  },
  readLyricById: async (id) => {
    const lyric = await fetchText(
      `https://krcs.kugou.com/download?ver=1&client=pc&fmt=lrc&charset=utf8&accesskey=&userid=0&id=${encodeURIComponent(id)}`,
      { Referer: 'https://www.kugou.com/' },
    );
    const text = lyric ? stripLrcTags(lyric) : '';
    return text || null;
  },
};

const SOURCES: Record<LyricSourceId, LyricSource> = {
  netease: neteaseSource,
  qq: qqSource,
  kugou: kugouSource,
};

export const LYRIC_SOURCE_LABELS: Record<string, string> = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  kugou: '酷狗音乐',
};

/** 认不出来的平台名一律当「没填」—— 宁可放行，也别因为一个陌生名字把上传拒了。 */
export const resolveLyricSource = (platform: string): LyricSource | null => {
  const key = String(platform ?? '').trim().toLowerCase();
  if (!key) return null;
  const aliases: Record<string, LyricSourceId> = {
    netease: 'netease',
    ncm: 'netease',
    wangyi: 'netease',
    wyy: 'netease',
    qq: 'qq',
    qqmusic: 'qq',
    kugou: 'kugou',
    kg: 'kugou',
  };
  const id = aliases[key];
  return id ? SOURCES[id] : null;
};

/*
 * 歌词正文的两种写法。
 *
 * 客户端那边的行可能有空行、也可能没有（取决于歌词来源与解析），服务端照着 LRC 剥
 * 标签后没法确定是哪一种。所以两种都算一遍哈希，对上任意一个就算通过 —— 少一次
 * 「明明是同一份歌词却判成不一致」的误伤。
 */
export const lyricTextCandidates = (text: string): string[] => {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const withBlanks = normalized;
  const withoutBlanks = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  return withoutBlanks && withoutBlanks !== withBlanks
    ? [withBlanks, withoutBlanks]
    : [withBlanks];
};

const toCandidates = (source: LyricSource, hits: LyricSearchHit[]): LyricCandidate[] => (
  hits.slice(0, MAX_LYRIC_CANDIDATES).map((hit) => {
    /* 拉一次就记住：哈希没中还要按内容再判一次，不能因为判两次就发两次请求。 */
    let cached: string | null | undefined;
    return {
      title: hit.title,
      source: source.id,
      readLyric: async () => {
        if (cached === undefined) cached = await source.readLyricById(hit.id);
        return cached;
      },
    };
  })
);

/**
 * 按歌名去平台上**搜索**，把搜到的几首歌做成「还没拉歌词」的候选。
 *
 * 歌词是惰性的：谁要跟它比对谁才发那一次请求。哈希在第一首就命中时，后面几首的歌词
 * 一次都不会拉 —— 多留候选是为了少误伤，不是为了多打接口。
 *
 * 没写平台就按 LYRIC_SOURCE_ORDER 顺序试，先搜到谁算谁。
 */
export const searchLyricCandidates = async (
  platform: string,
  songTitle: string,
): Promise<{ candidates: LyricCandidate[]; source: LyricSourceId | null }> => {
  if (!songTitle) return { candidates: [], source: null };

  const named = resolveLyricSource(platform);
  if (named) {
    return { candidates: toCandidates(named, await named.searchSongs(songTitle)), source: named.id };
  }

  for (const id of LYRIC_SOURCE_ORDER) {
    const hits = await SOURCES[id].searchSongs(songTitle);
    if (hits.length > 0) return { candidates: toCandidates(SOURCES[id], hits), source: id };
  }
  return { candidates: [], source: null };
};
