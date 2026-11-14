// src/services/onlineMusic/netease/neteaseRelayProbe.ts
// 中转地址填好之后能不能用，由应用自己去问一次：拿 `{base}/login/qr/key` 要一个扫码 key。
// 这样用户在设置里点「测试」就能立刻知道地址是不是写对了、服务是不是活着，而不是等到登录窗口才发现。
// 只发一次 GET，不读任何登录态，也不写缓存。

const PROBE_TIMEOUT_MS = 12_000;

export type NeteaseRelayProbe =
    | { ok: true; apiBase: string; durationMs: number }
    | { ok: false; reason: 'empty' | 'unreachable' | 'timeout' | 'bad-answer'; detail: string };

/** 把用户输入规整成地址：补 https、去尾斜杠；不是 http(s) 就当没填。 */
export const normalizeNeteaseRelayBase = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (!/^https?:\/\/[^/\s]+/i.test(withScheme)) return '';
    return withScheme.replace(/\/+$/, '');
};

/**
 * 问一次中转后端。`NeteaseCloudMusicApi` 的 `/login/qr/key` 回的是
 * `{ code: 200, data: { unikey } }`，这里只确认它能连通并给出这个形状。
 */
export const probeNeteaseRelay = async (rawBase: string): Promise<NeteaseRelayProbe> => {
    const apiBase = normalizeNeteaseRelayBase(rawBase);
    if (!apiBase) return { ok: false, reason: 'empty', detail: '' };

    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        const response = await fetch(`${apiBase}/login/qr/key?timestamp=${startedAt}`, {
            method: 'GET',
            credentials: 'omit',
            signal: controller.signal,
            headers: { Accept: 'application/json, text/plain, */*' },
        });
        const durationMs = Date.now() - startedAt;
        const text = await response.text();
        if (!response.ok) {
            return { ok: false, reason: 'unreachable', detail: `HTTP ${response.status}` };
        }
        // 有的部署会在前面加一层网关，回的是 HTML：那也不是能用的中转。
        let answer: any = null;
        try {
            answer = JSON.parse(text);
        } catch {
            return { ok: false, reason: 'bad-answer', detail: text.slice(0, 120) };
        }
        const key = answer?.data?.unikey ?? answer?.unikey;
        if (typeof key === 'string' && key) return { ok: true, apiBase, durationMs };
        return { ok: false, reason: 'bad-answer', detail: JSON.stringify(answer).slice(0, 120) };
    } catch (error) {
        const aborted = (error as { name?: string } | null)?.name === 'AbortError';
        return { ok: false, reason: aborted ? 'timeout' : 'unreachable', detail: (error as Error)?.message ?? '' };
    } finally {
        clearTimeout(timer);
    }
};
