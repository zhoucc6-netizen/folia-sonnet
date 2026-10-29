import React from 'react';
import { AnimatePresence, motion, type MotionValue } from 'framer-motion';
import type { RemoteTrackFace } from './remoteTrackTransition';
import { onCoverTextClass, ON_COVER_TEXT_SHADOW } from './remoteCardVisuals';

// src/components/remote/RemoteTrackHeading.tsx
// 卡片右栏顶上那两行：标题与艺术家。换歌时两张面朝相反方向交错；
// 悬停在上一首/下一首按键上时，整叠标题一起让位给邻居标题的预览 —— 整叠让位，
// 不必逐张改不透明度。

const SWITCH_TEXT_TRANSITION = { duration: 0.32, ease: [0.22, 1, 0.36, 1] } as const;

type RemoteTrackHeadingProps = {
    isDaylight: boolean;
    /** 封面铺满整卡时，这两行压在封面上，一律用白并加描边。 */
    isSleeve: boolean;
    faces: RemoteTrackFace[];
    isHandoffActive: boolean;
    handoffIncomingOpacity: MotionValue<number>;
    handoffOutgoingOpacity: MotionValue<number>;
    trackEnterOffset: number;
    /** 邻居标题预览；null 表示照常显示当前曲目。 */
    previewTitle: string | null;
};

const RemoteTrackHeading: React.FC<RemoteTrackHeadingProps> = ({
    isDaylight,
    isSleeve,
    faces,
    isHandoffActive,
    handoffIncomingOpacity,
    handoffOutgoingOpacity,
    trackEnterOffset,
    previewTitle,
}) => {
    const titleClass = onCoverTextClass(
        isSleeve,
        isDaylight,
        `text-white ${ON_COVER_TEXT_SHADOW}`,
        'text-inherit',
        'text-inherit',
    );
    const artistClass = onCoverTextClass(
        isSleeve,
        isDaylight,
        `text-white/75 ${ON_COVER_TEXT_SHADOW}`,
        'text-black/50',
        'text-white/40',
    );

    return (
        <div className="min-w-0 pr-6">
            {/* Preview Sound Name */}
            <div className="relative h-5 min-w-0">
                <div
                    className={`absolute inset-0 transition-opacity duration-200 ${isSleeve ? ON_COVER_TEXT_SHADOW : ''}`}
                    style={{ opacity: previewTitle ? 0 : 1 }}
                >
                    <AnimatePresence initial={false}>
                        {faces.map(face => {
                            const handoffOpacity = face.mode === 'incoming'
                                ? handoffIncomingOpacity
                                : isHandoffActive ? handoffOutgoingOpacity : undefined;
                            return (
                                <motion.div
                                    key={`title-${face.key}`}
                                    initial={face.mode === 'incoming'
                                        ? { opacity: 1, x: 0 }
                                        : { opacity: 0, x: trackEnterOffset }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -trackEnterOffset }}
                                    transition={face.mode === 'incoming'
                                        ? { duration: 0.55, ease: 'linear' }
                                        : SWITCH_TEXT_TRANSITION}
                                    className="absolute inset-0"
                                >
                                    <motion.div
                                        className={`absolute inset-0 truncate text-[15px] font-bold leading-5 tracking-[-0.01em] transition-colors duration-300 ${titleClass}`}
                                        style={handoffOpacity ? { opacity: handoffOpacity } : undefined}
                                    >
                                        {face.title}
                                    </motion.div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
                <div
                    aria-hidden
                    className={`absolute inset-0 truncate text-[15px] font-bold leading-5 tracking-[-0.01em] transition-opacity duration-200 ${titleClass}`}
                    style={{ opacity: previewTitle ? 0.55 : 0 }}
                >
                    {previewTitle}
                </div>
            </div>
            <div className={`relative h-4 mt-0.5 min-w-0 transition-colors duration-300 ${artistClass}`}>
                <AnimatePresence initial={false}>
                    {faces.map(face => {
                        const handoffOpacity = face.mode === 'incoming'
                            ? handoffIncomingOpacity
                            : isHandoffActive ? handoffOutgoingOpacity : undefined;
                        return (
                            <motion.div
                                key={`artist-${face.key}`}
                                initial={face.mode === 'incoming'
                                    ? { opacity: 1, x: 0 }
                                    : { opacity: 0, x: trackEnterOffset }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -trackEnterOffset }}
                                transition={face.mode === 'incoming'
                                    ? { duration: 0.55, ease: 'linear' }
                                    : { ...SWITCH_TEXT_TRANSITION, delay: 0.04 }}
                                className="absolute inset-0"
                            >
                                <motion.div
                                    className="absolute inset-0 truncate text-xs font-medium leading-4"
                                    style={handoffOpacity ? { opacity: handoffOpacity } : undefined}
                                >
                                    {face.artist}
                                </motion.div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default RemoteTrackHeading;
