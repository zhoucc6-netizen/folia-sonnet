import { colorWithAlpha, parseColorChannels } from '../../utils/visualizer/colorMix';
import type { HarmonyTextLayout } from './harmonyOverlaySweep';

// src/components/visualizer/harmonyOverlayWebgl.ts
// 叠加歌词（HarmonyOverlay）的 WebGL2 渲染路径。
//
// 为什么要有这条路：DOM 版每帧都在重写 `mask-image: linear-gradient(...)`，浏览器就得每帧重建
// 一张渐变去当遮罩，在安卓 WebView 上是实打实的掉帧源，而且还带着一层 blur-2xl 的柔光衬底。
// 这里改成：整行文字先用系统字体烘进两张纹理（未唱 / 已唱），之后每帧只更新「推到第几像素」
// 这一个 uniform、一次 draw call，连 DOM 样式都不碰。
//
// 为什么是「画进纹理」而不是 SDF：CJK 字形是多笔画轮廓叠出来的，给它生成 SDF 会在密集字里留下
// 接缝与半透明块（diorama 那边踩过，见 dioramaTextRaster）。Canvas2D 的 fillText 用的就是浏览器
// 自己的排版与字体栈，主题字体、用户上传的自定义字体都照样吃得下。
//
// DOM 版保留在 VisualizerHarmonyOverlay.tsx 里做回退：拿不到 webgl2、着色器编译失败、draw 抛异常，
// 都退回原样 —— 最坏只是没变快，不会显示不出歌词。

const VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
    // y 要翻过来：上传纹理时没开 UNPACK_FLIP_Y，图像的顶行落在 t=0，而 NDC 的 y=1 在画布上方 ——
    // 不翻的话整行字是倒的。
    v_uv = vec2(a_pos.x, 1.0 - a_pos.y);
    gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * 一个 pass 画完柔光衬底 + 两层文本。
 *
 * 两张纹理的内容是同一段文字、同样的覆盖率（alpha），区别只在颜色 —— 所以在同一个纹素上直接
 * mix 两个 RGBA 是安全的，不必分两次绘制。混合都走标准的 source-over，输出 premultiplied
 * （画布是按 premultipliedAlpha 创建的）。
 */
const FRAG = `#version 300 es
precision mediump float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_idle;
uniform sampler2D u_active;
uniform vec2 u_boxMin;        // 文本框（含留白）在画布 uv 空间的左下角
uniform vec2 u_boxSize;       // 文本框的 uv 尺寸
uniform float u_progressPx;   // 唱到第几 CSS px，相对文本 left 边缘
uniform float u_softnessPx;   // 推进前缘的柔化宽度
uniform float u_textWidthPx;  // 文本块宽度，用于把 uv 换回 px
uniform float u_opacity;
uniform float u_drawBackground;
uniform vec3 u_bgColor;

/** 依次近似 radial-gradient 的三个停靠点：0 → 0.70、0.48 → 0.42、0.78 → 0。 */
float backgroundAlpha(float radius) {
    float fadeIn = mix(0.70, 0.42, smoothstep(0.0, 0.48, radius));
    return mix(fadeIn, 0.0, smoothstep(0.48, 0.78, radius));
}

void main() {
    vec2 local = (v_uv - u_boxMin) / max(u_boxSize, vec2(1e-6));
    bool insideBox = local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0;

    // 结果一律按预乘保存。
    vec3 rgb = vec3(0.0);
    float alpha = 0.0;

    if (!insideBox) {
        outColor = vec4(0.0);
        return;
    }

    if (u_drawBackground > 0.5) {
        float radius = length(local * 2.0 - 1.0);
        float bgAlpha = backgroundAlpha(clamp(radius, 0.0, 1.0));
        rgb = u_bgColor * bgAlpha;
        alpha = bgAlpha;
    }

    vec4 unsung = texture(u_idle, local);
    vec4 sung = texture(u_active, local);
    float xPx = local.x * u_textWidthPx;
    float coverage = 1.0 - smoothstep(u_progressPx - u_softnessPx, u_progressPx, xPx);
    // 局部变量不能叫 idle/active：active 是 GLSL 的保留字（filter 也是），用了会让着色器直接编译
    // 失败 —— 而失败时这层歌词会整个退回 DOM 版，看起来就像没改过。
    vec4 text = mix(unsung, sung, coverage);

    if (text.a > 0.0) {
        rgb = text.rgb * text.a + rgb * (1.0 - text.a);
        alpha = text.a + alpha * (1.0 - text.a);
    }

    outColor = vec4(rgb * u_opacity, alpha * u_opacity);
}
`;

interface HarmonyTextBake {
    /** 纹理的像素尺寸（两张图一样大）。 */
    pixelWidth: number;
    pixelHeight: number;
    /** 文本框（含留白）在画布 uv 空间的位置与大小。 */
    boxMinX: number;
    boxMinY: number;
    boxSizeX: number;
    boxSizeY: number;
    /** 文本框对应的 CSS px 尺寸。 */
    textWidth: number;
    textHeight: number;
}

export interface HarmonyOverlayFrameInput {
    /** 画布的 CSS 尺寸。 */
    cssWidth: number;
    cssHeight: number;
    dpr: number;
    /** 唱到第几 CSS px（相对文本块左边缘），见 resolveHarmonySweepWidth。 */
    progressPx: number;
    /** 推进前缘的柔化宽度（CSS px）。 */
    softnessPx: number;
    /** 进出场动画的整体不透明度。 */
    opacity: number;
    layout: HarmonyTextLayout;
    fontSpec: string;
    /** 未唱部分的不透明度，与 DOM 版底层那条 0.56 对齐。 */
    idleAlpha: number;
    drawBackground: boolean;
    backgroundColor: string;
}

/** 纹理边长上限：过长会把 measureText 之外的显存也吃掉，且移动 GPU 常见上限就是 4096。 */
const MAX_TEXTURE_EDGE = 2048;

/** 与 bakeText 里同一套留白算法，画布用它算自己该多高。 */
const resolvePadding = (layout: HarmonyTextLayout): number => (
    Math.max(24, Math.round(layout.rowHeight * 0.6))
);

/** 画布需要的高度（CSS px）：文字加上两侧留白。行数变了这个值才会变。 */
export const resolveHarmonyCanvasHeight = (layout: HarmonyTextLayout): number => (
    layout.rows.length === 0 ? 0 : layout.height + resolvePadding(layout) * 2
);

const toRgb = (color: string): [number, number, number] => {
    const channels = parseColorChannels(color);
    if (!channels) return [0, 0, 0];
    return [channels.r / 255, channels.g / 255, channels.b / 255];
};

export class HarmonyOverlayRenderer {
    private gl: WebGL2RenderingContext | null = null;

    private program: WebGLProgram | null = null;

    private vao: WebGLVertexArrayObject | null = null;

    private vbo: WebGLBuffer | null = null;

    private idleTex: WebGLTexture | null = null;

    private activeTex: WebGLTexture | null = null;

    private readonly idleSlot = 0;

    private readonly activeSlot = 1;

    private bakeKey = '';

    private bake: HarmonyTextBake | null = null;

    /** 上一次烘纹理时的输入，用来跳过每帧的 key 拼接。 */
    private lastBakeInput: HarmonyOverlayFrameInput | null = null;

    private uniform: Record<string, WebGLUniformLocation | null> = {};

    constructor(readonly canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: true,
            antialias: true,
            powerPreference: 'high-performance',
        });
        if (!gl) return;
        this.gl = gl;
        this.program = this.link(VERT, FRAG);
        if (!this.program) return;

        for (const name of [
            'u_idle',
            'u_active',
            'u_boxMin',
            'u_boxSize',
            'u_progressPx',
            'u_softnessPx',
            'u_textWidthPx',
            'u_opacity',
            'u_drawBackground',
            'u_bgColor',
        ]) {
            this.uniform[name] = gl.getUniformLocation(this.program, name);
        }

        // 一个覆盖全画布的四边形，顶点写死一次；之后每帧只改 uniform。
        this.vbo = gl.createBuffer();
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        this.idleTex = gl.createTexture();
        this.activeTex = gl.createTexture();

        gl.useProgram(this.program);
        gl.uniform1i(this.uniform.u_idle, this.idleSlot);
        gl.uniform1i(this.uniform.u_active, this.activeSlot);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    get isReady(): boolean {
        return Boolean(this.gl && this.program && this.vao);
    }

    draw(input: HarmonyOverlayFrameInput): void {
        const gl = this.gl;
        const program = this.program;
        if (!gl || !program || !this.vao) return;

        const pixelWidth = Math.max(1, Math.round(input.cssWidth * input.dpr));
        const pixelHeight = Math.max(1, Math.round(input.cssHeight * input.dpr));
        if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
        if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;

        this.ensureBake(input);
        gl.viewport(0, 0, pixelWidth, pixelHeight);
        // 画布会跟着容器变（转屏、面板收起），底色先清干净，否则留下上一帧的残影。
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const bake = this.bake;
        if (!bake) return;

        gl.useProgram(program);
        const bg = toRgb(input.backgroundColor);
        gl.uniform2f(this.uniform.u_boxMin, bake.boxMinX, bake.boxMinY);
        gl.uniform2f(this.uniform.u_boxSize, bake.boxSizeX, bake.boxSizeY);
        gl.uniform1f(this.uniform.u_progressPx, input.progressPx);
        gl.uniform1f(this.uniform.u_softnessPx, Math.max(input.softnessPx, 0.5));
        gl.uniform1f(this.uniform.u_textWidthPx, bake.textWidth);
        gl.uniform1f(this.uniform.u_opacity, Math.max(0, Math.min(1, input.opacity)));
        gl.uniform1f(this.uniform.u_drawBackground, input.drawBackground ? 1 : 0);
        gl.uniform3f(this.uniform.u_bgColor, bg[0], bg[1], bg[2]);

        gl.activeTexture(gl.TEXTURE0 + this.idleSlot);
        gl.bindTexture(gl.TEXTURE_2D, this.idleTex);
        gl.activeTexture(gl.TEXTURE0 + this.activeSlot);
        gl.bindTexture(gl.TEXTURE_2D, this.activeTex);

        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    /**
     * 只删自己建的 GL 对象，不动上下文。
     *
     * 上下文被系统收走（安卓 WebView 常见）之后要等 `webglcontextrestored` 才能重画，那时候还得
     * 用同一个上下文重新建 program 和纹理 —— 所以这里不能顺手 `loseContext()`，否则刚恢复就又被
     * 自己弄死了。
     */
    dispose(): void {
        const gl = this.gl;
        if (!gl) return;
        gl.deleteTexture(this.idleTex);
        gl.deleteTexture(this.activeTex);
        gl.deleteBuffer(this.vbo);
        gl.deleteVertexArray(this.vao);
        gl.deleteProgram(this.program);
        this.program = null;
        this.bake = null;
        this.bakeKey = '';
        this.lastBakeInput = null;
    }

    /** 整块不要了：画布即将从文档里摘掉，顺手把上下文还回去。 */
    release(): void {
        const gl = this.gl;
        if (!gl) return;
        this.dispose();
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        this.gl = null;
    }

    /**
     * 布局 / 字号 / 主题色任一变化都要重烘纹理，用它们的组合值当 key。
     *
     * 这条路径每帧都会进来，所以先走一遍廉价的字段比较：layout 由调用方 memo 住（同一句歌词用
     * 同一个对象），绝大多数帧到这里就返回了，连字符串都不用拼。
     */
    private ensureBake(input: HarmonyOverlayFrameInput): void {
        const last = this.lastBakeInput;
        if (this.bake && last && last.layout === input.layout
            && last.cssWidth === input.cssWidth
            && last.cssHeight === input.cssHeight
            && last.dpr === input.dpr
            && last.fontSpec === input.fontSpec
            && last.backgroundColor === input.backgroundColor
            && last.idleAlpha === input.idleAlpha) {
            return;
        }
        const key = [
            Math.round(input.layout.width * 4),
            Math.round(input.layout.height * 4),
            Math.round(input.cssWidth * 4),
            Math.round(input.cssHeight * 4),
            input.dpr,
            input.fontSpec,
            input.backgroundColor,
            input.idleAlpha,
            input.layout.rows.map(row => row.pieces.map(piece => `${piece.color}\u0002${piece.text}`).join('')).join('\u0001'),
        ].join('\u0000');
        if (this.bakeKey === key && this.bake) {
            this.lastBakeInput = input;
            return;
        }
        this.bakeKey = key;
        this.lastBakeInput = input;
        this.bake = this.bakeText(input);
    }

    private bakeText(input: HarmonyOverlayFrameInput): HarmonyTextBake | null {
        const gl = this.gl;
        const { layout } = input;
        if (!gl || layout.rows.length === 0 || layout.width <= 0 || layout.height <= 0) return null;

        // 留白：斜边抗锯齿、字形溢出都需要余量，衬底的椭圆也该比文字大一圈。
        const padding = resolvePadding(layout);
        const cssWidth = layout.width + padding * 2;
        const cssHeight = layout.height + padding * 2;
        const scale = Math.min(input.dpr, MAX_TEXTURE_EDGE / Math.max(cssWidth, cssHeight));
        const pixelWidth = Math.max(1, Math.min(MAX_TEXTURE_EDGE, Math.round(cssWidth * scale)));
        const pixelHeight = Math.max(1, Math.min(MAX_TEXTURE_EDGE, Math.round(cssHeight * scale)));

        const paint = (colored: boolean): HTMLCanvasElement | null => {
            const canvas = document.createElement('canvas');
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
            const context = canvas.getContext('2d');
            if (!context) return null;
            context.scale(scale, scale);
            context.font = input.fontSpec;
            context.textBaseline = 'alphabetic';
            context.textAlign = 'left';
            layout.rows.forEach((row, rowIndex) => {
                // 每行居中，跟 DOM 版的 text-center 对齐。
                const rowLeft = padding + (layout.width - row.width) / 2;
                const baseline = padding + rowIndex * layout.rowHeight + layout.rowHeight * 0.78;
                row.pieces.forEach(piece => {
                    context.fillStyle = colored ? piece.color : colorWithAlpha(piece.color, input.idleAlpha);
                    context.fillText(piece.text, rowLeft + piece.x, baseline);
                });
            });
            return canvas;
        };

        const idleCanvas = paint(false);
        const activeCanvas = paint(true);
        if (!idleCanvas || !activeCanvas) return null;

        this.uploadTexture(this.idleTex, this.idleSlot, idleCanvas);
        this.uploadTexture(this.activeTex, this.activeSlot, activeCanvas);

        // 文本框在画布里居中：画布两侧可能有富余（宽度受 min(屏宽, max-w-4xl) 夹着）。
        const boxWidthCss = pixelWidth / input.dpr;
        const boxHeightCss = pixelHeight / input.dpr;
        return {
            pixelWidth,
            pixelHeight,
            boxMinX: (input.cssWidth - boxWidthCss) / 2 / input.cssWidth,
            boxMinY: (input.cssHeight - boxHeightCss) / 2 / input.cssHeight,
            boxSizeX: boxWidthCss / input.cssWidth,
            boxSizeY: boxHeightCss / input.cssHeight,
            textWidth: layout.width,
            textHeight: layout.height,
        };
    }

    private uploadTexture(texture: WebGLTexture | null, slot: number, source: HTMLCanvasElement): void {
        const gl = this.gl;
        if (!gl || !texture) return;
        gl.activeTexture(gl.TEXTURE0 + slot);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // 字形边必须用真 alpha 参与上面的 mix；改成预乘会让 mix 出来的颜色偏暗。
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    private link(vertexSource: string, fragmentSource: string): WebGLProgram | null {
        const gl = this.gl;
        if (!gl) return null;
        const compile = (type: number, source: string): WebGLShader | null => {
            const shader = gl.createShader(type);
            if (!shader) return null;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.warn('[harmony] shader compile failed:', gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        };
        const vertex = compile(gl.VERTEX_SHADER, vertexSource);
        const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
        if (!vertex || !fragment) return null;
        const program = gl.createProgram();
        if (!program) return null;
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        gl.useProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.warn('[harmony] program link failed:', gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            return null;
        }
        return program;
    }
}
