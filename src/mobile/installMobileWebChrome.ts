// src/mobile/installMobileWebChrome.ts
// 手机浏览器上的适配补丁。和 ios/installIosMobileChrome.ts 一个思路，但只做「网页里能做的事」：
// 原生壳那套视口锁定、音频解锁、安全区回报在这里不需要也不该碰。
//
// 挂上去的东西：
// - html.folia-touch：触控样式层（44px 命中盒、:active 反馈、不回弹、不选中），见 index.css；
// - --folia-vh：真实可视高度。iOS Safari / 安卓 Chrome 的地址栏收起会让 100vh 比可视区高一截，
//   应用又是 fixed 满屏，底部那排控件会被工具栏压住；
// - --folia-keyboard-inset：输入法高度，浮在底部的输入框靠它让位；
// - 输入框 16px 字号下限：iOS 聚焦时字号小于 16px 会自动放大页面，且不会缩回去；
// - 长按菜单：只有输入框和 .folia-selectable 里保留系统菜单，其余长按不再弹「存储图片/拷贝」。

import { isMobileWeb, watchTouchDevice } from './touchDevice';

const TOUCH_CLASS = 'folia-touch';
let installed = false;

/** 输入法高度超过这个值才算「键盘真的弹出来了」，避免把地址栏收起当成键盘。 */
const KEYBOARD_THRESHOLD = 80;

/** 把可视高度写进 --folia-vh（键盘弹起时不更新，否则整个界面会跟着缩）。 */
const trackViewportHeight = (): void => {
    const root = document.documentElement;
    const write = (height: number, top: number) => {
        root.style.setProperty('--folia-vh', `${Math.round(height)}px`);
        root.style.setProperty('--folia-vv-top', `${Math.round(top)}px`);
    };

    const sync = () => {
        const viewport = window.visualViewport;
        const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
        if (inset > KEYBOARD_THRESHOLD) return;
        write(viewport ? viewport.height : window.innerHeight, viewport ? viewport.offsetTop : 0);
    };

    write(window.innerHeight, 0);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', () => window.setTimeout(sync, 120));
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
};

/** 输入法高度写进 --folia-keyboard-inset，同时挂 folia-keyboard-open 供布局判断。 */
const trackKeyboard = (): void => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let raf = 0;

    const sync = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
            const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
            root.style.setProperty('--folia-keyboard-inset', `${Math.round(inset)}px`);
            root.classList.toggle('folia-keyboard-open', inset > KEYBOARD_THRESHOLD);
        });
    };

    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
};

/** 输入框字号下限，顺便把触控层的几条浏览器级默认值按住。 */
const installTouchStyleSheet = (): void => {
    if (document.getElementById('folia-touch-style')) return;
    const style = document.createElement('style');
    style.id = 'folia-touch-style';
    style.textContent = `
        /* iOS 聚焦时会为小于 16px 的输入框放大整页，放大后不会自己缩回。 */
        html.${TOUCH_CLASS} input,
        html.${TOUCH_CLASS} textarea,
        html.${TOUCH_CLASS} select,
        html.${TOUCH_CLASS} [contenteditable="true"] {
            font-size: max(16px, 1em);
        }
        /* 横竖屏切换时 WebKit 会自作主张放大正文；应用自己排好了，不需要它改。 */
        html.${TOUCH_CLASS} {
            -webkit-text-size-adjust: 100%;
            text-size-adjust: 100%;
        }
    `;
    document.head.appendChild(style);
};

/** 长按：输入框、可选文本保留系统菜单；按钮、封面、歌词不再弹「存储图片/拷贝」。 */
const guardLongPress = (): void => {
    document.addEventListener('contextmenu', (event) => {
        const target = event.target as HTMLElement | null;
        const keep = target?.closest('input, textarea, select, [contenteditable="true"], .folia-selectable');
        if (!keep) event.preventDefault();
    });
};

const applyTouchClass = (touch: boolean): void => {
    const root = document.documentElement;
    root.classList.toggle(TOUCH_CLASS, touch);
    if (touch) root.dataset.foliaPlatform = 'web-touch';
    else if (root.dataset.foliaPlatform === 'web-touch') delete root.dataset.foliaPlatform;
};

/** 安装手机网页适配（幂等）。原生壳不走这里：它在 bootstrap 里走 installIosMobileChrome。 */
export const installMobileWebChrome = (): void => {
    if (installed || typeof document === 'undefined') return;
    if (!isMobileWeb()) {
        // 一开始不是触控端也要盯着：桌面浏览器开手机模拟、平板接上鼠标都会变。
        watchTouchDevice((touch) => {
            if (!touch) return;
            installed = true;
            boot();
        });
        return;
    }
    installed = true;
    boot();
};

const boot = (): void => {
    applyTouchClass(true);
    trackViewportHeight();
    trackKeyboard();
    installTouchStyleSheet();
    guardLongPress();
    watchTouchDevice(applyTouchClass);
};
