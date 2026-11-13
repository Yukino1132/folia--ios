import { useLayoutEffect } from 'react';
import { useBottomDockStore } from '../stores/useBottomDockStore';
import { resolveBottomLayout } from '../utils/playerBottomBarLayout';
import { isIosNative } from '../ios/iosRuntime';

// src/hooks/useBottomLayoutTracking.ts
// 主窗口按窗口宽度在紧凑档和桌面档之间切换（progress-bar v3）。只听 resize、只在跨档时写一次 store，
// 不量任何元素。挂在主窗口的覆盖层上，OBS 之类的独立页面不挂，它们的底部组件一直是桌面档。
//
// iOS 壳固定走紧凑档：竖屏宽度远低于断点，横屏（844/852/932）仍应按触控尺寸排布，
// 桌面档的三列布局依赖悬停与鼠标指针，触控设备上会藏住按钮。

export const useBottomLayoutTracking = (): void => {
    // layout effect：第一次判断在首帧绘制之前做完，窄窗口打开时不会先闪一下桌面布局。
    useLayoutEffect(() => {
        const store = useBottomDockStore.getState();
        const forcedCompact = isIosNative();
        let current = forcedCompact ? 'compact' : resolveBottomLayout(window.innerWidth, null);
        store.setLayout(current);
        store.setTracking(true);
        if (forcedCompact) {
            // 原生壳只在退出时收尾，横竖屏切换也保持紧凑档。
            return () => {
                useBottomDockStore.getState().setTracking(false);
            };
        }
        const onResize = () => {
            const next = resolveBottomLayout(window.innerWidth, current);
            if (next === current) return;
            current = next;
            useBottomDockStore.getState().setLayout(next);
        };
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            useBottomDockStore.getState().setTracking(false);
        };
    }, []);
};
