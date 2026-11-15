import { getNeteaseApiBaseOverride, getNeteaseBuildTimeApiBase } from './neteaseEndpointSetting';
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from '../providerStorage';

// src/services/onlineMusic/netease/neteaseCookieSignIn.ts
// 粘贴登录：把在真实浏览器里登录后拿到的凭据交给应用，绕开扫码确认那一步。
//
// 为什么要这条路：扫码取码和轮询都是正常的（weapi 签名、真实 UA、正确的 Origin 都验证过），
// 被拒的是最后的确认，网易云回的是行为风控码（8821），看的是这条会话从哪来、有没有真实设备痕迹，
// 不是请求格式。在 HTTP 层再伪装改不动它；而登录这件事交给真实浏览器做，风控要的验证都在那边过掉，
// 应用只收结果，确认这一步根本不发生。
//
// 凭据就是浏览器里的那串 Cookie（至少要有 MUSIC_U；带上 __csrf 才能在改歌单、点赞这类写操作上通行）。
// 存进 provider 的会话存储，和扫码登录成功后写的是同一个位置，后面的请求照旧从那里取（netease.ts
// 的 fetchWithCreds 以 `cookie=` 查询参数带上）。
//
// 先拿它问一次「现在是谁登录着」再存：凭据贴错、复制不全、已经过期，当场就能看出来，
// 不会把一个用不了的凭据留在存储里，也不会把之前还能用的那个盖掉。

const LOGIN_STATUS_LIMIT_MS = 15_000;

// 旧版本把这个 Cookie 存在没带 provider 前缀的键上（providerStorage 会把它迁过来）。
const COOKIE_LEGACY_KEYS = ['netease_cookie'];

// 浏览器和本地后端要的那个 Cookie 名。MUSIC_U 是登录本身，少了它剩下的都不算登录。
const MUSIC_U = 'MUSIC_U';

/** 这次粘贴的结果：成功时带上平台给的昵称，失败时说清楚卡在哪一步。 */
export type NeteaseCookieSignIn =
    | { ok: true; nickname: string }
    | { ok: false; reason: 'empty' | 'not-a-cookie' | 'no-relay' | 'rejected' | 'unreachable'; detail?: string };

/** 现在存着的凭据（没有则为 null）。 */
export const readNeteaseCookie = (): string | null => readProviderSessionValue('netease', 'cookie', COOKIE_LEGACY_KEYS);

/**
 * 把粘贴进来的文字规整成 Cookie 串。
 *
 * 认识的三种写法：浏览器 DevTools 里整串 `a=1; b=2`、换行分开的一列、以及只复制了 MUSIC_U 的值
 * （没有等号，补上名字）。`Cookie:` 前缀是 Network 面板里连同头一起复制的，去掉。
 * 不合规的片段（没有等号、名字里带空格）丢掉：贴进来时混进说明文字是常事。
 */
export const normalizeNeteaseCookie = (raw: string): string => {
    const trimmed = raw.trim().replace(/^cookie\s*:\s*/i, '');
    if (!trimmed) return '';
    if (!trimmed.includes('=')) return `${MUSIC_U}=${trimmed}`;
    return trimmed
        .split(/[\r\n;]+/)
        .map(pair => pair.trim())
        .filter(pair => /^[^=\s]+=\S*$/.test(pair))
        .join('; ');
};

/** 这串里有没有登录本身那个 Cookie。 */
export const hasNeteaseMusicU = (cookie: string): boolean => new RegExp(`(?:^|;\\s*)${MUSIC_U}=`, 'i').test(cookie);

// 和 netease.ts 的 getConfiguredApiBase 同一个次序：用户填的、运行期注入的、打包时的。
// 桌面版走内嵌后端，这里用不到；原生壳里前两个就是全部。
const resolveApiBase = (): string => {
    const override = getNeteaseApiBaseOverride();
    if (override) return override;
    const injected = getNeteaseBuildTimeApiBase();
    if (injected) return injected;
    const viteEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
    const fromBuild = viteEnv?.VITE_NETEASE_API_BASE;
    return typeof fromBuild === 'string' ? fromBuild.trim().replace(/\/+$/, '') : '';
};

// 带着这串凭据问一次「现在是谁登录着」。返回的 detail 只会是数字或一句固定的话：
// 这条错误要显示在界面上，不能把凭据本身（它在请求地址里）带出去。
const askWhoIsSignedIn = async (base: string, cookie: string): Promise<NeteaseCookieSignIn> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGIN_STATUS_LIMIT_MS);
    let response: Response;
    try {
        response = await fetch(`${base}/login/status?timestamp=${Date.now()}&cookie=${encodeURIComponent(cookie)}`, {
            credentials: 'omit',
            signal: controller.signal,
        });
    } catch (error) {
        return { ok: false, reason: 'unreachable', detail: (error as { name?: string } | null)?.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
        clearTimeout(timer);
    }
    if (!response.ok) return { ok: false, reason: 'unreachable', detail: `HTTP ${response.status}` };

    let answer: any;
    try {
        answer = await response.json();
    } catch {
        return { ok: false, reason: 'unreachable', detail: 'not JSON' };
    }

    // 没登录时网易云不给 profile：码是 301/401/403 之一，或者干脆没有这个字段。
    const profile = answer?.data?.profile ?? answer?.profile;
    const code = Number(answer?.code ?? answer?.data?.code);
    if (!profile || [301, 401, 403].includes(code)) return { ok: false, reason: 'rejected', detail: String(code) };
    return { ok: true, nickname: typeof profile.nickname === 'string' ? profile.nickname : '' };
};

/**
 * 用粘贴的凭据登录：先核对，认下来了才存。失败时存储里原来的凭据一动不动。
 */
export const signInWithNeteaseCookie = async (raw: string): Promise<NeteaseCookieSignIn> => {
    const cookie = normalizeNeteaseCookie(raw);
    if (!cookie) return { ok: false, reason: 'empty' };
    if (!hasNeteaseMusicU(cookie)) return { ok: false, reason: 'not-a-cookie' };

    const base = resolveApiBase();
    if (!base) return { ok: false, reason: 'no-relay' };

    const answer = await askWhoIsSignedIn(base, cookie);
    if (!answer.ok) return answer;

    writeProviderSessionValue('netease', 'cookie', cookie);
    return answer;
};

/** 退出登录：只删凭据。 */
export const signOutNeteaseCookie = (): void => {
    removeProviderSessionValue('netease', 'cookie', COOKIE_LEGACY_KEYS);
};
