// `/api/*` 的外包模式：把整个网易云后端交给一台「出口干净」的中转服务，Worker 自己不再
// 直连 music.163.com。
//
// 为什么要有这条路：Worker 的出口是 Cloudflare 的共享 IP，网易云对它的风控很重 ——
// 登录接口直接回 `8821 检测到当前环境异常`，取播放地址回 `-460`。中转服务（`netease-deploy`
// 里那套 NeteaseCloudMusicApi，跑在家宽 IPv6 或 VPS 上）用的是普通宽带出口，网易看到的是
// 一次正常的 Web 会话。
//
// 转发保持「同构」：路径、查询串、请求体原样过去，响应体和 `Set-Cookie` 原样回来，只在
// 需要时改写 `Domain`（中转的 cookie 不该落到我们的域上）与补 `Secure`/`SameSite`。

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'cf-connecting-ip',
  'cf-ray',
  'cf-visitor',
  'x-forwarded-proto',
  'x-forwarded-for',
  'x-real-ip',
]);

export type RelayTarget = { base: string };

/** 中转地址只收绝对 http(s)；末尾斜杠去掉，拼路径时自己加。 */
export function parseRelayTarget(raw: unknown): RelayTarget | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { base: `${url.origin}${url.pathname.replace(/\/+$/, '')}` };
  } catch {
    return null;
  }
}

function rewriteSetCookie(raw: string, secure: boolean): string {
  // 中转是从另一个域上回话的，它给的 `Domain=` 在浏览器里会被拒（或者更糟，把会话串到
  // 别人的域上），这里一律剥掉，让 cookie 落在当前站点。
  let value = raw.replace(/\s*Domain=[^;]*;?/gi, '').replace(/;;+/g, ';');
  if (!/;\s*path=/i.test(value)) value += '; Path=/';
  if (secure && !/;\s*secure/i.test(value)) value += '; Secure';
  if (!/;\s*samesite=/i.test(value)) value += secure ? '; SameSite=None' : '; SameSite=Lax';
  return value;
}

/** `/song/url/v1` 的 `level` 与旧接口 `br` 的对应关系。 */
const LEVEL_TO_BR: Record<string, number> = {
  standard: 128000,
  higher: 192000,
  exhigh: 320000,
  lossless: 999000,
  hires: 1999000,
  jyeffect: 1999000,
  sky: 1999000,
  jymaster: 1999000,
};

/**
 * `/song/url/v1` 有一条只能靠运气绕过的路：网易云对「非常规出口 IP」直接回 `-460 检测到
 * 您的网络环境存在风险`，而这个判断跟登录态无关，换了 cookie 也一样。旧接口 `/song/url`
 * 不吃这套风控，返回的结构和 v1 几乎一样（只是用 `br` 而不是 `level` 表达音质）。
 *
 * 所以这里先按 v1 打一次，拿到 -460 就退回旧接口，并把 `level` 补回结果里，让前端看不出
 * 差别。
 */
async function relaySongUrl(
  request: Request,
  target: RelayTarget,
  upstreamPath: string,
  incoming: URL,
  headers: Headers,
): Promise<Response | null> {
  const v1 = await fetch(`${target.base}${upstreamPath}${incoming.search}`, {
    method: request.method,
    headers,
    cache: 'no-store',
  });
  const text = await v1.text();
  let risky = false;
  try {
    risky = (JSON.parse(text) as { code?: number }).code === -460;
  } catch {
    risky = false;
  }
  if (!risky) {
    return new Response(text, {
      status: v1.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const id = incoming.searchParams.get('id') ?? '';
  const level = (incoming.searchParams.get('level') ?? 'standard').toLowerCase();
  const br = LEVEL_TO_BR[level] ?? 128000;
  const legacy = await fetch(`${target.base}/song/url?id=${encodeURIComponent(id)}&br=${br}&https=true`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  const legacyText = await legacy.text();
  try {
    const parsed = JSON.parse(legacyText) as { code?: number; data?: Record<string, unknown>[] };
    for (const item of parsed.data ?? []) {
      if (!item.level) item.level = level;
      // 旧接口无视 `https=true`，仍然给 `http://` 的音频地址。站点本身是 https，
      // 浏览器会把这种混合内容直接拦掉，所以在这里升一次协议。
      if (typeof item.url === 'string' && item.url.startsWith('http://')) {
        item.url = `https://${item.url.slice('http://'.length)}`;
      }
    }
    return new Response(JSON.stringify(parsed), {
      status: legacy.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-relay-fallback': 'song-url-legacy',
      },
    });
  } catch {
    return new Response(legacyText, {
      status: legacy.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}

/**
 * 把 `request`（路径 `/api/...`）转给 `target.base`，并把它回答的东西整理成同域可用的形状。
 * `upstreamPath` 用来把 `/api/foo` 变成中转上的 `/foo`（中转自己是根路径挂载的）。
 */
export async function relayRequest(
  request: Request,
  target: RelayTarget,
  upstreamPath: string,
): Promise<Response> {
  const incoming = new URL(request.url);
  const url = `${target.base}${upstreamPath}${incoming.search}`;

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    headers.set(name, value);
  }
  // 中转那条链上的 CORS 由我们自己回，避免上游再叠一层冲突的头。
  headers.delete('origin');
  headers.delete('access-control-request-headers');
  headers.delete('access-control-request-method');

  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

  if (method === 'GET' && upstreamPath.startsWith('/song/url/v1')) {
    const fallback = await relaySongUrl(request, target, upstreamPath, incoming, headers);
    if (fallback) return fallback;
  }

  const upstream = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'follow',
    cache: 'no-store',
  });

  const responseHeaders = new Headers();
  for (const [name, value] of upstream.headers) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    if (name.toLowerCase() === 'set-cookie') continue;
    responseHeaders.set(name, value);
  }
  const secure = incoming.protocol === 'https:';
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    responseHeaders.append('set-cookie', rewriteSetCookie(cookie, secure));
  }
  const origin = request.headers.get('origin');
  responseHeaders.set('access-control-allow-origin', origin || '*');
  if (origin) responseHeaders.set('access-control-allow-credentials', 'true');
  // 扫码状态一直在变，中间缓存不许插手。
  if (incoming.pathname.startsWith('/api/login')) {
    responseHeaders.set('cache-control', 'no-store');
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

/** 中转的 CORS 预检由我们自己回答，省掉一次跨域往返。 */
export function relayPreflight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': request.headers.get('origin') || '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': request.headers.get('access-control-request-headers') || '*',
      'access-control-allow-credentials': 'true',
      'access-control-max-age': '86400',
    },
  });
}

/**
 * 中转自检：把 `/login/qr/key` 打过去，用回答判断这条链通不通。部署后用
 * `GET /api/__netease/relay` 看一眼就知道 Worker 到中转这段有没有接上。
 */
export async function probeRelay(target: RelayTarget): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(`${target.base}/login/qr/key`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const text = (await response.text()).slice(0, 200);
    let ok = false;
    try {
      const parsed = JSON.parse(text) as { data?: { unikey?: string }; unikey?: string };
      ok = Boolean(parsed.data?.unikey ?? parsed.unikey);
    } catch {
      ok = false;
    }
    return { ok, detail: `${response.status} ${text}` };
  } catch (error) {
    return { ok: false, detail: String((error as Error)?.message ?? error).slice(0, 200) };
  }
}
