// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mapKGSong } from '../../../src/nativeBridge/api/kugou.js';

// test/unit/onlineMusic/kugouArtistMapping.test.ts
//
// 背景：用户报「酷狗的我喜欢歌单歌曲作者全是未知，其他歌单正常」。
// 行映射里歌手字段的取值原来是 `item.authors || item.singerinfo || ...` —— 取第一个**非空**值，
// 而空数组 `[]` 也是非空值，于是 `authors: []` 会把后面真正带歌手的字段整个挡住。
// 这里把「逐个候选试到有为止」以及几种真实见过的形态都锁住。

const song = (item: Record<string, unknown>) => mapKGSong(item, false);

describe('mapKGSong 的歌手解析', () => {
    it('空数组的作者字段不该挡住后面的歌手字符串', () => {
        const mapped = song({ hash: 'A1', songname: '稻香', authors: [], singername: '周杰伦' });
        expect(mapped.artist).toBe('周杰伦');
    });

    it('作者字段是对象的单数形态也能取到', () => {
        const mapped = song({ hash: 'A2', songname: '稻香', singerinfo: { singername: '周杰伦' } });
        expect(mapped.artist).toBe('周杰伦');
    });

    it('作者数组是字符串数组时不会解析成空', () => {
        const mapped = song({ hash: 'A3', songname: '稻香', authors: ['周杰伦', '方文山'] });
        expect(mapped.artist).toBe('周杰伦 / 方文山');
    });

    it('作者藏在 audio_info 里也能取到', () => {
        const mapped = song({ hash: 'A4', songname: '稻香', audio_info: { singername: '周杰伦' } });
        expect(mapped.artist).toBe('周杰伦');
    });

    it('单数歌手字段是对象时会拆出名字', () => {
        const mapped = song({ hash: 'A5', songname: '稻香', singer: { name: '周杰伦' } });
        expect(mapped.artist).toBe('周杰伦');
    });

    it('一行里只有「歌手 - 歌名」的文件名时从文件名拆', () => {
        const mapped = song({ hash: 'A6', filename: '周杰伦 - 稻香.mp3' });
        expect(mapped.artist).toBe('周杰伦');
        expect(mapped.name).toBe('稻香');
    });

    it('带高亮标签的歌手名会被清掉标签', () => {
        const mapped = song({ hash: 'A7', songname: '稻香', singername: '<em>周杰伦</em>' });
        expect(mapped.artist).toBe('周杰伦');
    });

    it('歌手 id 是数字时不会把它当名字', () => {
        const mapped = song({ hash: 'A8', songname: '稻香', singername: 3520 });
        expect(mapped.artist).toBe('');
    });

    it('确实没有歌手信息时留空（界面自己显示「未知」）', () => {
        const mapped = song({ hash: 'A9', songname: '稻香' });
        expect(mapped.artist).toBe('');
    });

    it('歌手 id 仍然能从 authors 里带出来', () => {
        const mapped = song({ hash: 'AA', songname: '稻香', authors: [{ author_name: '周杰伦', author_id: 3520 }] });
        expect(mapped.artist).toBe('周杰伦');
        expect(mapped.singerId).toBe('3520');
    });
});
