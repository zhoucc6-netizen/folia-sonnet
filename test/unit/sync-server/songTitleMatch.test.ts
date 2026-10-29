import { describe, expect, it } from 'vitest';
import {
    isSongTitleCandidate,
    looseSongTitle,
    rankSongTitleMatch,
    songTitleKey,
} from '../../../sync-server/src/songTitleMatch';

// test/unit/sync-server/songTitleMatch.test.ts
// 「同一首歌」在各平台上的名字并不一致，精确键没命中时能不能靠歌名捞到那条缓存，
// 全看这里压得对不对。
//
// 判「合不合规」仍然是客户端拿高亮词一条一条对（highlightWordsPresent）—— 这里放宽
// 的是**候选的入口**，不是判定：多给几条没关系，给错了也还有那一层兜着。

describe('songTitleKey —— 压成核心名', () => {
    it('削掉括号里的备注', () => {
        expect(songTitleKey('晴天 (Live)')).toBe(songTitleKey('晴天'));
        expect(songTitleKey('晴天（Live）')).toBe(songTitleKey('晴天'));
        expect(songTitleKey('晴天【伴奏】')).toBe(songTitleKey('晴天'));
        expect(songTitleKey('晴天[Live]')).toBe(songTitleKey('晴天'));
    });

    it('削掉后缀', () => {
        expect(songTitleKey('稻香 Remix')).toBe(songTitleKey('稻香'));
        expect(songTitleKey('稻香 现场版')).toBe(songTitleKey('稻香'));
        expect(songTitleKey('稻香 (钢琴版)')).toBe(songTitleKey('稻香'));
        expect(songTitleKey('稻香 feat. 某人')).toBe(songTitleKey('稻香'));
        expect(songTitleKey('稻香 Acoustic')).toBe(songTitleKey('稻香'));
    });

    it('后缀叠着写也削得掉', () => {
        expect(songTitleKey('稻香 Live Ver.')).toBe(songTitleKey('稻香'));
    });

    it('压掉标点、空格与大小写', () => {
        expect(songTitleKey('Someone Like You')).toBe(songTitleKey('someonelikeyou'));
        expect(songTitleKey('Someone Like You (Live)')).toBe(songTitleKey('Someone Like You'));
        expect(songTitleKey('七里香 ')).toBe(songTitleKey('七里香'));
    });

    /*
     * 「请求更长」那一种以前永远配不上：库里存的是「晴天」，手上这首叫「晴天 (Live)」。
     * 光靠 SQL 的 LIKE '%晴天 (Live)%' 是配不到「晴天」的 —— 得先把请求压短。
     */
    it('把请求那一侧也压短，才配得上库里的短名', () => {
        expect(songTitleKey('晴天 (Live)')).toBe('晴天');
    });
});

describe('looseSongTitle —— 拿去问数据库的那个名字', () => {
    /*
     * 压掉空格就配不上库里原样的「Someone Like You」了 —— SQL 的 LIKE 要比的是
     * 库里那条字符串，所以这一层必须留着空格。
     */
    it('保留空格与标点', () => {
        expect(looseSongTitle('Someone Like You (Live)')).toBe('Someone Like You');
        expect(looseSongTitle('晴天 (Live)')).toBe('晴天');
    });

    it('空输入不会变成 undefined', () => {
        expect(looseSongTitle('')).toBe('');
        expect(songTitleKey('')).toBe('');
    });
});

describe('rankSongTitleMatch —— 谁该排前面', () => {
    it('归一后完全一样最优先', () => {
        expect(rankSongTitleMatch('晴天 (Live)', '晴天')).toBe(0);
        expect(rankSongTitleMatch('晴天', '晴天 (Live)')).toBe(0);
    });

    it('一边更长就算包含', () => {
        expect(rankSongTitleMatch('晴天 电影主题曲', '晴天')).toBe(1);
        expect(rankSongTitleMatch('晴天', '晴天 电影主题曲')).toBe(2);
    });

    /* 「现场」「Live」这些是噪声，削完之后两边应当完全相等，而不是落进「包含」。 */
    it('削掉噪声后落回完全相等', () => {
        expect(rankSongTitleMatch('晴天 现场', '晴天')).toBe(0);
        expect(rankSongTitleMatch('晴天 (Live)', '晴天')).toBe(0);
    });

    it('归一后对不上就不算候选', () => {
        expect(rankSongTitleMatch('七里香', '晴天')).toBe(3);
        expect(isSongTitleCandidate('七里香', '晴天')).toBe(false);
    });

    /*
     * 歌名整个就是噪声（就叫「Live」）时压不出核心名 —— 拿它做模糊匹配会把半个库
     * 都捞回来，宁可一条不给。
     */
    it('压不出核心名的不算候选', () => {
        expect(songTitleKey('Live')).toBe('');
        expect(isSongTitleCandidate('晴天', 'Live')).toBe(false);
        expect(isSongTitleCandidate('', '晴天')).toBe(false);
    });

    it('同分时新的排在前面由调用方按 updated_at 定，这里只保证同分', () => {
        expect(rankSongTitleMatch('晴天 (Live)', '晴天（现场版）')).toBe(0);
    });
});
