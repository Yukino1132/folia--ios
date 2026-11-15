import { getStoredString, setStoredString } from '../../../stores/storagePrimitives';

// src/services/onlineMusic/netease/neteaseEndpointSetting.ts
// 网易云中转地址的应用内设置：原生壳（IPA）里没有构建期环境变量，装上之后又改不了包，
// 所以允许用户在设置里填自己的中转服务地址，存 localStorage，取用时排在 runtime-config.js 之后。
//
// 空字符串 = 没填，回落到 runtime-config.js 注入的值（打包时用 FOLIA_NETEASE_API_BASE 指定）。
// 这个模块不依赖 UI，netease.ts 与设置页都从这里取。

const STORAGE_KEY = 'folia.netease.apiBase';

/**
 * 把用户输入规整成地址：补协议、去结尾斜杠；不是 http(s) 或不合法时返回空字符串。
 *
 * 补协议的规则按端口判断，不是一律补 https：自建的中转（本地电脑、局域网、直连的 IP 字面量）
 * 绝大多数只跑 http，一律补 https 会让请求在 TLS 握手阶段就失败，界面上只表现为"连不上"。
 * 只写了主机名、看起来是正经域名的（example.com/api）才补 https。
 */
const normalize = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    // file:、javascript: 这类不是我们认的协议，直接当没填。
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) return '';
    let withScheme: string;
    if (/^https?:\/\//i.test(trimmed)) {
        withScheme = trimmed;
    } else {
        // 没写协议时：带端口、是 IP 字面量（IPv4 或 [IPv6]）、或指向本机/内网的，补 http；其余补 https。
        const looksLocalOrIp = /^\[[0-9a-fA-F:.]+\]/i.test(trimmed)
            || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/i.test(trimmed)
            || /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:[/?#]|$)/i.test(trimmed)
            || /^[^/?#]+:\d+(?:[/?#]|$)/.test(trimmed);
        withScheme = `${looksLocalOrIp ? 'http' : 'https'}://${trimmed}`;
    }
    if (!/^https?:\/\/[^/\s]+/i.test(withScheme)) return '';
    return withScheme.replace(/\/+$/, '');
};

/** 用户填的地址（已规整）；空字符串表示没填。 */
export const getNeteaseApiBaseOverride = (): string => normalize(getStoredString(STORAGE_KEY, ''));

/** 存用户填的地址；传空字符串就是清除。 */
export const setNeteaseApiBaseOverride = (value: string): void => {
    const next = normalize(value);
    setStoredString(STORAGE_KEY, next);
    // 地址变了，netease.ts 缓存的旧地址要作废；用回调注册，免得设置页去碰 provider 内部。
    for (const listener of [...listeners]) listener();
};

type ChangeListener = () => void;
const listeners = new Set<ChangeListener>();

/** 地址被改写时调用一次（netease.ts 用它清掉自己的地址缓存）。返回取消订阅的函数。 */
export const onNeteaseApiBaseChange = (listener: ChangeListener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** 打包时写进包里的那个地址（runtime-config.js 的 iosOverrides），没有则为空字符串。 */
export const getNeteaseBuildTimeApiBase = (): string => {
    if (typeof window === 'undefined') return '';
    const injected = window.__FOLIA_RUNTIME_CONFIG__?.neteaseApiBase;
    return typeof injected === 'string' ? injected.trim().replace(/\/+$/, '') : '';
};
