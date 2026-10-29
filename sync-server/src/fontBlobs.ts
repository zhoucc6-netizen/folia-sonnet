import type { D1Database } from './app.js';

// src/fontBlobs.ts
// 「字体字节放哪」这一件事的两份实现。
//
// 一句话：不放大数据库里。
//  · 一款中文字体动辄几 MB，塞进 SQLite 的 BLOB 之后，改个名字都要整行重写；
//  · 备份文件随字体数量线性膨胀；
//  · D1 那边还有单条记录的大小上限，几 MB 的 blob 是最先撞墙的那一种；
//  · 真出错时只剩一个裸 500，日志里什么也看不出来。
//
// 所以字节各归各的文件，数据库只留元数据（名字 / 分类 / 大小 / mime）。
//
// 两份实现：
//  · `createNodeFontBlobStore` —— 落盘，自托管 Node 用这个；
//  · `createD1FontBlobStore` —— 存表，Workers 没有磁盘，只能走这个。
// fonts.ts 只认接口，不关心拿到的是哪一份。

export type FontBlobKind = 'file' | 'preview';

export interface FontBlobRecord {
    bytes: Uint8Array;
    mime: string;
}

export interface FontBlobStore {
    write(id: string, kind: FontBlobKind, bytes: Uint8Array, mime: string): Promise<void>;
    read(id: string, kind: FontBlobKind): Promise<FontBlobRecord | null>;
    remove(id: string): Promise<void>;
    /** 面板上显示用的名字，出问题时一眼能看出走的哪条路。 */
    describe(): string;
}

const toBindable = (bytes: Uint8Array): unknown => (
    typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes
);

export const toBytes = (value: unknown): Uint8Array | null => {
    if (!value) return null;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
};

/*
 * hono 的 `c.body()` 只收 `string | ArrayBuffer | ReadableStream`，
 * `Uint8Array` 不在其中（TS 里 `Uint8Array<ArrayBufferLike>` 与 `ArrayBuffer`
 * 并不兼容）。这里切出一份精确范围的 ArrayBuffer —— 不能直接拿
 * `bytes.buffer`：那可能是整块共享内存，长度比这段数据大。
 */
export const toBodyBuffer = (bytes: Uint8Array): ArrayBuffer => (
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
);

const tableOf = (kind: FontBlobKind): string => (kind === 'preview' ? 'font_previews' : 'font_files');

/** Workers / 兜底：字节进 D1 自己的两张表。 */
export const createD1FontBlobStore = (db: D1Database): FontBlobStore => ({
    write: async (id, kind, bytes, mime) => {
        if (kind === 'preview') {
            await db
                .prepare('INSERT INTO font_previews (font_id, mime, data) VALUES (?, ?, ?)')
                .bind(id, mime, toBindable(bytes))
                .run();
            return;
        }
        await db
            .prepare('INSERT INTO font_files (font_id, data) VALUES (?, ?)')
            .bind(id, toBindable(bytes))
            .run();
    },
    read: async (id, kind) => {
        const row = kind === 'preview'
            ? await db
                .prepare('SELECT mime, data FROM font_previews WHERE font_id = ?')
                .bind(id)
                .first<{ mime: string | null; data: unknown }>()
            : await db
                .prepare('SELECT data FROM font_files WHERE font_id = ?')
                .bind(id)
                .first<{ mime?: string | null; data: unknown }>();
        const bytes = toBytes(row?.data);
        if (!bytes) return null;
        return { bytes, mime: String(row?.mime ?? '') };
    },
    remove: async (id) => {
        await db.batch([
            db.prepare('DELETE FROM font_files WHERE font_id = ?').bind(id),
            db.prepare('DELETE FROM font_previews WHERE font_id = ?').bind(id),
        ]);
    },
    describe: () => 'database',
});
