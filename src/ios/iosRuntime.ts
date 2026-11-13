// src/ios/iosRuntime.ts
// iOS（Capacitor 壳）运行时的探测与原生桥接。Web 与 Electron 构建都不会命中这里的任何分支：
// 只有 Capacitor 在 WKWebView 里注入 `window.Capacitor.isNativePlatform() === true` 时为真。

export type FoliaIosBridge = {
    /** 是否运行在 iOS 原生壳里 */
    isIos: boolean;
    /** 屏幕安全区（px），由原生插件在启动后注入 */
    safeArea: { top: number; bottom: number; left: number; right: number };
    /** 是否为低功耗/低电量设备（用于降级动画与粒子数量） */
    isLowPower: boolean;
    /** 设备像素比，用于决定 canvas 分辨率上限 */
    dpr: number;
    /** 物理内存（GB 近似），低于阈值时关闭高开销歌词样式 */
    memoryGb: number;
};

const DEFAULT_RUNTIME: FoliaIosBridge = {
    isIos: false,
    safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
    isLowPower: false,
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    memoryGb: 4,
};

let runtime: FoliaIosBridge = { ...DEFAULT_RUNTIME };

type CapacitorGlobal = {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: Record<string, any>;
};

const cap = (): CapacitorGlobal | null => {
    if (typeof window === 'undefined') return null;
    return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null;
};

/** 是否在 iOS 原生壳内运行。 */
export const isIosNative = (): boolean => {
    const c = cap();
    if (!c) return false;
    if (typeof c.getPlatform === 'function') return c.getPlatform() === 'ios';
    return typeof c.isNativePlatform === 'function' && c.isNativePlatform() === true;
};

/** 是否在任意 Capacitor 原生壳内（Android 移植版也会命中）。 */
export const isCapacitorNative = (): boolean => {
    const c = cap();
    return Boolean(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() === true);
};

/** 访问原生插件（未安装时返回 undefined）。 */
export const getNativePlugin = <T = any>(name: string): T | undefined => {
    return cap()?.Plugins?.[name] as T | undefined;
};

export const getIosRuntime = (): FoliaIosBridge => runtime;

/**
 * 在应用启动时调用一次：读取设备信息、写入安全区 CSS 变量、注册媒体事件转发。
 * 非 iOS 环境下是空操作。
 */
export const bootstrapIosRuntime = async (): Promise<FoliaIosBridge> => {
    if (!isIosNative()) return runtime;

    const media = getNativePlugin('FoliaMedia');
    try {
        const info = await media?.deviceInfo?.();
        if (info) {
            runtime = {
                ...runtime,
                safeArea: {
                    top: Number(info.safeAreaTop) || 0,
                    bottom: Number(info.safeAreaBottom) || 0,
                    left: 0,
                    right: 0,
                },
                isLowPower: Boolean(info.isLowPowerMode),
                dpr: Number(info.scale) || window.devicePixelRatio || 1,
                memoryGb: deviceMemoryGb(),
            };
            applySafeArea(runtime.safeArea);
        }
    } catch (error) {
        console.warn('[ios] 读取设备信息失败，使用默认值', error);
    }
    return runtime;
};

/** 把原生安全区写进 CSS 变量，供布局层读取（env() 在 WKWebView 中对部分弹层不生效）。 */
const applySafeArea = (safeArea: FoliaIosBridge['safeArea']) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--folia-safe-top', `${safeArea.top}px`);
    root.style.setProperty('--folia-safe-bottom', `${safeArea.bottom}px`);
};

/** 设备内存（GB，近似）。iOS 的 WKWebView 暴露 deviceMemory 为固定值，这里优先用原生注入。 */
const deviceMemoryGb = (): number => {
    const raw = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    return typeof raw === 'number' && raw > 0 ? raw : 4;
};

/** 判断是否应该走移动端布局（触屏 + 窄屏，或 Capacitor 壳）。 */
export const shouldUseMobileLayout = (): boolean => {
    if (isCapacitorNative()) return true;
    if (typeof window === 'undefined') return false;
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    return coarse && window.innerWidth <= 820;
};
