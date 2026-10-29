import { useSyncExternalStore } from 'react';
import {
  getUpdateCenterState,
  subscribeUpdateCenter,
  type UpdateCenterState,
} from '../services/appUpdateCenter';

// src/hooks/useUpdateCenter.ts
// 更新状态（检查结果 + 下载阶段 + 忽略记号）的 React 绑定。
//
// 状态本体在 services/appUpdateCenter.ts：设置页的更新卡片和启动时的更新弹窗
// 订阅的是同一个东西，进度在两边同步，也不会各自触发一次下载。

export const useUpdateCenter = (): UpdateCenterState => (
  useSyncExternalStore(subscribeUpdateCenter, getUpdateCenterState, getUpdateCenterState)
);
