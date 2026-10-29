// src/components/remote/remoteCardVisuals.ts
// 遥控窗口卡片里那些「按昼夜二选一」的 class，以及共用的时间格式。
// 这些常量原先散在那份 1200 多行的 RemoteControlApp 里，只有它自己用得到；
// 卡片拆成若干子组件后，每块都要用同一套，所以抽到这里 —— 不然改一处按钮样式
// 要翻七八个文件，早晚只改一半。

export const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '0:00';
    }

    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const rest = totalSeconds % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
};

/*
 * Ghost icon buttons: no resting chip, background only on hover. The filled
 * play button stays the single anchor so the row reads as one primary action
 * plus quiet satellites instead of seven competing pills.
 */
export const transportButtonClass = (isDaylight: boolean) => `flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-30 ${isDaylight
    ? 'text-black/70 hover:bg-black/[0.06] hover:text-black'
    : 'text-white/75 hover:bg-white/10 hover:text-white'
    }`;

export const secondaryButtonBase = 'flex h-7 w-7 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-30';

// Every button in the row shares one hover response: the same chip, and text
// arriving at full contrast. Only the resting level encodes state, so an "on"
// button rests just below full to keep the hover headroom the idle ones have.
export const secondaryIdleClass = (isDaylight: boolean) => (isDaylight
    ? 'text-black/40 hover:bg-black/[0.06] hover:text-black'
    : 'text-white/45 hover:bg-white/10 hover:text-white');

export const secondaryActiveClass = (isDaylight: boolean) => (isDaylight
    ? 'text-black/85 hover:bg-black/[0.06] hover:text-black'
    : 'text-white/90 hover:bg-white/10 hover:text-white');

export const secondaryAlertClass = (isDaylight: boolean) => (isDaylight
    ? 'text-red-600/85 hover:bg-black/[0.06] hover:text-red-600'
    : 'text-red-400/90 hover:bg-white/10 hover:text-red-400');

/*
 * 封面铺满整卡（sleeve）时，卡片里剩下的文字是压在封面上的。
 *
 * 昼夜那套墨色是按「卡片底色」调的：白天卡片是浅色，文字就用黑 —— 但封面铺满之后
 * 底下那层变成了一张图，深浅全看封面，白天模式照样可能压在一张很暗的封面上。
 * 所以 sleeve 态一律走白字（浓淡自己给），底下再垫一层渐变遮罩（见 RemoteCardSurface）。
 */
export const onCoverTextClass = (
    isSleeve: boolean,
    isDaylight: boolean,
    sleeveClass: string,
    daylightClass: string,
    nightClass: string,
) => (isSleeve ? sleeveClass : isDaylight ? daylightClass : nightClass);

/** sleeve 态文字的描边：渐变遮罩兜住了大部分封面，这一层是给特别亮的封面留的余量。 */
export const ON_COVER_TEXT_SHADOW = 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]';
