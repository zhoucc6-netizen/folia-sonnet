import React from 'react';

// src/components/remote/RemoteCardSurface.tsx
// 卡片底下那几层：渐变背景、闲置时铺满整张卡的大封面、透明模式露出来的标题栏底。
//
// 三层都贴在卡片的最底下（-z-10），顺序就是画在上面的顺序：背景 → 大封面 → 标题栏底。
// 卡片内容留在普通文档流里，天然压在它们之上；大封面这一层不要给它 z-index，
// 定位元素一旦拿到 z-index 就会盖住普通流的标题和按键（见下）。

export type RemoteBackgroundMode = 'default' | 'cover' | 'transparent';

type RemoteCardSurfaceProps = {
    backgroundMode: RemoteBackgroundMode;
    isDaylight: boolean;
    /** 当前封面的取色结果，只在背景切成「封面」时用来铺那三团模糊色。 */
    coverColors: string[];
    /** 透明模式下，指针靠近顶部时浮出来的那条标题栏底。 */
    titlebarRevealed: boolean;
    /** 闲置且「展开封面」开着时，封面铺满整张卡片。 */
    isSleeve: boolean;
    coverUrl: string | null;
};

const RemoteCardSurface: React.FC<RemoteCardSurfaceProps> = ({
    backgroundMode,
    isDaylight,
    coverColors,
    titlebarRevealed,
    isSleeve,
    coverUrl,
}) => (
    <>
        {/* Transparent mode titlebar backdrop */}
        {backgroundMode === 'transparent' && (
            <div
                className={`absolute inset-x-0 top-0 h-11 pointer-events-none transition-opacity duration-200 backdrop-blur-md ${titlebarRevealed ? 'opacity-100' : 'opacity-0'
                    } ${isDaylight
                        ? 'bg-white/40 border-b border-black/10 shadow-sm'
                        : 'bg-black/40 border-b border-white/10 shadow-md'
                    }`}
            />
        )}

        {/* Blurry gradient background */}
        {backgroundMode !== 'transparent' && (
            <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none transition-opacity duration-300">
                {/* Base layer */}
                <div className={`absolute inset-0 transition-colors duration-300 ${backgroundMode === 'cover' && coverColors.length > 0
                    ? (isDaylight ? 'bg-zinc-100' : 'bg-zinc-950')
                    : (isDaylight ? 'bg-[#f5f5f4]' : 'bg-[#060814]')
                    }`} />

                {/* Blurry blobs */}
                {backgroundMode === 'cover' && coverColors.length >= 2 ? (
                    <>
                        <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full blur-[40px] transition-all duration-700 ease-in-out" style={{ backgroundColor: coverColors[0], opacity: isDaylight ? 0.35 : 0.25 }} />
                        <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full blur-[50px] transition-all duration-700 ease-in-out" style={{ backgroundColor: coverColors[1], opacity: isDaylight ? 0.35 : 0.25 }} />
                        <div className="absolute top-1/4 right-1/4 w-32 h-32 rounded-full blur-[30px] transition-all duration-700 ease-in-out" style={{ backgroundColor: coverColors[2] || coverColors[0], opacity: isDaylight ? 0.25 : 0.15 }} />
                    </>
                ) : isDaylight ? (
                    <>
                        {/* Soft orange blurry blob top-left */}
                        <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full bg-orange-400/20 blur-[40px] transition-all duration-300" />
                        {/* Soft rose/pink blurry blob bottom-right */}
                        <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full bg-rose-300/20 blur-[50px] transition-all duration-300" />
                        {/* Soft sky center highlight */}
                        <div className="absolute top-1/4 right-1/4 w-32 h-32 rounded-full bg-sky-300/20 blur-[30px] transition-all duration-300" />
                    </>
                ) : (
                    <>
                        {/* Deep blue blurry blob top-left */}
                        <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full bg-blue-600/20 blur-[40px] transition-all duration-300" />
                        {/* Dark indigo/purple blurry blob bottom-right */}
                        <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full bg-indigo-500/15 blur-[50px] transition-all duration-300" />
                        {/* Soft cyan/sky center highlight */}
                        <div className="absolute top-1/4 right-1/4 w-32 h-32 rounded-full bg-sky-500/10 blur-[30px] transition-all duration-300" />
                    </>
                )}
            </div>
        )}

        {/*
         * 闲置时铺满整张卡的那张大封面。
         *
         * 上游为此把窗口从 428 加宽到 602，平时左侧 174px 空着、闲置时才由大封面填上。
         * fork 的卡片是内容铺满的，没有那块空位，所以这里的做法是：把同一张封面在卡片底下
         * 整张铺开，卡片内容不动，只是换了个底 —— 「展开成大图」的结果一样，布局不用推倒。
         *
         * 上一层是绝对定位，必须显式压到 -z-10：定位元素只要拿到 z-index 就会盖住
         * 普通流里的标题和按键，而卡片里那些恰恰是普通流。
         */}
        <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-cover bg-center transition-[opacity,transform] duration-[620ms] ease-out"
            style={{
                backgroundImage: coverUrl ? `url(${coverUrl})` : undefined,
                opacity: isSleeve ? 1 : 0,
                transform: isSleeve ? 'scale(1)' : 'scale(1.08)',
            }}
        />

        {/*
         * 压在封面上的那层渐变，保证文字和进度条在任何封面上都读得清。
         * 横向也压一层（从下往上、从右往左），因为文字主要在卡片右半边。
         */}
        <div
            aria-hidden
            className="absolute inset-0 -z-10 pointer-events-none transition-opacity duration-[620ms] ease-out"
            style={{ opacity: isSleeve ? 1 : 0 }}
        >
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10" />
            <div className="absolute inset-0 bg-gradient-to-l from-black/45 via-transparent to-transparent" />
        </div>
    </>
);

export default RemoteCardSurface;
