// src/services/onlineMusic/netease/neteaseQrFallback.ts
// 没配中转后端时，网易云的扫码登录自己直连网易云。扫码登录这三步没有任何加密签名参数，
// 也不需要复用本地后端那份 cookie 处理，在 Web 和原生壳里都能直接发。
// 这里只接管这三步，其余接口照旧走中转：因此不填中转地址也能把账号登进来看本地音乐，
// 填上之后在线搜索、播放、歌单全部恢复。

const NETEASE_QR_UNIKEY_URL = 'https://music.163.com/api/login/qrcode/unikey';
const NETEASE_QR_CHECK_URL = 'https://music.163.com/api/login/qrcode/client/login';
const NETEASE_REFERER = 'https://music.163.com/';
const NETEASE_USER_AGENT =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

// 服务端二维码尺寸（像素）。登录窗口按 176×176 画，取大一点在高分屏上不糊。
const QR_PIXEL_SIZE = 512;
// 直连时的一次请求时限：和中转后端的登录请求时限一致，到点算「没有回应」。
const QR_REQUEST_TIMEOUT_MS = 20_000;

const qrHeaders = (): Record<string, string> => ({
    Referer: NETEASE_REFERER,
    'User-Agent': NETEASE_USER_AGENT,
    Accept: 'application/json, text/plain, */*',
});

/** 直连网易云的一次 POST：超时或非 2xx 都抛错，调用方当作这一步失败。 */
const postJson = async (url: string): Promise<any> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QR_REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'omit',
            headers: qrHeaders(),
            signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`NetEase answered the QR request with HTTP ${response.status}`);
        }
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
    }
};

/** 把二维码内容画成 data:image/png;base64，和中转后端回的 qrimg 同一种形状。 */
const renderQrDataUrl = async (content: string): Promise<string> => {
    const { toDataURL } = await import('qrcode');
    return toDataURL(content, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: QR_PIXEL_SIZE,
        color: { dark: '#000000ff', light: '#ffffffff' },
    });
};

/** 要一个扫码用的 unikey；网易云回 200 但没给 key 时把它的回答带进错误里。 */
export const requestNeteaseQrKey = async (): Promise<string> => {
    const answer = await postJson(`${NETEASE_QR_UNIKEY_URL}?type=1`);
    const key = answer?.unikey ?? answer?.data?.unikey;
    if (typeof key === 'string' && key) return key;
    throw new Error(`NetEase gave no QR key: ${JSON.stringify(answer).slice(0, 200)}`);
};

/** 由 unikey 生成二维码图片：扫码后跳到网易云的登录确认页。 */
export const createNeteaseQrImage = async (key: string): Promise<string> => (
    renderQrDataUrl(`https://music.163.com/login?codekey=${encodeURIComponent(key)}`)
);

/**
 * 检查一次扫码结果，返回值与中转后端的 `/login/qr/check` 一致：
 * `{ code: 800 | 801 | 802 | 803 }`。803 表示手机上确认了。
 */
export const checkNeteaseQr = async (key: string): Promise<{ code: number }> => {
    const answer = await postJson(`${NETEASE_QR_CHECK_URL}?key=${encodeURIComponent(key)}&type=1`);
    const code = Number(answer?.code);
    if (!Number.isFinite(code)) {
        throw new Error(`NetEase gave no QR state: ${JSON.stringify(answer).slice(0, 200)}`);
    }
    return { code };
};

/**
 * 直连能不能用：只在「没配中转地址」时启用。桌面上直连会被浏览器的跨域限制拦住，
 * 所以只给原生壳（CapacitorHttp 已经把跨域代发了）与网页版（网易云接口本身允许跨域读取）用。
 */
export const canUseNeteaseQrFallback = (apiBaseConfigured: boolean): boolean => !apiBaseConfigured;
