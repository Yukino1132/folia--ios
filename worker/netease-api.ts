// Worker-side adapter for the NeteaseCloudMusicApi package.
//
// The package is an Express app: routes come from `module/*.js`, and `server.js`
// normalises `{cookie, ...query, ...body}` before calling them. A Worker cannot host
// express (no listener, no raw streams, and raw-body pulls iconv-lite which trips
// esbuild's CJS interop), so this file loads the very same `module/*.js` files and
// reproduces the normalisation itself. Nothing from `server.js`/express is bundled.

import { NETEASE_MODULE_FILES } from "./netease-module-map.mjs";
import { parseRelayTarget, relayPreflight, relayRequest } from "./netease-relay.ts";
import { createRequest } from "./netease-request.ts";
import { textToDataUrl } from "./qr-data-url.ts";
import { checkQrSession, createQrSession } from "./netease-login.ts";

export type NeteaseEnv = {
  NETEASE_ENABLE_GENERAL_UNBLOCK?: string;
  NETEASE_DISABLE_CACHE?: string;
  /** 中转后端地址（`https://api.example.com` 或 `http://[240e:...]:3457`）。配了就走中转。 */
  NETEASE_RELAY_BASE?: string;
  NETEASE_PROXY?: string;
  [key: string]: unknown;
};

export type ModuleHandler = (
  query: Record<string, unknown>,
  request: (...params: unknown[]) => Promise<unknown>,
) => Promise<unknown>;

type ModuleDefinition = { identifier: string; route: string; module: ModuleHandler };

// Route overrides, copied from `server.js` (`special`).
const SPECIAL_ROUTES: Record<string, string> = {
  'daily_signin.js': '/daily_signin',
  'fm_trash.js': '/fm_trash',
  'personal_fm.js': '/personal_fm',
};

// The module directory is spelled out in `netease-module-map.mjs`; bundlers cannot
// enumerate a package directory inside a Worker build, and `import.meta.glob` is not
// available there either.
const moduleFiles = NETEASE_MODULE_FILES;

let tablePromise: Promise<Map<string, ModuleDefinition>> | null = null;
let requestModulePromise: Promise<unknown> | null = null;

const CACHE_TTL_MS = 2 * 60 * 1000;
const responseCache = new Map<string, { expires: number; status: number; body: string; headers: [string, string][] }>();

function getModules(): Promise<Map<string, ModuleDefinition>> {
  if (tablePromise) return tablePromise;

  tablePromise = (async () => {
    const table = new Map<string, ModuleDefinition>();
    const entries = Object.entries(moduleFiles).sort(([a], [b]) => (a < b ? 1 : -1));

    for (const [fileName, handlers] of entries) {
      if (!fileName.endsWith('.js')) continue;
      const loader = handlers[0]?.load;
      if (!loader) continue;
      const loaded = (await loader()) as { default?: unknown } & Record<string, unknown>;
      const module = (loaded.default ?? loaded) as ModuleHandler;
      if (typeof module !== 'function') continue;
      const route = SPECIAL_ROUTES[fileName] ?? handlers[0].route;
      table.set(route.replace(/^\/+/, ''), {
        identifier: fileName.split('.').shift() as string,
        route,
        module,
      });
    }

    return table;
  })();

  return tablePromise;
}

function getRequest() {
  if (!requestModulePromise) {
    requestModulePromise = Promise.resolve(createRequest);
  }
  return requestModulePromise;
}

function cookieToJson(cookie: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = part.slice(idx + 1).trim();
  }
  return out;
}

function readCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    let value = part.slice(idx + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      /* a value that is not percent-encoded is used as-is */
    }
    out[name] = value;
  }
  return out;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  const raw = await request.text();
  if (!raw) return {};
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(raw)) out[key] = value;
  return out;
}

/**
 * Pick the route for `path`, longest registered prefix first, and report the trailing
 * segments so a `:id` style route still receives its parameter.
 */
function matchRoute(table: Map<string, ModuleDefinition>, path: string) {
  const segments = path.replace(/^\/+/, '').split('/').filter(Boolean);
  for (let take = segments.length; take >= 1; take -= 1) {
    const key = segments.slice(0, take).join('/');
    const def = table.get(key);
    if (def && key === 'login/status') {
      return { def, rest: [], browserOnly: true as const };
    }
    if (def) return { def, rest: segments.slice(take), browserOnly: false as const };
  }
  return null;
}

function withCookieAttributes(raw: unknown, secure: boolean): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .map((item) => {
      // Domain attributes from netease.com would be rejected by the browser.
      const cleaned = item.replace(/\s*Domain=[^;]+;*/i, '');
      if (/sameSite=/i.test(cleaned)) return cleaned;
      return secure ? `${cleaned}; SameSite=None; Secure` : `${cleaned}; SameSite=Lax`;
    });
}

function cacheKey(request: Request, url: URL) {
  const cookie = request.headers.get('cookie') || '';
  return `${request.method} ${url.pathname}${url.search}|${cookie.length}|${cookie.slice(-48)}`;
}

function jsonResponse(
  request: Request,
  body: unknown,
  secure: boolean,
  cookies: string[] = [],
) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': request.headers.get('origin') || '*',
    'access-control-allow-credentials': 'true',
    'cache-control': 'no-store',
  });
  for (const cookie of withCookieAttributes(cookies, secure)) {
    headers.append('set-cookie', cookie);
  }
  return new Response(JSON.stringify(body), { status: 200, headers });
}

/** Serve one NeteaseCloudMusicApi endpoint: `/api/search?...` → route `search`. */
/**
 * `/api/login/status` is never reached: the route table owns that name. The browser still
 * asks for it first to find out who is signed in, and the package answers with the caller
 * cookie alone, so it is short-circuited here and skipped by `matchRoute`.
 */

function wantsRelayDebug(url: URL): boolean {
  return url.searchParams.get('__debug') === 'relay';
}

export async function handleNeteaseApi(request: Request, env: NeteaseEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return relayPreflight(request);

  // 配了中转就把整条链交给它：Worker 的出口 IP 会被网易云风控（登录回 8821、取播放地址回
  // -460），中转用的是普通宽带出口，官方看到的是正常 Web 会话。没有中转时才是下面那套
  // 本地模块（直连 music.163.com）。
  const relay = parseRelayTarget(env.NETEASE_RELAY_BASE);
  if (relay) {
    const upstreamPath = url.pathname.replace(/^\/api/, '') || '/';
    // `?__debug=relay` 让调用方直接看到中转的真实回答，否则中转的 4xx/5xx 会被
    // handleNeteaseApi 末尾的 503 兜底吃掉，排查时看不到根因（比如 Cloudflare 1003）。
    const debug = wantsRelayDebug(url);
    const response = await relayRequest(request, relay, upstreamPath);
    if (debug) {
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), 'x-relay-debug': '1' },
      });
    }
    return response;
  }

  const path = url.pathname.replace(/^\/api/, '');
  const secure = url.protocol === 'https:';
  const caching = env.NETEASE_DISABLE_CACHE !== 'true';

  if (caching) {
    const hit = responseCache.get(cacheKey(request, url));
    if (hit && hit.expires > Date.now()) {
      return new Response(hit.body, { status: hit.status, headers: hit.headers });
    }
  }

  const table = await getModules();
  const matched = matchRoute(table, path);
  if (!matched) {
    return Response.json({ code: 404, data: null, msg: 'Not Found' }, { status: 404 });
  }

  const query: Record<string, unknown> = {
    cookie: readCookies(request.headers.get('cookie')),
    ...Object.fromEntries(url.searchParams),
    ...(await readBody(request)),
  };

  if (matched.rest.length) {
    const names = matched.def.route
      .split('/')
      .filter((segment) => segment.startsWith(':'))
      .map((segment) => segment.slice(1));
    names.forEach((name, index) => {
      if (matched.rest[index] !== undefined) query[name] = matched.rest[index];
    });
  }

  if (typeof query.cookie === 'string') query.cookie = cookieToJson(query.cookie);
  const suppressCookies = query.noCookie === 'true' || query.noCookie === true;

  if (matched.browserOnly) {
    const { MUSIC_U, __csrf } = query.cookie as Record<string, string>;
    return jsonResponse(
      request,
      { data: { code: MUSIC_U ? 200 : 301, account: null, profile: null }, code: 200 },
      secure,
      __csrf ? [`__csrf=${__csrf}`] : [],
    );
  }

  const requestFn = await getRequest();

  let payload: { status?: number; body?: unknown; cookie?: unknown } = {};
  try {
    payload = await runModule(matched, query, requestFn);
  } catch (error) {
    const failure = (error ?? {}) as typeof payload;
    payload = failure.body ? failure : { body: { code: 404, data: null, msg: 'Not Found' } };
  }

  const rawStatus = Number(payload.status || 200);
  const status = rawStatus > 100 && rawStatus < 600 ? rawStatus : 400;
  const body = JSON.stringify(payload.body ?? null);

  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': request.headers.get('origin') || '*',
    'access-control-allow-credentials': 'true',
  });
  if (!suppressCookies) {
    for (const cookie of withCookieAttributes(payload.cookie, secure)) {
      headers.append('set-cookie', cookie);
    }
  }

  const result = new Response(body, { status, headers });

  if (caching && status === 200) {
    responseCache.set(cacheKey(request, url), {
      expires: Date.now() + CACHE_TTL_MS,
      status,
      body,
      headers: [...headers].filter(([name]) => name !== 'set-cookie'),
    });
  }

  return result;
}

/**
 * 扫码登录的三个接口由 `netease-login.ts` 回答，不用包里的实现。
 *
 * 包里的 `login_qr_*` 走的是客户端那一侧：`qr/create` 要用 Node 的 `pngjs` 或浏览器的
 * canvas 画图（Worker 两个都没有），更要紧的是上游对这样生成的码回 `8821 环境异常`——
 * 网页的登录接口会校验网页会话的 cookie，只带客户端身份的请求过不去。
 */
async function runQrKey(): Promise<{ status: number; body: unknown }> {
  try {
    const { key } = await createQrSession();
    return { status: 200, body: { code: 200, data: { code: 200, unikey: key } } };
  } catch (error) {
    return {
      status: 502,
      body: { code: 502, data: null, msg: String((error as Error)?.message ?? error).slice(0, 200) },
    };
  }
}

async function runQrCreate(
  query: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const key = String(query.key ?? '');
  if (!key) return { status: 400, body: { code: 400, data: null, msg: 'key is required' } };

  const platform = String(query.platform ?? 'pc');
  let qrurl = `https://music.163.com/login?codekey=${key}`;
  if (platform === 'web') {
    // 网页的码不带 chainId 也能扫；包里的 `generateChainId` 依赖 Node 侧 helper，这里跳过。
    qrurl += '';
  }

  const wantsImage = query.qrimg === true || query.qrimg === 'true';
  return {
    status: 200,
    body: {
      code: 200,
      data: {
        qrurl,
        qrimg: wantsImage ? await textToDataUrl(qrurl) : '',
      },
    },
  };
}

async function runQrCheck(
  query: Record<string, unknown>,
): Promise<{ status: number; body: unknown; cookie: string[] }> {
  const key = String(query.key ?? '');
  if (!key) return { status: 400, body: { code: 400, data: null, msg: 'key is required' }, cookie: [] };

  const { body, cookie } = await checkQrSession(key);
  // 803 才意味着登录成功，那一条上游会下发 `MUSIC_U`；它必须原样交回浏览器，
  // 否则登录窗口拿到「成功」却写不进会话。
  const code = Number(body.code);
  const cookies =
    code === 803 && cookie
      ? cookie
          .split(';')
          .map((part) => part.trim())
          .filter((part) => part.includes('='))
          .map((part) => `${part}; Max-Age=31536000; Path=/`)
      : [];
  return { status: 200, body: { ...body, cookie: cookie || undefined }, cookie: cookies };
}

async function runModule(
  matched: { def: ModuleDefinition },
  query: Record<string, unknown>,
  requestFn: unknown,
) {
  switch (matched.def.route) {
    case '/login/qr/key':
      return runQrKey();
    case '/login/qr/create':
      return runQrCreate(query);
    case '/login/qr/check':
      return runQrCheck(query);
    default:
      return (await matched.def.module(query, requestFn as never)) as {
        status?: number;
        body?: unknown;
        cookie?: unknown;
      };
  }
}

/** Route names registered by the package, used by the `/api/__netease/routes` probe. */
export async function listNeteaseRoutes() {
  const table = await getModules();
  return [...table.keys()].sort();
}
