import fs from 'node:fs/promises';
import path from 'node:path';
import type { FontBlobKind, FontBlobRecord, FontBlobStore } from './fontBlobs.js';

// src/fontBlobs.node.ts
// 字节落盘的那份实现 —— 只被 src/node.ts 引用，Worker 的打包图里不会有它，
// 所以这里可以放心 `import 'node:fs'`。
//
// 一个字体两个文件：
//   <dir>/<id>.font     字体本体
//   <dir>/<id>.preview  预览图
// 外加一个 <id>.meta.json 记两个 mime —— mime 不写下来的话，下次只能靠扩展名猜，
// 而上传端给的扩展名并不总是可信。
//
// 数据库那边仍然留着 `font_files` / `font_previews` 两张表：Workers 版要用，
// 老数据也还在里面。所以读的时候先找文件、找不到再回退到数据库（`fallback`）。

const META_SUFFIX = '.meta.json';

interface FontBlobMeta {
    fileMime: string;
    previewMime: string;
}

const suffixOf = (kind: FontBlobKind): string => (kind === 'preview' ? '.preview' : '.font');

/* 目录由外部决定，拼进来的 id 必须自己先过一遍 —— 不接受任何斜杠与空格。 */
const isValidId = (id: string): boolean => /^[A-Za-z0-9._-]{1,120}$/.test(id);

export const createNodeFontBlobStore = (
    dir: string,
    fallback: FontBlobStore,
): FontBlobStore => {
    const pathOf = (id: string, suffix: string): string | null => (
        isValidId(id) ? path.join(dir, `${id}${suffix}`) : null
    );

    const readMeta = async (id: string): Promise<FontBlobMeta | null> => {
        const metaPath = pathOf(id, META_SUFFIX);
        if (!metaPath) return null;
        try {
            return JSON.parse(await fs.readFile(metaPath, 'utf8')) as FontBlobMeta;
        } catch {
            return null;
        }
    };

    return {
        write: async (id, kind, bytes, mime) => {
            const target = pathOf(id, suffixOf(kind));
            if (!target) throw new Error('invalid_font_id');
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(target, bytes);
            const meta = (await readMeta(id)) ?? { fileMime: '', previewMime: '' };
            if (kind === 'preview') meta.previewMime = mime;
            else meta.fileMime = mime;
            const metaPath = pathOf(id, META_SUFFIX);
            if (metaPath) await fs.writeFile(metaPath, JSON.stringify(meta));
        },
        read: async (id, kind): Promise<FontBlobRecord | null> => {
            const target = pathOf(id, suffixOf(kind));
            if (!target) return null;
            try {
                const bytes = new Uint8Array(await fs.readFile(target));
                const meta = await readMeta(id);
                const mime = kind === 'preview'
                    ? (meta?.previewMime || 'image/png')
                    : (meta?.fileMime || 'application/octet-stream');
                return { bytes, mime };
            } catch {
                /* 文件不在 —— 可能是切到文件存储之前上传的，回退到数据库那份。 */
            }
            return await fallback.read(id, kind);
        },
        remove: async (id) => {
            const suffixes = [suffixOf('file'), suffixOf('preview'), META_SUFFIX];
            await Promise.all(suffixes.map(async (suffix) => {
                const target = pathOf(id, suffix);
                if (target) await fs.rm(target, { force: true });
            }));
            await fallback.remove(id);
        },
        describe: () => 'files',
    };
};
