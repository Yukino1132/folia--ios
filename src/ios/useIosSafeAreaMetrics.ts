// src/ios/useIosSafeAreaMetrics.ts
// 把 iOS 原生壳的安全区、底部安全区和键盘高度写进 CSS 变量，供布局层与样式表统一取用。

import { useEffect } from 'react';
import { isIosNative } from './iosRuntime';

const SAFE_TOP_VAR = '--folia-safe-top';
const SAFE_BOTTOM_VAR = '--folia-safe-bottom';
const KEYBOARD_INSET_VAR = '--folia-keyboard-inset';

const writePxVar = (name: string, value: number): void => {
    document.documentElement.style.setProperty(name, `${Math.max(0, Math.round(value))}px`);
};

const readPxVar = (name: string): number => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** 把安全区写进根元素（bootstrap 阶段与方向变化时都会调用）。 */
export const applySafeAreaMetrics = (top: number, bottom: number): void => {
    writePxVar(SAFE_TOP_VAR, top);
    writePxVar(SAFE_BOTTOM_VAR, bottom);
};

/** 读当前生效的底部安全区。 */
export const readSafeAreaBottom = (): number => readPxVar(SAFE_BOTTOM_VAR);

/** 读当前生效的顶部安全区。 */
export const readSafeAreaTop = (): number => readPxVar(SAFE_TOP_VAR);

/** 用 CSS 环境变量量一次安全区：原生插件回报之前、以及方向变化后都靠它。 */
const measureSafeArea = (): { top: number; bottom: number } => {
    const probe = document.createElement('div');
    probe.style.cssText =
        'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none;';
    const probeBottom = document.createElement('div');
    probeBottom.style.cssText =
        'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none;';
    document.body.append(probe, probeBottom);
    const top = probe.getBoundingClientRect().height;
    const bottom = probeBottom.getBoundingClientRect().height;
    probe.remove();
    probeBottom.remove();
    return { top, bottom };
};

/** 组件挂载期间保持安全区变量与原生一致，并在方向变化时刷新。 */
export const useIosSafeAreaMetrics = (): void => {
    useEffect(() => {
        if (!isIosNative()) {
            return;
        }

        // 主进程之外没有安全区来源，这里用 CSS 环境变量兜底读一次，之后只在方向变化时重读。
        // 不可见时（比如从后台切回、方向变化动画还没结束）量出来的可能是 0，这时保留原值不写。
        const sync = () => {
            const { top, bottom } = measureSafeArea();
            if (top > 0 || bottom > 0) applySafeAreaMetrics(top, bottom);
        };

        sync();
        window.addEventListener('orientationchange', sync);
        return () => window.removeEventListener('orientationchange', sync);
    }, []);
};

/** 键盘弹起时把高度写进变量，收起时归零；只在原生壳里启用。 */
export const useIosKeyboardInset = (): void => {
    useEffect(() => {
        if (!isIosNative() || !window.visualViewport) {
            return;
        }

        const viewport = window.visualViewport;
        let raf = 0;

        const sync = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
                writePxVar(KEYBOARD_INSET_VAR, inset);
                document.documentElement.classList.toggle('folia-keyboard-open', inset > 24);
            });
        };

        sync();
        viewport.addEventListener('resize', sync);
        viewport.addEventListener('scroll', sync);
        return () => {
            cancelAnimationFrame(raf);
            viewport.removeEventListener('resize', sync);
            viewport.removeEventListener('scroll', sync);
        };
    }, []);
};
