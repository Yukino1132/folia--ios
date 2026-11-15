// src/services/onlineMusic/netease/neteaseRelayProbe.ts
// 中转地址的连通性探测：给设置页的"测试连接"和保存前的校验用。
// 只发一次最轻的请求（取二维码 unikey），判断三件事：能不能连上、有没有超时、回的是不是这个服务。
// 不读也不写任何账号状态，探测本身就是一次匿名请求。

/** 探测的超时。手机上弱网、跨运营商直连都常见，给得比普通请求宽一点。 */
const PROBE_TIMEOUT_MS = 12_000;

export type NeteaseRelayProbe =
    | { ok: true; apiBase: string; durationMs: number }
    | { ok: false; reason: 'empty' | 'unreachable' | 'timeout' | 'bad-answer'; detail: string };

/**
 * 把用户填的地址规整成探测用的基址：补协议、去尾斜杠。
 * 与 neteaseEndpointSetting.ts 的 normalize 保持一致（那边是权威实现，这里只做探测前的清洗，
 * 免得为了探测去 import 一个带 localStorage 的模块）。
 */
export const normalizeNeteaseRelayBase = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) {
        const looksLocalOrIp = /^\[[0-9a-fA-F:.]+\]/i.test(trimmed)
            || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/i.test(trimmed)
            || /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:[/?#]|$)/i.test(trimmed)
            || /^[^/?#]+:\d+(?:[/?#]|$)/.test(trimmed);
        return `${looksLocalOrIp ? 'http' : 'https'}://${trimmed.replace(/\/+$/, '')}`;
    }
    return trimmed.replace(/\/+$/, '');
};

/**
 * 探一次中转是否可用。成功条件是回来的 JSON 里有 unikey——
 * 其它任何 HTTP 服务都不会在这个路径回这个字段，所以"能连上但不是这个服务"也能分辨出来。
 */
export const probeNeteaseRelay = async (rawBase: string): Promise<NeteaseRelayProbe> => {
    const apiBase = normalizeNeteaseRelayBase(rawBase);
    if (!apiBase) return { ok: false, reason: 'empty', detail: '' };

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        const response = await fetch(`${apiBase}/login/qr/key?timestamp=${Date.now()}`, {
            method: 'GET',
            signal: controller.signal,
            // 探测不需要也不该带凭据：避免把 cookie 发给一个还没确认身份的地址。
            credentials: 'omit',
        });
        if (!response.ok) {
            return { ok: false, reason: 'unreachable', detail: `HTTP ${response.status}` };
        }
        let answer: unknown;
        try {
            answer = await response.json();
        } catch (error) {
            console.warn('[netease] 中转探测：返回的不是 JSON', error);
            return { ok: false, reason: 'bad-answer', detail: 'not JSON' };
        }
        const unikey = (answer as { data?: { unikey?: unknown }; unikey?: unknown } | null)?.data?.unikey
            ?? (answer as { unikey?: unknown } | null)?.unikey;
        if (typeof unikey !== 'string' || !unikey) {
            return { ok: false, reason: 'bad-answer', detail: 'no unikey' };
        }
        return { ok: true, apiBase, durationMs: Date.now() - started };
    } catch (error) {
        const aborted = (error as { name?: string } | null)?.name === 'AbortError';
        if (aborted) return { ok: false, reason: 'timeout', detail: '' };
        console.warn('[netease] 中转探测：请求失败', error);
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: 'unreachable', detail };
    } finally {
        clearTimeout(timer);
    }
};
