// src/ios/fetchIosNetwork.ts
// iOS 原生壳的 HTTP 发送层：把 Capacitor 原生的 CapacitorHttp 请求包装成 fetch 的签名。
// 为什么原生壳需要它：WKWebView 里 fetch 受 CORS 约束，在线平台的第三方接口
// 不给 * 跨域头，浏览器请求一律被拦；原生层发请求没有这个限制（capacitor.config.json 里
// CapacitorHttp.enabled 打开后 Capacitor 也会自动改写 fetch，这里给出显式控制与 fetch
// 不支持的响应类型 aborted/timeout 的语义），所以原生壳里的跨域请求走这里。

type CapacitorHttpResponse = {
    status?: number;
    data?: unknown;
    headers?: Record<string, string>;
    url?: string;
};

type CapacitorHttpRequest = {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
    responseType?: 'text' | 'json' | 'arraybuffer' | 'blob';
    connectTimeout?: number;
    readTimeout?: number;
    webFetchExtra?: Record<string, unknown>;
};

type CapacitorHttpPlugin = {
    request?: (options: CapacitorHttpRequest) => Promise<CapacitorHttpResponse>;
};

type CapacitorWithHttp = {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: Record<string, any>;
};

const capacitor = (): CapacitorWithHttp | null => {
    if (typeof window === 'undefined') return null;
    return (window as unknown as { Capacitor?: CapacitorWithHttp }).Capacitor ?? null;
};

/** 原生 HTTP 可用时返回插件，否则 null（普通浏览器 / Electron 里永远是 null）。 */
export const getIosHttpPlugin = (): CapacitorHttpPlugin | null => {
    const c = capacitor();
    if (!c || typeof c.isNativePlatform !== 'function' || !c.isNativePlatform()) return null;
    const plugin = c.Plugins?.CapacitorHttp as CapacitorHttpPlugin | undefined;
    return typeof plugin?.request === 'function' ? plugin : null;
};

const toHeadersObject = (headers: HeadersInit | undefined): Record<string, string> => {
    if (!headers) return {};
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        const out: Record<string, string> = {};
        headers.forEach((value, key) => {
            out[key] = value;
        });
        return out;
    }
    if (Array.isArray(headers)) return Object.fromEntries(headers);
    return { ...(headers as Record<string, string>) };
};

const readBody = async (body: BodyInit | null | undefined): Promise<unknown> => {
    if (body == null) return undefined;
    if (typeof body === 'string') return body;
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== 'undefined' && body instanceof FormData) return body;
    if (typeof Blob !== 'undefined' && body instanceof Blob) return await body.text();
    return body;
};

const normalizeStatus = (status: unknown): number => {
    const value = Number(status);
    return Number.isFinite(value) && value > 0 ? value : 200;
};

/**
 * 用原生 HTTP 发一次请求，返回与 fetch 同形的 Response。
 * 只在 `getIosHttpPlugin()` 有值时调用；失败时抛出异常，由调用方的重试逻辑处理。
 */
export const iosNativeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const plugin = getIosHttpPlugin();
    if (!plugin?.request) throw new Error('IOS_NATIVE_HTTP_UNAVAILABLE');

    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET') ?? 'GET').toUpperCase();
    const headers = toHeadersObject(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
    const body = await readBody(init?.body ?? null);

    const result = await plugin.request({
        url: rawUrl,
        method,
        headers,
        data: body === undefined ? undefined : body,
        responseType: 'text',
        connectTimeout: 15000,
        readTimeout: 30000,
    });

    const status = normalizeStatus(result?.status);
    // 原生层在 Content-Type 为 JSON 时已经把 data 解成对象，此时直接还原文本；
    // 其余情况 data 是字符串（HttpRequestHandler.buildResponse 对 text/default 都取 UTF-8 文本）。
    const text = typeof result?.data === 'string'
        ? result.data
        : result?.data == null
            ? ''
            : JSON.stringify(result.data);
    return new Response(text, {
        status,
        statusText: status >= 200 && status < 300 ? 'OK' : '',
        headers: result?.headers ?? {},
    });
};

/**
 * 地址里的主机是 IP 字面量（IPv4 或带方括号的 IPv6）。
 * WKWebView 里 `new URL()` 对 `http://[240e:...]:3457` 这种 IPv6 字面量在部分 iOS 版本上会抛，
 * 抛了就落到 catch 返回 false，请求退回 WebView 的 fetch 被 CORS 拦掉，界面上只表现为"连不上"。
 * 这类地址一定是跨域的，直接判定走原生层，不经过 URL 解析。
 */
const isIpLiteralHost = (url: string): boolean => {
    // http://[240e:3b5:...]:3457/... 或 http://1.2.3.4:3457/...
    return /^https?:\/\/\[[0-9a-fA-F:.]+\]/i.test(url) || /^https?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/i.test(url);
};

/** 这条 URL 是否值得走原生请求（原生壳 + 跨域 http(s)）。包内资源与同源请求仍走 WebView 的 fetch。 */
export const shouldUseIosNativeFetch = (url: string): boolean => {
    if (!getIosHttpPlugin()) return false;
    if (!/^https?:/i.test(url)) return false;
    // IP 字面量（含 IPv6 方括号）一律走原生层：它是跨域的，且 WKWebView 对它的 URL 解析不可靠。
    if (isIpLiteralHost(url)) return true;
    if (typeof location === 'undefined') return true;
    // 原生壳的 location 是 capacitor://localhost.folia 这类非标准 scheme，new URL() 组合解析可能失败。
    // 解析失败时按"跨域"处理：走原生层是安全的兜底（原生层不受 CORS 约束），
    // 退回 WebView 的 fetch 则一定被拦。这里选前者。
    try {
        const target = new URL(url, location.href);
        const sameOrigin = target.origin === location.origin;
        return !sameOrigin;
    } catch {
        return true;
    }
};
