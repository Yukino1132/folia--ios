import { useEffect, useState } from 'react';
import { readSafeAreaBottom } from './useIosSafeAreaMetrics';
import { isIosNative } from './iosRuntime';

// src/ios/useIosSafeAreaInsetBottom.ts
// 底部安全区（Home Indicator 那条）的像素值，随方向变化更新；非原生壳恒为 0。
// 注意：AppShell 根节点已经按安全区内缩过一次，底栏、面板、可视层都在那个盒子里，
// 不要再叠加这个值；只有渲染在 AppShell 之外、直接 fixed 到屏幕底边的层才需要它。

/** 订阅底部安全区高度；返回值可直接叠加到 bottom / padding-bottom 上。 */
export const useIosSafeAreaInsetBottom = (): number => {
    // 初始值按 0 起：首帧渲染前 CSS 变量可能还没写，读到的 0 会在下一次 sync 里补上。
    const [inset, setInset] = useState(0);

    useEffect(() => {
        if (!isIosNative()) return;
        const sync = () => setInset(readSafeAreaBottom());
        sync();
        window.addEventListener('resize', sync);
        window.addEventListener('orientationchange', sync);
        return () => {
            window.removeEventListener('resize', sync);
            window.removeEventListener('orientationchange', sync);
        };
    }, []);

    return inset;
};
