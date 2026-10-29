import type { Container, Mesh, MeshGeometry, Shader, Sprite, Texture } from 'pixi.js';
import type { MonetVisibleLineEntry } from '../../../visualizer/monet/monetLyricsModel';
import { resolveMonetSweepEdgeSoftness, resolveMonetSweepEnd } from '../../../visualizer/monet/monetLyricsModel';
import { resolveMonetFillWidth, resolveMonetGlow, clampMonetProgress } from '../../../visualizer/monet/monetLyricMotion';
import { buildWordColorRangesFromMatchers, prepareWordColorMatchers, resolveTokenColorMap, resolveWordColor } from '../../../visualizer/wordColoring';
import { colorWithAlpha, mixColors, resolveGlowColorStrength } from '../../../../utils/visualizer/colorMix';
import { getLineRenderEndTime } from '../../../../utils/lyrics/renderHints';
import type { LatticeLyricInput } from './types';
import type { LatticeLineLayout, LatticeTypography, LyricPiece } from './latticeLyricLayout';
import type { LatticeRaster } from './latticeLyricRaster';
import { createLatticeQuadGeometry, createLatticeSweepShader, type LatticeSweep } from './latticeLyricFilters';

// src/components/app/lattice/lyrics/latticeLyricScene.ts
type Pixi = typeof import('pixi.js');
interface PieceView { sprite: Mesh<MeshGeometry, Shader>; glow: Sprite[]; texture: Texture; sweep: LatticeSweep;
    pad: number; width: number; height: number; piece: LyricPiece; color: string; base: number[]; }

/** Builds only the rows near the card viewport; a long lyric never allocates a song-sized texture. */
export function createLatticeLineView(pixi: Pixi, raster: LatticeRaster, parent: Container,
    entry: MonetVisibleLineEntry, layout: LatticeLineLayout, type: LatticeTypography, input: LatticeLyricInput, resolution: number) {
    const container = new pixi.Container(); parent.addChild(container);
    const near = new pixi.Container(), far = new pixi.Container(), text = new pixi.Container();
    container.addChild(far, near, text);
    const chorus = Boolean(entry.line.isChorus);
    const radii = [Math.round(type.fontPx * (chorus ? 0.45 : 0.28)), Math.round(type.fontPx * (chorus ? 0.9 : 0.65))];
    const glowFilters = radii.map(strength => new pixi.BlurFilter({ strength, quality: 3, resolution: 1 }));
    near.filters = [glowFilters[0]]; far.filters = [glowFilters[1]];
    const blur = new pixi.BlurFilter({ strength: 0, quality: 2 }); container.filters = [blur];
    const pieces = new Map<number, PieceView>();
    const quad = createLatticeQuadGeometry(pixi);
    const matchers = prepareWordColorMatchers(input.theme.wordColors, input.keywordColoringEnabled);
    const colors = resolveTokenColorMap(layout.pieces.map(p => p.token), buildWordColorRangesFromMatchers(entry.line.fullText, matchers));
    /*
     * 唱过去那一段的颜色：命中主题关键字（AI 主题的 wordColors）用关键字自己的颜色，
     * 没命中就兜到主题的**强调色** —— 与别处歌词渲染同一条规矩（classic / cadenza / fume
     * 的 resolveWordColor 兜底都是 theme.accentColor，claddagh 同理）。
     *
     * 以前这里兜的是 primaryColor：磁贴墙上「唱到的」和「没唱到的」于是同一个颜色，
     * AI 主题的高亮色在这里一点都看不出来 —— 播放页有、磁贴墙没有，差的就这一行。
     * 副歌那一条本来就是往强调色上混（与莫奈一致），不动。
     */
    const accent = chorus ? mixColors(input.theme.primaryColor, input.theme.accentColor, 0.48) : colorWithAlpha(input.theme.accentColor, 0.98);
    /*
     * 逐字着色：先按「关键字在整行里连续出现」取区间色（与 Monet 一致），取不到再按
     * **逐词**取一次 —— 用的是全应用同一条规则 resolveWordColor（中日韩默认
     * 'target-contains-token'：关键字包含这个词就算命中，不要求整句里连续出现）。
     *
     * 只有第一档时，磁贴墙的命中条件比播放页严得多：播放页那些样式（classic / cadenza /
     * fume）都是逐词 resolveWordColor，关键字与歌词里的词只要字面有交叠就上色；磁贴墙却要
     * 关键字整段落在行里。同一份 AI wordColors，于是播放页有高亮、磁贴墙一个都没有。
     */
    const resolvePieceColor = (piece: LyricPiece) => {
        if (piece.translation) return (input.subtitleTheme ?? input.theme).primaryColor;
        return colors.get(piece.token.key)
            ?? resolveWordColor(piece.text, input.theme.wordColors, accent, { keywordColoringEnabled: input.keywordColoringEnabled });
    };
    const destroyPiece = (view: PieceView) => {
        view.sprite.destroy(); view.sweep.shader.destroy(); view.glow.forEach(sprite => sprite.destroy()); view.texture.destroy(true);
    };
    const createPiece = (piece: LyricPiece): PieceView => {
        const px = piece.translation ? type.translationPx : type.fontPx;
        const image = raster.rasterize(piece.text, piece.translation ? type.translationFont : type.font, px, resolution);
        const color = resolvePieceColor(piece);
        const base = new pixi.Color(input.theme.primaryColor).toArray();
        const sweep = createLatticeSweepShader(pixi, base, new pixi.Color(color).toArray(), image.texture);
        sweep.uniforms.uGlyphRange = [(image.pad - piece.tokenOffset) / image.width, (piece.offsets.at(-1) ?? piece.width) / image.width];
        const sprite = new pixi.Mesh({ geometry: quad, shader: sweep.shader, texture: image.texture });
        sprite.scale.set(image.width, image.height);
        sprite.position.set(piece.x - image.pad, piece.y - image.pad); text.addChild(sprite);
        const glow = [near, far].map(layer => {
            const clone = new pixi.Sprite(image.texture); clone.position.copyFrom(sprite.position); layer.addChild(clone); return clone;
        });
        return { ...image, sprite, glow, sweep, piece, color, base };
    };
    const update = (time: number, status: MonetVisibleLineEntry['status'], baseAlpha: number, viewportHeight: number,
        top: number, scale: number, quiet: boolean) => {
        const maxText = status === 'active' ? Infinity : type.lineHeight * 2;
        let glowing = false;
        for (let i = 0; i < layout.pieces.length; i++) {
            const piece = layout.pieces[i];
            const y = piece.translation && status !== 'active' ? Math.min(layout.textHeight, maxText) + type.fontPx * 0.3 + piece.row * type.translationLineHeight : piece.y;
            const visible = (piece.translation ? status === 'active' : piece.y < maxText) && (top + y * scale > -type.lineHeight * 2)
                && (top + y * scale < viewportHeight + type.lineHeight * 2);
            const old = pieces.get(i);
            if (!visible) { if (old) { destroyPiece(old); pieces.delete(i); } continue; }
            const view = old ?? createPiece(piece); pieces.set(i, view);
            view.sprite.y = y - view.pad; view.glow.forEach(sprite => { sprite.y = view.sprite.y; });
            const token = piece.token, start = token.startTime ?? Infinity, end = token.endTime ?? Infinity;
            const passed = token.timed && (status === 'passed' || (status === 'active' && time > end));
            const progress = status === 'active' && token.timed ? clampMonetProgress((time - start) / Math.max(0.001, end - start)) : 0;
            const width = status === 'active' ? resolveMonetFillWidth(time, start, end, piece.offsets, token.graphemeTimings) : 0;
            const softness = resolveMonetSweepEdgeSoftness(type.fontPx);
            const front = resolveMonetSweepEnd(width, piece.offsets.at(-1) ?? 0, softness);
            const uniforms = view.sweep.uniforms;
            if (piece.translation) {
                uniforms.uBase = uniforms.uWord;
                uniforms.uBase[3] = 0.68;
            } else { view.base[3] = baseAlpha; uniforms.uBase = view.base; }
            uniforms.uProgress = progress; uniforms.uPassed = passed ? 1 : 0;
            uniforms.uFront = (front - piece.tokenOffset + view.pad) / view.width;
            uniforms.uSoftness = softness / view.width;
            const clipped = status !== 'active' && piece.row === 1 && layout.rows > 2;
            uniforms.uVerticalFade[0] = clipped ? (view.pad + type.lineHeight * 0.55) / view.height : 2;
            uniforms.uVerticalFade[1] = clipped ? (view.pad + type.lineHeight) / view.height : 3;
            const glow = !quiet && !piece.translation && token.timed && status !== 'waiting'
                ? resolveMonetGlow(time, start, end, getLineRenderEndTime(entry.line)) : 0;
            const word = uniforms.uWord;
            const r = Math.round((view.base[0] + (word[0] - view.base[0]) * glow) * 255);
            const g = Math.round((view.base[1] + (word[1] - view.base[1]) * glow) * 255);
            const b = Math.round((view.base[2] + (word[2] - view.base[2]) * glow) * 255);
            const glowAlpha = glow * (chorus ? 1 : 0.88) * resolveGlowColorStrength(r, g, b);
            glowing ||= glowAlpha > 0;
            for (const sprite of view.glow) {
                sprite.alpha = glowAlpha;
                sprite.tint = (r << 16) | (g << 8) | b;
            }
        }
        near.renderable = far.renderable = glowing;
    };
    return { container, blur, layout, entry, update,
        // quad.destroy(true) 连顶点 / 索引缓冲一起删；不传 true 时 Geometry 不动缓冲，要等 Pixi 的 GC 空闲 60 秒才删。
        destroy() { pieces.forEach(destroyPiece); pieces.clear(); blur.destroy(); glowFilters.forEach(f => f.destroy()); container.destroy({ children: true }); quad.destroy(true); },
    };
}
export type LatticeLineView = ReturnType<typeof createLatticeLineView>;
