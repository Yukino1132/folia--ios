// src/services/onlineMusic/netease/neteaseQrFallback.ts
// 没配中转后端时，网易云的扫码登录自己直连网易云。扫码登录这三步没有任何加密签名参数，
// 也不需要复用本地后端那份 cookie 处理，在 Web 和原生壳里都能直接发。
// 这里只接管这三步，其余接口照旧走中转：因此不填中转地址也能把账号登进来看本地音乐，
// 填上之后在线搜索、播放、歌单全部恢复。

// 走网页端的 weapi 链路（/weapi/login/qrcode/{unikey,client/login}），和桌面版网易云、主流第三方
// 客户端用的是同一条：老的 /api/login/qrcode/* 裸接口会被官方按来源挡掉（回 code 400 / 无 key），
// weapi 要带 params + encSecKey 两个加密参数才认。
const NETEASE_QR_UNIKEY_URL = 'https://music.163.com/weapi/login/qrcode/unikey';
const NETEASE_QR_CHECK_URL = 'https://music.163.com/weapi/login/qrcode/client/login';
const NETEASE_REFERER = 'https://music.163.com/';
const NETEASE_ORIGIN = 'https://music.163.com';
const NETEASE_USER_AGENT =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
// weapi 的两个固定常量：AES 的密钥/IV 与 RSA 公钥里的模数、指数，官方长期没换过。
const WEAPI_PRESET_KEY = '0CoJUm6Qyw8W8jud';
const WEAPI_IV = '0102030405060708';
const WEAPI_PUBLIC_KEY = '010001';
const WEAPI_MODULUS =
    '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280'
    + '104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';

// 服务端二维码尺寸（像素）。登录窗口按 176×176 画，取大一点在高分屏上不糊。
const QR_PIXEL_SIZE = 512;
// 直连时的一次请求时限：和中转后端的登录请求时限一致，到点算「没有回应」。
const QR_REQUEST_TIMEOUT_MS = 20_000;

const qrHeaders = (): Record<string, string> => ({
    Referer: NETEASE_REFERER,
    Origin: NETEASE_ORIGIN,
    'User-Agent': NETEASE_USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/x-www-form-urlencoded',
});

// ---- weapi 的两个加密参数 -------------------------------------------------------------
// 官方网页端每次请求都会现算这两段：正文先用固定密钥 AES-CBC 加密，再用随机 16 位密钥加密一次，
// 那段随机密钥用 RSA 公钥加密后放进 encSecKey。随机密钥把这段逻辑包起来，只在这一步用。

const randomSecretKey = (): string => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 16; i += 1) {
        key += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return key;
};

const modPow = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
    let result = 1n;
    let b = base % modulus;
    let e = exponent;
    while (e > 0n) {
        if (e & 1n) result = (result * b) % modulus;
        b = (b * b) % modulus;
        e >>= 1n;
    }
    return result;
};

const rsaEncrypt = (text: string, modulusHex: string, exponentHex: string): string => {
    const bytes = new TextEncoder().encode(text);
    const message = BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`);
    const encrypted = modPow(message, BigInt(`0x${exponentHex}`), BigInt(`0x${modulusHex}`));
    return encrypted.toString(16).padStart(256, '0');
};

const aesEncrypt = async (text: string, key: string): Promise<string> => {
    const { subtle } = globalThis.crypto;
    const cryptoKey = await subtle.importKey('raw', new TextEncoder().encode(key), { name: 'AES-CBC' }, false, ['encrypt']);
    const encrypted = await subtle.encrypt(
        { name: 'AES-CBC', iv: new TextEncoder().encode(WEAPI_IV) },
        cryptoKey,
        new TextEncoder().encode(text),
    );
    return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
};

/** 把正文包成 weapi 要的 `params=…&encSecKey=…` 表单。 */
const sealWeapi = async (payload: Record<string, unknown>): Promise<string> => {
    const secretKey = randomSecretKey();
    const once = await aesEncrypt(JSON.stringify(payload), WEAPI_PRESET_KEY);
    const params = await aesEncrypt(once, secretKey);
    const encSecKey = rsaEncrypt(secretKey.split('').reverse().join(''), WEAPI_MODULUS, WEAPI_PUBLIC_KEY);
    return `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`;
};

/** 直连网易云的一次 weapi POST：超时或非 2xx 都抛错，调用方当作这一步失败。 */
const postJson = async (url: string, payload: Record<string, unknown>): Promise<any> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QR_REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'omit',
            headers: qrHeaders(),
            body: await sealWeapi(payload),
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
    const answer = await postJson(NETEASE_QR_UNIKEY_URL, { type: 1 });
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
    const answer = await postJson(NETEASE_QR_CHECK_URL, { key, type: 1 });
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
