// src/ios/installIosMobileChrome.ts
// iOS 壳的浏览器级补丁：视口、安全区、手势、滚动与杂项能力对齐原生 App 手感。
// 只在 Capacitor iOS 运行时调用；Web / Electron 不受影响。

import { isIosNative } from './iosRuntime';

let installed = false;

/** 安装 iOS 移动端外壳补丁（幂等）。 */
export const installIosMobileChrome = (): void => {
    if (installed || !isIosNative() || typeof document === 'undefined') return;
    installed = true;

    const root = document.documentElement;
    root.classList.add('folia-ios');
    root.dataset.foliaPlatform = 'ios';

    lockViewport();
    blockIosGestures();
    preventInputZoom();
    trackKeyboardInset();
    preventOverscrollBounce();
    disableTextSelectionOnChrome();
    unlockAudioOnFirstGesture();
};

/**
 * 视口：`viewport-fit=cover` 让内容延伸到刘海与 Home Indicator 下面，配合 env(safe-area-inset-*)
 * 由布局层自己留出空位（AppShell 根节点读 --folia-safe-top/--folia-safe-bottom，这里不再给 #root
 * 加 padding，否则会和它叠成双份留白）；同时把 100vh 修正为真实可视高度（iOS 地址栏收起时 vh 会跳）。
 */
const lockViewport = () => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    meta.setAttribute(
        'content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover',
    );

    const syncHeight = () => {
        document.documentElement.style.setProperty('--folia-vh', `${window.innerHeight}px`);
    };
    syncHeight();
    window.addEventListener('resize', syncHeight);
    window.addEventListener('orientationchange', () => setTimeout(syncHeight, 120));
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncHeight);
    }
};

/**
 * 屏蔽 iOS 的浏览器级手势：双指缩放、双击放大、长按弹出系统菜单、橡皮筋回弹。
 * 应用内部的手势（播放器上滑、歌词长按等）都由 React 自己处理，不受这里影响。
 */
const blockIosGestures = () => {
    // 双指缩放
    document.addEventListener('gesturestart', event => event.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', event => event.preventDefault(), { passive: false });
    document.addEventListener('gestureend', event => event.preventDefault(), { passive: false });

    // 双击 / 双指触摸缩放
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (event) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 320) event.preventDefault();
        lastTouchEnd = now;
    }, { passive: false });

    // 长按系统菜单（「拷贝 / 查询 / 分享」）只在输入框与可复制文本上保留
    document.addEventListener('contextmenu', (event) => {
        const target = event.target as HTMLElement | null;
        const editable = target?.closest('input, textarea, [contenteditable="true"], .folia-selectable');
        if (!editable) event.preventDefault();
    });
};

/**
 * 输入框字号小于 16px 时 iOS 会自动放大页面，且聚焦后不会缩回。
 * 全局兜底：所有输入类元素的最小字号设为 16px。
 */
const preventInputZoom = () => {
    const style = document.createElement('style');
    style.id = 'folia-ios-input-zoom-guard';
    style.textContent = `
        input, textarea, select, [contenteditable="true"] {
            font-size: max(16px, 1em);
        }
        /* 安全区：顶部与底部由布局层消费 */
        .folia-ios body {
            overscroll-behavior: none;
            -webkit-touch-callout: none;
            -webkit-tap-highlight-color: transparent;
            padding: 0;
            margin: 0;
        }
        .folia-ios {
            height: var(--folia-vh, 100vh);
            overflow: hidden;
        }
        .folia-ios #root {
            height: 100%;
            box-sizing: border-box;
        }
        /* Home Indicator 区域不压内容，但播放器背景可以铺满 */
        .folia-ios .folia-safe-bottom {
            padding-bottom: env(safe-area-inset-bottom);
        }
        /* 滚动容器惯性滚动 + 不选中 */
        .folia-ios .folia-scroll {
            -webkit-overflow-scrolling: touch;
        }
    `;
    document.head.appendChild(style);
};

/**
 * 键盘弹出时把键盘高度写成 CSS 变量，供输入框、命令面板与歌单弹层做避让。
 * visualViewport 在 WKWebView 里会随键盘收缩，两者之差即键盘高度。
 */
const trackKeyboardInset = () => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const sync = () => {
        const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        document.documentElement.style.setProperty('--folia-keyboard-inset', `${inset}px`);
        document.documentElement.classList.toggle('folia-keyboard-open', inset > 80);
    };
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    sync();
};

/** iOS 整页回弹会让固定定位的元素抖动，直接禁用 body 级的 touchmove 滚动。 */
const preventOverscrollBounce = () => {
    document.body.addEventListener('touchmove', (event) => {
        let node = event.target as HTMLElement | null;
        while (node && node !== document.body) {
            const style = window.getComputedStyle(node);
            const scrollable = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
            if (scrollable) return;
            node = node.parentElement;
        }
        if (event.cancelable) event.preventDefault();
    }, { passive: false });
};

/** 应用外壳、按钮、列表不参与文本选择，避免长按出现蓝色选中块。 */
const disableTextSelectionOnChrome = () => {
    const style = document.createElement('style');
    style.id = 'folia-ios-no-select';
    style.textContent = `
        .folia-ios button,
        .folia-ios [role="button"],
        .folia-ios [role="tab"],
        .folia-ios [role="menuitem"] {
            user-select: none;
            -webkit-user-select: none;
        }
    `;
    document.head.appendChild(style);
};

/**
 * iOS 要求音频播放必须由用户手势触发。首次触摸时播放一段静音并立即暂停，
 * 之后由播放器创建的 AudioContext 与 audio 元素才能在各种场景（锁屏按钮、远程控制）继续播放。
 */
const unlockAudioOnFirstGesture = () => {
    const unlock = async () => {
        try {
            const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (Ctx) {
                const ctx = new Ctx();
                if (ctx.state === 'suspended') await ctx.resume();
                await ctx.close();
            }
            const probe = document.createElement('audio');
            probe.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
            await probe.play().catch(() => {});
            probe.pause();
        } catch (error) {
            console.warn('[ios] 音频解锁失败', error);
        }
        window.removeEventListener('touchstart', unlock);
        window.removeEventListener('touchend', unlock);
    };
    window.addEventListener('touchstart', unlock, { once: true, passive: true });
    window.addEventListener('touchend', unlock, { once: true, passive: true });
};
