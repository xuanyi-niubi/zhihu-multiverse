'use client';

import * as React from 'react';

import {
  applyReduceMotionPreference,
  browserPreferenceStorage,
  readReduceMotionPreference,
  REDUCE_MOTION_EVENT,
} from '@/features/run/appearance';

/**
 * 外观偏好的启动器（挂在根布局，`null` 渲染）。
 *
 * 设置页把「减少动画」写进 localStorage 后，谁负责把它变成
 * `<html data-reduce-motion="on">`？答案必须是**每个页面**都有的东西，
 * 否则用户只在设置页看到效果，一离开就恢复动画。
 *
 * 于是这里只做一件事：挂载时应用一次，并在同标签页收到改动事件时再应用一次。
 * 不 fetch、不写内容、不参与布局。
 */
export default function AppearanceBootstrap() {
  React.useEffect(() => {
    const apply = () => {
      applyReduceMotionPreference(
        document.documentElement,
        readReduceMotionPreference(browserPreferenceStorage()),
      );
    };

    apply();
    window.addEventListener(REDUCE_MOTION_EVENT, apply);
    return () => window.removeEventListener(REDUCE_MOTION_EVENT, apply);
  }, []);

  return null;
}
