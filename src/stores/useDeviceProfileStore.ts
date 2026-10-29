import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';
import {
    applyDeviceProfile,
    clampUiScale,
    readStoredDeviceType,
    readStoredUiScale,
    resolveUiScale,
    writeStoredDeviceType,
    writeStoredUiScale,
    type DeviceType,
} from '../services/androidPhoneLayout';

// src/stores/useDeviceProfileStore.ts
// 设备类型（手机 / 平板）+ 界面缩放。首启引导里问一次，之后在设置里随时改。
//
// 分设备类型是为了横屏：平板的宽度够铺桌面那套布局，手机横过来就塞不下，控件会互相压住。
// 缩放是另一回事 —— 缩多少由用户拉滑条定，默认按设备类型给一档（手机缩、平板不缩）。
// 样式只认 `--folia-ui-scale-*` 两个变量，见 services/androidPhoneLayout.applyDeviceProfile。

/**
 * 引导问过一次了。与 deviceType 分开存：直接关掉对话框的人也是「问过了」——
 * 没选就不该每次启动都再问一遍，设置里随时能改。
 */
const DEVICE_TYPE_ANSWERED_KEY = 'folia_device_type_answered';

export type DeviceProfileState = {
    deviceType: DeviceType | null;
    hasAnsweredDeviceType: boolean;
    /** 界面缩放（百分比）。`null` = 没调过，按设备类型取默认。 */
    uiScale: number | null;
    setDeviceType: (deviceType: DeviceType) => void;
    markDeviceTypeAnswered: () => void;
    setUiScale: (scale: number) => void;
};

export const useDeviceProfileStore = create<DeviceProfileState>((set, get) => ({
    deviceType: readStoredDeviceType(),
    hasAnsweredDeviceType: getStoredBoolean(DEVICE_TYPE_ANSWERED_KEY, false),
    uiScale: readStoredUiScale(),
    setDeviceType: (deviceType) => {
        writeStoredDeviceType(deviceType);
        // 缩放照旧传当前值：换类型只影响「没调过时」的默认档，调过的不该被重置。
        applyDeviceProfile(deviceType, get().uiScale);
        setStoredBoolean(DEVICE_TYPE_ANSWERED_KEY, true);
        set({ deviceType, hasAnsweredDeviceType: true });
    },
    markDeviceTypeAnswered: () => {
        setStoredBoolean(DEVICE_TYPE_ANSWERED_KEY, true);
        set({ hasAnsweredDeviceType: true });
    },
    setUiScale: (scale) => {
        const next = clampUiScale(scale);
        writeStoredUiScale(next);
        applyDeviceProfile(get().deviceType, next);
        set({ uiScale: next });
    },
}));

/** 滑条上该显示的那个数：调过以调的为准，没调过按设备类型取默认。 */
export const resolveCurrentUiScale = (
    uiScale: number | null,
    deviceType: DeviceType | null,
): number => resolveUiScale(uiScale, deviceType);
