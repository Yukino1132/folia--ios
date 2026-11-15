// src/mobile/touchDevice.ts
// 「是不是手指在点」的判定。和 ios/iosRuntime 的分工：那边认平台（Capacitor iOS 壳），
// 这边只认输入方式 —— 手机/平板的浏览器也算触控端，桌面浏览器不算。
//
// 判定结果缓存在模块里：布局分支、预热策略、样式类名都读同一个答案，一次会话内不会因为
// 旋转屏幕或外接鼠标在两者之间反复横跳（真的换了输入设备时 matchMedia 会来通知，重算一次）。

import { isIosNative } from '../ios/iosRuntime';

let cached: boolean | null = null;
let watchers: MediaQueryList[] = [];

const readMedia = (query: string): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    try {
        return window.matchMedia(query).matches;
    } catch {
        return false;
    }
};

const computeTouch = (): boolean => {
    if (typeof window === 'undefined') return false;
    // 主流手机浏览器都命中 (pointer: coarse)；带触摸屏的笔记本常常同时有鼠标，
    // 这时 pointer 是 fine，但 (any-pointer: coarse) 仍为真 —— 那种机器不该进移动布局，
    // 所以只认主指针，外加「完全没有 hover 能力」这一条。
    if (readMedia('(pointer: coarse)')) return true;
    if (readMedia('(hover: none) and (any-pointer: coarse)')) return true;
    // 老 WebView / 某些安卓浏览器的媒体查询不全，退回触摸点数 + 窄屏。
    const points = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
    return points > 0 && readMedia('(max-width: 1024px)');
};

/** 这台设备的主输入是不是手指。 */
export const isTouchDevice = (): boolean => {
    if (cached === null) cached = computeTouch();
    return cached;
};

/** 是不是「手机/平板上的网页」：触控端，且不是 Capacitor 原生壳（原生壳另有自己那套）。 */
export const isMobileWeb = (): boolean => isTouchDevice() && !isIosNative();

/** 所有该按移动端规格渲染的场合：原生壳 + 手机网页。桌面端与 Electron 恒为 false。 */
export const isMobileSurface = (): boolean => isIosNative() || isMobileWeb();

/** 订阅输入方式变化（旋转屏幕、接上/拔掉鼠标），变化时回调。返回取消订阅函数。 */
export const watchTouchDevice = (onChange: (touch: boolean) => void): (() => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const queries = ['(pointer: coarse)', '(hover: none) and (any-pointer: coarse)', '(max-width: 1024px)'];
    const handler = () => {
        const next = computeTouch();
        if (next === cached) return;
        cached = next;
        onChange(next);
    };
    watchers = queries.map((query) => {
        const list = window.matchMedia(query);
        list.addEventListener('change', handler);
        return list;
    });
    return () => {
        watchers.forEach((list) => list.removeEventListener('change', handler));
        watchers = [];
    };
};
