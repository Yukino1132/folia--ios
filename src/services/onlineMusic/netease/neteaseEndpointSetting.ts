import { getStoredString, setStoredString } from '../../../stores/storagePrimitives';

// src/services/onlineMusic/netease/neteaseEndpointSetting.ts
// 网易云中转地址的应用内设置：原生壳（IPA）里没有构建期环境变量，装上之后又改不了包，
// 所以允许用户在设置里填自己的中转服务地址，存 localStorage，取用时排在 runtime-config.js 之后。
//
// 空字符串 = 没填，回落到 runtime-config.js 注入的值（打包时用 FOLIA_NETEASE_API_BASE 指定）。
// 这个模块不依赖 UI，netease.ts 与设置页都从这里取。

const STORAGE_KEY = 'folia.netease.apiBase';

/** 把用户输入规整成地址：补协议、去结尾斜杠；不是 http(s) 或不合法时返回空字符串。 */
const normalize = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    // 只认 http(s)：粘贴时常见的 `example.com/api` 补上 https，其它（file:、javascript:）当没填。
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (!/^https?:\/\/[^/\s]+/i.test(withScheme)) return '';
    return withScheme.replace(/\/+$/, '');
};

/** 用户填的地址（已规整）；空字符串表示没填。 */
export const getNeteaseApiBaseOverride = (): string => {
    // Node（单元测试、SSR）里没有 localStorage：getStoredString 只挡了 window 缺失，
    // 而 jsdom 之外的测试环境恰好有全局对象却没有存储 —— 这里再挡一次，读不到就当没填。
    if (typeof localStorage === 'undefined') return '';
    return normalize(getStoredString(STORAGE_KEY, ''));
};

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
