// sync-server/src/songTitleMatch.ts
// 歌名怎么算「同一首」—— 纯函数，不碰 D1 也不碰 hono，好被单测引。
//
// 缓存键是「歌词 + policy」的 MD5，于是同一首歌换个版本的歌词（翻唱、现场、各家
// 平台的 LRC 本来就不同）就是另一个键。精确键没中时靠**歌名**去库里捞候选，再把
// 每条候选的高亮词带回去由客户端判定合不合规。
//
// 麻烦在于「同一首歌」在各平台上的名字并不一致：
//
//   - 括号里的备注：晴天 (Live)、歌名【伴奏】、某曲（电影《x》主题曲）
//   - 后缀：Remix、翻唱、feat. 某人、现场版、纯音乐、Acoustic、Inst.
//   - 中英文括号、全角半角、多余空格
//
// 用原样去比，「晴天」永远配不上「晴天 (Live)」，而它们的歌词是同一份，缓存里那条
// 明明能用。所以这里先把名字压成一个「核心名」再比。
//
// **放宽匹配 ≠ 放宽判定**：这里多给几个候选没关系，判「这条答案是不是照着这首歌
// 做的」仍然是客户端拿高亮词一条一条对（highlightWordsPresent）。误伤由那一层兜住。

/** 括号及其中内容 —— 备注几乎都写在括号里。 */
const BRACKETED = /[（(【\[][^）)】\]]*[）)】\]]/g;

/**
 * 平台爱往歌名上挂的东西。
 *
 * 中文没有词边界，`\b` 对中文不生效，所以中文那几个是整段匹配 —— 宁可多削一点：
 * 削错了只是多给几个候选，漏削了就是这条永远配不上。
 */
const NOISE =
  /(live|remix|remaster(?:ed)?|cover|acoustic|demo|inst(?:rumental)?\.?|instrumental|(?:feat|ft)\.?.*|official|mv|ver\.?|纯音乐|伴奏|现场(?:版)?|翻唱|原唱|清唱|钢琴版|吉他版|独奏|无伴奏|版|版本)/gi;

/** 只留字母、数字与中日韩 —— 标点、空格、全角半角的差别都是噪声。 */
const KEEP = /[0-9a-z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gi;

/** 后缀可能叠着写（「Live Ver.」是两层），削到不再变化为止。 */
const stripNoise = (value: string): string => {
  let text = value;
  for (let round = 0; round < 3; round += 1) {
    const next = text.replace(NOISE, ' ');
    if (next === text) break;
    text = next;
  }
  return text;
};

/**
 * 拿去**问数据库**的那个名字：去括号、去后缀，但**保留空格与标点**。
 *
 * SQL 的 LIKE 是跟库里原样的 `song_title` 比的 —— 压成没有空格的一坨反而配不上
 * 「Someone Like You」。压空格是 `songTitleKey` 的事，那一步留给本机比较。
 */
export const looseSongTitle = (value: string): string =>
  stripNoise(String(value ?? '').replace(BRACKETED, ' ')).replace(/\s+/g, ' ').trim();

/**
 * 拿去**比较**的那个名字：连标点空格一起压掉，只剩字母数字与中日韩。
 *
 * 「晴天 Live」「晴天(Live)」「晴天 (Live 版)」在这里都是同一个串。
 */
export const songTitleKey = (value: string): string =>
  ((looseSongTitle(value).match(KEEP) ?? []).join('') || '').toLowerCase();

/**
 * 拿去**问数据库**的另一个写法：在 `loose` 之上把标点也去了，只留字、数和空格。
 *
 * 「花海 - 现场」被 `loose` 削掉「现场」之后剩下「花海 -」，多出来那个连字符会让
 * `LIKE '%花海 -%'` 一条都配不上（库里叫「花海」）—— 但 `songTitleKey` 那一步是
 * 认的（它连标点一起压）。所以 LIKE 这一层也要有一个「去了标点」的版本兜住它。
 */
export const songTitleLike = (value: string): string =>
  looseSongTitle(value)
    .replace(/[^0-9a-z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 「第一个字」那个钩子。
 *
 * 主查询（全等 + 两端互相 LIKE）碰上平台各写一套歌名时会一条都捞不回来：库里叫
 * 「起风了」，手上这首叫别的名字，怎么压都压不到一起。这时候就按用户说的来 ——
 * 只拿歌名开头那一个字（中日韩）或头一个词（拉丁，至少三个字符，一个字母会把半个库
 * 都捞回来）去捞一堆候选，剩下的交给客户端拿高亮词判。**放宽的是入口，不是判定。**
 */
export const songTitleSeed = (value: string): string => {
  const first = Array.from(songTitleKey(value))[0] ?? '';
  if (!first) return '';
  if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(first)) return first;
  const word = (looseSongTitle(value).split(/\s+/)[0] ?? '').replace(/[^0-9a-z]/gi, '');
  return word.length >= 3 ? word.slice(0, 12) : '';
};

/**
 * 「歌手 - 歌名」这种写法拆开来的各段。
 *
 * 平台（以及不少本地曲库）爱把歌手写在前面：「周杰伦 - 晴天」「晴天 - 周杰伦」。
 * 整串压完是「周杰伦晴天」，跟库里的「晴天」怎么 LIKE 都配不上 —— 所以按分隔符切开，
 * 每一段单独拿去问，命中并在一起。这是那种名字唯一能走通的路。
 */
const SEPARATORS = /[\-–—~|/／·、,，:：]+/;

export const songTitleSegments = (value: string): string[] => {
  const loose = looseSongTitle(value);
  if (!loose) return [];
  const parts = loose
    .split(SEPARATORS)
    .map((part) => songTitleLike(part))
    .filter(Boolean);
  return [...new Set(parts)];
};

/**
 * 候选打分：数字越小越该排前面。
 *
 *   0 —— 归一后完全相同（「晴天」/「晴天 (Live)」）
 *   1 —— 云端更长（云端「晴天 现场」，请求「晴天」）
 *   2 —— 请求更长（云端「晴天」，请求「晴天 电影主题曲」）
 *   3 —— 只是原样包含，归一后对不上：不算候选，交给高亮词也救不回来
 *
 * 两端有一个压不出核心名（歌名全是噪声，比如就叫「Live」）时也按 3 处理 ——
 * 那种名字做模糊匹配会把半个库都捞回来。
 */
export const rankSongTitleMatch = (candidateTitle: string, requestedTitle: string): number => {
  const candidate = songTitleKey(candidateTitle);
  const requested = songTitleKey(requestedTitle);
  if (!candidate || !requested) return 3;
  if (candidate === requested) return 0;
  if (candidate.includes(requested)) return 1;
  if (requested.includes(candidate)) return 2;
  return 3;
};

/** 打分 3 不是候选。 */
export const isSongTitleCandidate = (candidateTitle: string, requestedTitle: string): boolean =>
  rankSongTitleMatch(candidateTitle, requestedTitle) < 3;
