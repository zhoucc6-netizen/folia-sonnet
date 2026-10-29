// android/qishui-bridge/src/car/shape.js
//
// 车机协议的返回结构 → Folia 渲染层认的形状。
//
// 渲染层（src/services/onlineMusic/qishuiNormalize.ts）只认一组扁平字段：
//   song      id / name / artist / artists[] / album / albumId / cover / duration(秒)
//   collection id / name / cover / creator / trackCount / isOwned
//   lyric     lyric / yrc / tlyric
// 车机给的是 base_info / related_info / display_info 三层嵌套，换算集中在这里，
// 其余模块只处理协议，不碰字段命名。

const text = value => (value == null ? '' : String(value));

/** 抖音图片结构 { urls: [前缀], uri } → 可直接下发的封面 URL。 */
export function coverFromUrlInfo(info) {
    if (!info || typeof info !== 'object') return '';
    const urls = Array.isArray(info.urls) ? info.urls : [];
    const prefix = urls.find(value => typeof value === 'string' && /^https?:\/\//.test(value)) || '';
    const uri = text(info.uri);
    if (!prefix || !uri) return '';
    // 服务端只认带 ~c5_<w>x<h> 尺寸后缀的地址（不带后缀会回 400）。
    return prefix + uri + '~c5_300x300.jpeg';
}

/** 歌单/专辑封面在 display_info 下的层级两条都见过，逐个试到有结果。 */
function collectionCover(entity) {
    const display = entity.display_info || {};
    return coverFromUrlInfo(display.url_cover || (display.display && display.display.url_cover))
        || coverFromUrlInfo(entity.cover_url);
}

/**
 * 从各种包装里取出 track entity：搜索结果、歌单条目、media/mget 的返回值形状都不同。
 * 逐个候选试到有 id 为止（不要取「第一个非空」—— 空对象也是非空）。
 */
export function trackEntity(raw) {
    const candidates = [
        raw?.track_entity,
        raw?.entity?.media?.track_entity,
        raw?.entity?.track,
        raw?.media?.track_entity,
        raw?.track,
        raw,
    ];
    for (const candidate of candidates) {
        if (candidate && (candidate.base_info?.id || candidate.id)) return candidate;
    }
    return null;
}

export function toFoliaSong(raw) {
    const track = trackEntity(raw);
    if (!track) return null;
    const base = track.base_info || {};
    const id = text(base.id || track.id);
    if (!id) return null;
    const related = track.related_info || {};
    const album = related.album_link || {};
    const artists = (Array.isArray(related.artist_links) ? related.artist_links : [])
        .map(item => ({
            id: text(item?.id),
            name: text(item?.name || item?.simple_display_name),
        }))
        .filter(item => item.name);
    const display = track.display_info || {};
    const durationMs = Number(base.duration_ms || 0);
    return {
        id,
        name: text(base.name),
        artist: artists.map(item => item.name).join(' / '),
        artistId: artists.length ? artists[0].id : '',
        artists,
        album: text(album.name),
        albumId: text(album.id),
        cover: coverFromUrlInfo(display.cover_url || (display.display && display.display.cover_url)),
        // 渲染层拿到秒再乘 1000，所以这里给秒（保留小数）。
        duration: durationMs > 0 ? durationMs / 1000 : 0,
        fee: 0,
        playbackMode: 'direct-url',
    };
}

export function toFoliaSongs(items) {
    return (Array.isArray(items) ? items : []).map(toFoliaSong).filter(Boolean);
}

/** 车机歌单：type 1 是「我的喜欢」，isOwned 由调用方给出（自建 vs 收藏）。 */
export function toFoliaPlaylist(raw, options = {}) {
    const entity = raw?.playlist || raw || {};
    const base = entity.base_info || {};
    const id = text(base.id || entity.id);
    if (!id) return null;
    const cover = collectionCover(entity);
    // resource_cnt 是**对象**（{ track_cnt, media_count, ... }）不是数字 —— 直接
    // Number() 会得 NaN 再归零，界面上整张歌单卡就是「0 首」并因此被置灰。
    const counts = entity.resource_cnt && typeof entity.resource_cnt === 'object' ? entity.resource_cnt : {};
    const trackCount = Number(counts.track_cnt ?? counts.media_count ?? entity.resource_cnt
        ?? entity.stats?.count_tracks ?? base.count_tracks ?? 0);
    return {
        id,
        name: text(base.title || base.name || entity.title),
        cover,
        description: text(base.desc || base.description),
        trackCount: Number.isFinite(trackCount) ? trackCount : 0,
        creator: base.owner_id ? { id: text(base.owner_id), nickname: '' } : undefined,
        artists: [],
        isOwned: options.isOwned !== undefined ? Boolean(options.isOwned) : undefined,
        owned: options.isOwned !== undefined ? Boolean(options.isOwned) : undefined,
        // 我的喜欢（type 1）在渲染层有固定 id，协议层这里标一下便于排查。
        // ownerId 必须带上：/playlist/detail/ 要它，换封面那一步也要靠它读第一首。
        providerData: { carType: Number(base.type) || 0, ownerId: text(base.owner_id) },
    };
}

export function toFoliaPlaylists(items) {
    return (Array.isArray(items) ? items : [])
        .map(item => toFoliaPlaylist(item, { isOwned: item?.isOwned }))
        .filter(Boolean);
}

// ─── 歌词 ─────────────────────────────────────────────────────────────────
//
// 车机的歌词正文是「行 + 逐字」混排：
//   [行起始ms,行时长ms]<字相对偏移,字时长,flag>字<…>字
// 渲染层两套都要：lrc 给普通滚动，yrc 给逐字高亮（parserCore 的 yrc 里字时间是
// **绝对**毫秒，所以这里把相对偏移加上行起始）。

function lrcTime(ms) {
    const total = Math.max(0, Number(ms) || 0);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const centiseconds = Math.floor((total % 1000) / 10);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

export function lyricsFromContent(content) {
    const lrcLines = [];
    const yrcLines = [];
    String(content || '').split('\n').forEach(rawLine => {
        const line = String(rawLine || '').trim();
        const timed = line.match(/^\[(\d+),(\d+)\](.*)$/);
        if (!timed) return;
        const lineStart = Math.max(0, Number(timed[1]) || 0);
        const lineDuration = Math.max(0, Number(timed[2]) || 0);
        const body = timed[3] || '';
        const wordPattern = /([<(])(\d+),(\d+),(\d+)[>)]([^<(]*)/g;
        let match;
        let plain = '';
        let yrcBody = '';
        while ((match = wordPattern.exec(body))) {
            const rawStart = Math.max(0, Number(match[2]) || 0);
            const wordDuration = Math.max(0, Number(match[3]) || 0);
            const word = String(match[5] || '');
            if (!word) continue;
            // `<` 是相对行首的偏移，`(` 已经是绝对时间（上游两种都给过）。
            const absolute = match[1] === '<'
                ? lineStart + rawStart
                : (rawStart >= Math.max(0, lineStart - 500) ? rawStart : lineStart + rawStart);
            plain += word;
            yrcBody += `(${absolute},${wordDuration},${Number(match[4]) || 0})${word}`;
        }
        if (!plain) plain = body.replace(/[<(]\d+,\d+,\d+[>)]/g, '').trim();
        if (!plain) return;
        lrcLines.push(`[${lrcTime(lineStart)}]${plain}`);
        if (yrcBody) yrcLines.push(`[${lineStart},${lineDuration}]${yrcBody}`);
    });
    return { lyric: lrcLines.join('\n'), yrc: yrcLines.join('\n'), tlyric: '' };
}

/** 歌词可能在 track entity 的几处，逐个试到有正文。 */
export function lyricsFromTrack(raw) {
    const track = trackEntity(raw);
    const entity = track?.display_info?.lyric_info?.lyric_entity || track?.lyric_info?.lyric_entity;
    return lyricsFromContent(entity?.content);
}
