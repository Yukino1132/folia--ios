// src/ios/installNativeHttp.ts
// 原生壳里把 window.fetch 换成"跨域走原生、同源走 WebView"的版本。
// WebView 的 fetch 受 CORS 限制，在线平台的第三方接口不给跨域头，浏览器侧一律被拦；
// Capacitor 的 CapacitorHttp 插件在原生层发请求没有这个限制。这里只接管跨域的 http(s) 请求，
// 包内资源、同源接口、blob:/data: 都原样交回 WebView，避免多一层序列化。
// 非原生环境（Web / Electron）直接返回，一行行为都不改。

import { iosNativeFetch, shouldUseIosNativeFetch } from './fetchIosNetwork';

const INSTALL_FLAG = '__foliaNativeFetchInstalled';

export const installNativeHttp = (): void => {
    if (typeof window === 'undefined') return;
    const marker = window as unknown as Record<string, unknown>;
    if (marker[INSTALL_FLAG]) return;
    if (!shouldUseIosNativeFetch('https://example.com/')) return;

    const originalFetch = window.fetch.bind(window);
    const patched: typeof window.fetch = async (input, init) => {
        const url = typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.toString()
                : input.url;
        if (!shouldUseIosNativeFetch(url)) return originalFetch(input, init);
        try {
            return await iosNativeFetch(input, init);
        } catch (error) {
            // 原生通道自身出错（插件不可用、超时之外的异常）时退回 WebView 的 fetch，
            // 至少让同源与开放 CORS 的接口继续工作。
            console.warn('[ios] 原生 HTTP 请求失败，回退到 WebView fetch', error);
            return originalFetch(input, init);
        }
    };

    window.fetch = patched;
    marker[INSTALL_FLAG] = true;
};
