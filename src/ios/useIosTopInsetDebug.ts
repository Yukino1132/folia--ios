// src/ios/useIosTopInsetDebug.ts
// 调试用：把壳里实际生效的安全区、以及窗口/视口高度差异写进 <html> 的 dataset。
// iPhone 上顶栏与状态栏重叠时，看这两组数字就能判断是安全区没读到，还是视口本身压在状态栏下面。

import { useEffect } from 'react';
import { isIosNative } from './iosRuntime';

export const useIosTopInsetDebug = (): void => {
    useEffect(() => {
        if (!isIosNative() || typeof document === 'undefined') return;
        const root = document.documentElement;
        const read = () => {
            const styles = getComputedStyle(root);
            const top = Number.parseFloat(styles.getPropertyValue('--folia-safe-top')) || 0;
            const bottom = Number.parseFloat(styles.getPropertyValue('--folia-safe-bottom')) || 0;
            root.dataset.foliaSafeTop = String(Math.round(top));
            root.dataset.foliaSafeBottom = String(Math.round(bottom));
            root.dataset.foliaInnerHeight = String(Math.round(window.innerHeight));
            root.dataset.foliaVisualHeight = window.visualViewport
                ? String(Math.round(window.visualViewport.height + window.visualViewport.offsetTop))
                : '';
        };
        read();
        window.addEventListener('resize', read);
        window.addEventListener('orientationchange', read);
        return () => {
            window.removeEventListener('resize', read);
            window.removeEventListener('orientationchange', read);
        };
    }, []);
};
