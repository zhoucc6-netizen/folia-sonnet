import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PaperShaderElement } from '@paper-design/shaders';
import { Dithering, MeshGradient } from '@paper-design/shaders-react';
import type { MotionValue } from 'framer-motion';
import {
    DEFAULT_LATENT_BACKGROUND_TUNING,
    type AudioBands,
    type LatentBackgroundColorSource,
    type LatentBackgroundTuning,
    type Theme,
} from '../../../../types';
import { extractRepresentativeColors } from '../../../../utils/colorExtractor';
import { updatePaperShaderUniforms } from '../../../../utils/paperShaderUniforms';
import { createPaperShaderReleaseRef, PAPER_SHADER_CONTEXT_ATTRIBUTES } from '../../../../utils/paperShaderContext';
import { useFirstFrameDrawn } from '../../styleTransition/firstFrame';
import { useBlendedColors } from '../useBlendedColors';

// src/components/visualizer/backgrounds/latent/LatentBackground.tsx
// Layers two cover-colored Paper shaders and drives their uniforms without React frame updates.
//
interface LatentBackgroundProps {
    theme: Theme;
    coverUrl?: string | null;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    staticMode: boolean;
    paused: boolean;
    tuning?: LatentBackgroundTuning;
    /** How long new colours take to blend in (useBlendedColors); 0 or left out, at once. */
    blendMs?: number;
    /** Where given, the blend plays along this instead (useBlendedColors). */
    blendProgress?: MotionValue<number>;
}

const MAX_SHADER_PIXELS = 1280 * 720;
/**
 * 这条循环隔多久真正处理一帧。
 *
 * 它驱动的是**全屏**的东西：mesh 与抖动各是一个 1280×720 的 WebGL canvas，每往那两个
 * `absolute inset-0` 的层上写一次 filter / opacity，整屏就要重新合成一遍 —— 手机上这是最贵
 * 的一类开销，而它换来的只是「颜色随音乐微微变浓 / 变亮」。
 *
 * 但那是个**慢变量**：值先被 0.12~0.16 的 ease 平滑过，60Hz 里相邻两帧的差异远在人眼可辨
 * 之下 —— 一半的帧是白干的。降到 ~30Hz，JS 与合成各砍一半，观感不变。
 *
 * ⚠️ 别把它当成还能往上加的档位：30Hz 是「不再白干」，不是「还嫌多」。真要再省，动的是
 * **每帧写了什么**（见下面那两笔被删掉的 transform），不是这个间隔。
 *
 * 平滑系数（0.12 那几个）是按**帧**算的，降频后响应会慢一倍 —— 背景渐变慢一点更柔和，
 * 这里不补偿。下面 `pauseStep` 那条是按 dt 算的，降频不会让它失真。
 */
const AUDIO_RESPONSE_INTERVAL_MS = 33;
const PAUSED_SPEED_SCALE = 0.12;
// How fast the speed goes from playing to paused or back, as a time constant: settled in about a second.
const PAUSE_EASE_MS = 300;
const normalizeAudio = (value: number) => Math.min(1, Math.max(0, value / 255));
const clampShaderSpeed = (value: number) => Math.min(2, Math.max(0, value));
const clampAudioAmount = (value: number) => Math.min(1, Math.max(0, value));
const easeTowards = (current: number, target: number, amount: number) => (
    current + (target - current) * amount
);
/**
 * 把连续值压成台阶，好让 `writeLayerStyle` 的去重真的挡得住。
 *
 * 平滑后的音频值**每帧都在动**，哪怕只动 0.001 —— 写进 style 就是一次全屏重合成，而那两个
 * 层是全屏的。量化到 0.02 之后，大多数帧算出来的值和上一帧落在同一档，去重生效，真正的
 * 写入从「每帧」变成「偶尔」。
 *
 * 0.02 是观感的下限：再粗，颜色/颗粒度就会一格一格地跳。
 */
const quantize = (value: number, step: number) => (Math.round(value / step) * step).toFixed(2);
export const resolveLatentBroadbandEnergy = (
    bass: number,
    lowMid: number,
    mid: number,
    vocal: number,
    treble: number,
) => {
    const broadbandEnergy = (
        normalizeAudio(bass) * 0.22
        + normalizeAudio(lowMid) * 0.18
        + normalizeAudio(mid) * 0.22
        + normalizeAudio(vocal) * 0.28
        + normalizeAudio(treble) * 0.1
    );
    return Math.pow(broadbandEnergy, 0.55);
};
// Accents broadband energy rises so shader speed lands on musical onsets instead of following loudness alone.
export const resolveLatentOnsetPulse = (
    currentEnergy: number,
    previousEnergy: number,
    previousPulse: number,
) => Math.max(
    previousPulse * 0.84,
    clampAudioAmount((currentEnergy - previousEnergy) * 7),
);
export const resolveLatentBeatSpeedTarget = (
    broadbandEnergy: number,
    onsetPulse: number,
) => clampAudioAmount(broadbandEnergy * 0.42 + onsetPulse * 0.85);
export const resolveLatentAudioSpeedTarget = (
    broadbandEnergy: number,
    onsetPulse: number,
    enhancedBeatResponse: boolean,
) => enhancedBeatResponse
    ? resolveLatentBeatSpeedTarget(broadbandEnergy, onsetPulse)
    : clampAudioAmount(broadbandEnergy);
export const resolveLatentShaderSpeed = (
    baseSpeed: number,
    audioSpeed: number,
    audioAmount: number,
    paused: boolean,
) => clampShaderSpeed(
    paused
        ? baseSpeed * PAUSED_SPEED_SCALE
        : easeTowards(baseSpeed, audioSpeed, audioAmount),
);
export const resolveLatentShaderColors = (
    coverColors: string[],
    theme: Theme,
    colorSource: LatentBackgroundColorSource,
) => {
    const primary = coverColors[0] ?? theme.secondaryColor;
    if (colorSource === 'cover-only') {
        const secondary = coverColors[1] ?? primary;
        const tertiary = coverColors[2] ?? secondary;
        const quaternary = coverColors[3] ?? primary;
        const quinary = coverColors[4] ?? secondary;
        const senary = coverColors[5] ?? tertiary;
        return {
            ditheringBack: tertiary,
            ditheringFront: primary,
            mesh: [primary, secondary, tertiary, quaternary, quinary, senary],
        };
    }
    const secondary = coverColors[1] ?? theme.primaryColor;
    const tertiary = coverColors[2] ?? primary;
    const quaternary = coverColors[3] ?? secondary;
    return {
        ditheringBack: theme.backgroundColor,
        ditheringFront: primary,
        mesh: [primary, secondary, tertiary, quaternary, theme.backgroundColor, theme.accentColor],
    };
};

const LatentBackground: React.FC<LatentBackgroundProps> = ({
    theme,
    coverUrl,
    audioPower,
    audioBands,
    staticMode,
    paused,
    tuning: tuningOverride,
    blendMs = 0,
    blendProgress,
}) => {
    const ditheringRef = useRef<PaperShaderElement | null>(null);
    const meshRef = useRef<PaperShaderElement | null>(null);
    // Stable callback refs: they also lose each shader's WebGL context when it unmounts.
    const ditheringShaderRef = useMemo(() => createPaperShaderReleaseRef(ditheringRef), []);
    const meshShaderRef = useMemo(() => createPaperShaderReleaseRef(meshRef), []);
    const ditheringLayerRef = useRef<HTMLDivElement | null>(null);
    const meshLayerRef = useRef<HTMLDivElement | null>(null);
    const pausedRef = useRef(paused);
    // How far the loop below has eased between paused (0) and playing (1). Outside the loop's effect,
    // so a re-run of it (a setting changed mid-ease) goes on from there.
    const playingRef = useRef(paused ? 0 : 1);
    const [coverColors, setCoverColors] = useState<string[]>([]);
    const tuning = tuningOverride ?? DEFAULT_LATENT_BACKGROUND_TUNING;
    const showDithering = tuning.displayMode !== 'mesh';
    const showMesh = tuning.displayMode !== 'dithering';
    pausedRef.current = paused;
    // A copy mounted for a change of type is ready once the cover's colours are read.
    const colorsDrawn = useFirstFrameDrawn();

    useEffect(() => {
        let active = true;

        if (!coverUrl) {
            setCoverColors([]);
            colorsDrawn();
            return () => {
                active = false;
            };
        }

        void extractRepresentativeColors(coverUrl, 6).then(colors => {
            if (active) {
                setCoverColors(colors);
                colorsDrawn();
            }
        });

        return () => {
            active = false;
        };
    }, [coverUrl, colorsDrawn]);

    // A new song's colours blend in where the host plays transitions: a second copy for the soft focus
    // would mount and compile both shaders again on every song change.
    const resolvedColors = useMemo(
        () => resolveLatentShaderColors(coverColors, theme, tuning.colorSource),
        [coverColors, theme, tuning.colorSource],
    );
    const blendedColors = useBlendedColors(
        [theme.backgroundColor, resolvedColors.ditheringBack, resolvedColors.ditheringFront, ...resolvedColors.mesh],
        blendMs,
        blendProgress,
    );
    const [backgroundColor, ditheringBack, ditheringFront] = blendedColors;
    const shaderColors = useMemo(
        () => ({ ditheringBack, ditheringFront, mesh: blendedColors.slice(3) }),
        [blendedColors, ditheringBack, ditheringFront],
    );

    useEffect(() => {
        const ditheringMount = ditheringRef.current?.paperShaderMount;
        const meshMount = meshRef.current?.paperShaderMount;

        if (staticMode) {
            ditheringMount?.setSpeed(0);
            meshMount?.setSpeed(0);
            return;
        }

        let animationFrame = 0;
        // The full-screen layers' last written styles: once the smoothed audio settles (paused,
        // silence) the strings stop changing, and the layers are left alone instead of being
        // handed the same filter every frame.
        const writtenStyles = new WeakMap<HTMLElement, Partial<Record<'opacity' | 'transform' | 'filter', string>>>();
        const writeLayerStyle = (element: HTMLElement, property: 'opacity' | 'transform' | 'filter', value: string) => {
            let written = writtenStyles.get(element);
            if (!written) {
                written = {};
                writtenStyles.set(element, written);
            }
            if (written[property] === value) return;
            written[property] = value;
            element.style[property] = value;
        };
        let smoothedPower = 0;
        let smoothedBass = 0;
        let smoothedMid = 0;
        let smoothedBeatSpeed = 0;
        let previousBeatEnergy = 0;
        let latentOnsetPulse = 0;
        // A pause slows the fluid over about a second and play speeds it up the same way, as the sound
        // does: a pause of a moment (the player reads paused while the next track loads) is not a
        // stop and a lurch.
        let lastFrameAt: number | null = null;
        const speedOf = (baseSpeed: number, audioSpeed: number) => easeTowards(
            resolveLatentShaderSpeed(baseSpeed, audioSpeed, smoothedBeatSpeed, true),
            resolveLatentShaderSpeed(baseSpeed, audioSpeed, smoothedBeatSpeed, false),
            playingRef.current,
        );

        // Keep audio-rate changes inside the shader/DOM layer so React only rerenders on palette changes.
        const updateAudioResponse = (frameAt: number) => {
            // Asked for first, so that in the next frame this runs ahead of the shader mounts' own
            // frame callbacks: the uniforms written below (updatePaperShaderUniforms, which leaves the
            // drawing to a running shader's own loop) are then in the frame that loop draws.
            animationFrame = requestAnimationFrame(updateAudioResponse);
            // 60Hz 里只处理一半的帧：见 AUDIO_RESPONSE_INTERVAL_MS。shader 自己那条动画循环
            // 照旧 60Hz 在跑（它只是被喂 uniform），所以画面不会因为这里降频而变卡。
            if (lastFrameAt !== null && frameAt - lastFrameAt < AUDIO_RESPONSE_INTERVAL_MS) return;

            const isPaused = pausedRef.current;
            // By the time since the last frame: as fast at any frame rate.
            const pauseStep = lastFrameAt === null ? 0 : 1 - Math.exp((lastFrameAt - frameAt) / PAUSE_EASE_MS);
            lastFrameAt = frameAt;
            playingRef.current = easeTowards(playingRef.current, isPaused ? 0 : 1, pauseStep);
            const targetPower = isPaused ? 0 : normalizeAudio(audioPower.get());
            const targetBass = isPaused ? 0 : normalizeAudio(audioBands.bass.get());
            const targetBeatEnergy = isPaused
                ? 0
                : resolveLatentBroadbandEnergy(
                    audioBands.bass.get(),
                    audioBands.lowMid.get(),
                    audioBands.mid.get(),
                    audioBands.vocal.get(),
                    audioBands.treble.get(),
                );
            const targetMid = isPaused
                ? 0
                : normalizeAudio(Math.max(audioBands.mid.get(), audioBands.vocal.get()));
            smoothedPower = easeTowards(smoothedPower, targetPower, 0.12);
            smoothedBass = easeTowards(smoothedBass, targetBass, 0.16);
            smoothedMid = easeTowards(
                smoothedMid,
                targetMid,
                0.13,
            );
            // The band onset keeps tracking while the beats drive the pulse, so falling back (a track
            // with no beats) picks up from the current state rather than from a stale one.
            latentOnsetPulse = tuning.enhancedBeatResponse
                ? resolveLatentOnsetPulse(
                    targetBeatEnergy,
                    previousBeatEnergy,
                    latentOnsetPulse,
                )
                : 0;
            previousBeatEnergy = targetBeatEnergy;
            const beatSpeedTarget = resolveLatentAudioSpeedTarget(
                targetBeatEnergy,
                latentOnsetPulse,
                tuning.enhancedBeatResponse,
            );
            smoothedBeatSpeed = easeTowards(
                smoothedBeatSpeed,
                beatSpeedTarget,
                beatSpeedTarget > smoothedBeatSpeed ? 0.42 : 0.14,
            );

            const currentDitheringMount = ditheringRef.current?.paperShaderMount;
            const currentMeshMount = meshRef.current?.paperShaderMount;

            if (currentDitheringMount) {
                const ditheringSpeed = speedOf(tuning.ditheringSpeed, tuning.ditheringAudioSpeed);
                currentDitheringMount.setSpeed(ditheringSpeed);
                updatePaperShaderUniforms(currentDitheringMount, {
                    u_pxSize: Math.max(0.5, tuning.ditheringSize - smoothedBass * tuning.ditheringSize * 0.34),
                }, ditheringSpeed !== 0);
            }
            if (currentMeshMount) {
                const meshSpeed = speedOf(tuning.meshSpeed, tuning.meshAudioSpeed);
                currentMeshMount.setSpeed(meshSpeed);
                updatePaperShaderUniforms(currentMeshMount, {
                    u_distortion: tuning.meshDistortion + smoothedPower * 0.62,
                    u_swirl: tuning.meshSwirl + smoothedMid * 0.38,
                }, meshSpeed !== 0);
            }

            if (ditheringLayerRef.current) {
                writeLayerStyle(ditheringLayerRef.current, 'opacity', showMesh
                    ? quantize(Math.min(1, tuning.ditheringOpacity + smoothedBass * 0.25), 0.02)
                    : '1');
                /*
                 * 这里原来还有一笔 `transform: scale(1.015→1.04)`。2.5% 的缩放压在一层抖动
                 * 颗粒上根本看不出来，而这一层的 `mix-blend-mode: soft-light` 要读身后的 mesh
                 * 才能混合 —— 于是它每动一次，就是一整屏的 soft-light 重算。删掉；静态初始值
                 * `scale(1.015)` 留在下面 CSS 里，观感不变。
                 */
            }
            if (meshLayerRef.current) {
                writeLayerStyle(meshLayerRef.current, 'filter', `saturate(${quantize(1.04 + smoothedMid * 0.34, 0.02)}) brightness(${quantize(0.94 + smoothedPower * 0.16, 0.02)})`);
                /*
                 * 同样删掉 `transform: scale(1.025→1.043)`。1.8% 的缩放压在一团大色块渐变上
                 * 没有可辨识的位移，它实际起作用的只是「把边缘推出画外一点、别露白」—— 那一
                 * 部分是**静态**的，下面 CSS 里已经写死 `scale(1.025)`。动的那一半纯是每帧白
                 * 交的合成费，而且和上面的 filter 挤在同一个元素上，两个一起更贵。
                 */
            }
        };

        animationFrame = requestAnimationFrame(updateAudioResponse);
        return () => cancelAnimationFrame(animationFrame);
    }, [audioBands, audioPower, showMesh, staticMode, tuning]);

    // The shaders' `speed` prop is only where they start, and 0 where static: the frame loop sets the
    // speed from there and eases a pause in. A prop that followed `paused` would set it at once.
    return (
        <div
            className="absolute inset-0 z-0 overflow-hidden"
            style={{ backgroundColor, pointerEvents: 'none' }}
        >
            {showMesh && (
                <div
                    ref={meshLayerRef}
                    className="absolute inset-0"
                    style={{ transform: 'scale(1.025)', transformOrigin: 'center' }}
                >
                    <MeshGradient
                        ref={meshShaderRef}
                        width="100%"
                        height="100%"
                        colors={shaderColors.mesh}
                        distortion={tuning.meshDistortion}
                        swirl={tuning.meshSwirl}
                        grainMixer={0}
                        grainOverlay={0.01}
                        speed={staticMode ? 0 : tuning.meshSpeed}
                        minPixelRatio={1}
                        maxPixelCount={MAX_SHADER_PIXELS}
                        webGlContextAttributes={PAPER_SHADER_CONTEXT_ATTRIBUTES}
                        style={{ width: '100%', height: '100%' }}
                    />
                </div>
            )}
            {showDithering && (
                <div
                    ref={ditheringLayerRef}
                    className="absolute inset-0"
                    style={{
                        mixBlendMode: showMesh ? 'soft-light' : 'normal',
                        opacity: showMesh ? tuning.ditheringOpacity : 1,
                        transform: 'scale(1.015)',
                        transformOrigin: 'center',
                    }}
                >
                    <Dithering
                        ref={ditheringShaderRef}
                        width="100%"
                        height="100%"
                        colorBack={shaderColors.ditheringBack}
                        colorFront={shaderColors.ditheringFront}
                        shape="warp"
                        type="4x4"
                        size={tuning.ditheringSize}
                        speed={staticMode ? 0 : tuning.ditheringSpeed}
                        minPixelRatio={1}
                        maxPixelCount={MAX_SHADER_PIXELS}
                        webGlContextAttributes={PAPER_SHADER_CONTEXT_ATTRIBUTES}
                        style={{ width: '100%', height: '100%' }}
                    />
                </div>
            )}
            {tuning.overlayEnabled && tuning.overlayOpacity > 0 && (
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundColor,
                        opacity: tuning.overlayOpacity,
                    }}
                />
            )}
        </div>
    );
};

export default React.memo(LatentBackground);
