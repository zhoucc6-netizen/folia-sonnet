import { describe, expect, it } from 'vitest';
import { parseLyricsByFormat } from '../../../src/utils/lyrics/parserCore';
import { resolveKugouLyricFormat } from '../../../src/services/onlineMusic/kugou/kugouProvider';

/*
 * 酷狗歌词的「格式」和「解析格式」对不上，是「每一首都无可用歌词」的根因：
 *
 * 桥那边（src/nativeBridge/api/kugou.js 的 downloadKGLyricByCandidate）向
 * lyrics.kugou.com/download 要的是 `fmt=lrc`（桥里没有 KRC 解密，只能要 lrc），
 * 回的 base64 解出来就是 LRC —— `[00:00.00]晴天 - 周杰伦`。
 * 而 getKugouLyrics 一直拿 'krc' 去解析它：parseKRC 的行首正则是 `\[(\d+),(\d+)\]`
 * （解密过的 KRC 才是 `[开始毫秒,时长毫秒]`），LRC 的 `[00:00.00]` 一行都匹配不上，
 * lines 就是 0，hasRenderableLyrics 为假 → 界面上「无可用歌词」，而且每一首都是。
 *
 * 这两条断言把「桥现在给的东西」钉住：桥改成真 KRC（[开始,时长]）时第 2 条会先红，
 * 那时才该把解析改回去，别反过来。
 */
const KG_BRIDGE_LRC = [
    '[ti:晴天]',
    '[ar:周杰伦]',
    '[al:叶惠美]',
    '[by:]',
    '[offset:0]',
    '[00:00.00]晴天 - 周杰伦 (Jay Chou)',
    '[00:02.25]词：周杰伦',
    '[00:04.50]曲：周杰伦',
].join('\r\n');

/** 解密过的 KRC：行首是 [开始毫秒,时长毫秒]，逐字时间跟在 <> 里。 */
const KG_DECRYPTED_KRC = [
    '[0,3000]晴<0,120,0>天<120,240,0>',
    '[3000,2500]故事的<0,100,0>小<100,200,0>黄花',
].join('\n');

describe('酷狗歌词的解析格式', () => {
    it('桥给回来的是 LRC，按 krc 解析一行都出不来（这就是「无可用歌词」）', () => {
        expect(parseLyricsByFormat('krc', KG_BRIDGE_LRC, '').lines).toHaveLength(0);
    });

    it('按内容判出来的格式解析就有词', () => {
        expect(resolveKugouLyricFormat(KG_BRIDGE_LRC)).toBe('lrc');
        const parsed = parseLyricsByFormat(resolveKugouLyricFormat(KG_BRIDGE_LRC), KG_BRIDGE_LRC, '');
        expect(parsed.lines.length).toBeGreaterThan(0);
        expect(parsed.lines[0]?.fullText).toContain('晴天');
    });

    it('真是解密过的 KRC 时仍按 krc 解析（逐字时间还在）', () => {
        expect(resolveKugouLyricFormat(KG_DECRYPTED_KRC)).toBe('krc');
        expect(parseLyricsByFormat('krc', KG_DECRYPTED_KRC, '').lines[0]?.words.length).toBeGreaterThan(1);
    });
});
