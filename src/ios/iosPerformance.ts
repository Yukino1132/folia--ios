import { isIosNative } from '../ios/iosRuntime';
import { BUILTIN_VISUALIZER_MODES, DEFAULT_VISUALIZER_MODE } from '../types/visualizerModes';
import type { VisualizerMode } from '../types';

// src/ios/iosPerformance.ts
// 原生壳（iOS）上容易把帧率打穿的几个地方，集中在这里，桌面/网页端一律走 else 分支、行为不变：
// - 重型歌词样式：3D 场景或重着色器，换歌即重编译、满屏重绘；
// - 随机池：不再把重型样式放进去，每首换一次不必为画面扛这个；
// - 预热：只挑轻的一两个，避免同时占住多个 WebGL 上下文；
// - 渲染像素比：iPhone 是 3x，按 2~3x 渲染再逐帧走 blur/边缘滤镜太贵，压到 1.5。

/** 3D 场景或重着色器的样式（见各 entry 的 order 与 definition）。 */
const HEAVY_VISUALIZER_MODES = new Set<string>([
    'machi',
    'tempera',
    'sonnet',
    'fume',
    'diorama',
    'lumiere',
    'cappella',
    'pendolo',
]);

/** 手机上这个样式是否属于重型（桌面端恒为 false）。 */
export const isHeavyVisualizerOnMobile = (mode: string): boolean => (
    isIosNative() && HEAVY_VISUALIZER_MODES.has(mode)
);

/** 手机上随机池可用的样式：全集去掉重型。枚举顺序沿用 BUILTIN_VISUALIZER_MODES。 */
export const mobileRandomVisualizerPool = (): VisualizerMode[] => (
    isIosNative()
        ? BUILTIN_VISUALIZER_MODES.filter(mode => !HEAVY_VISUALIZER_MODES.has(mode))
        : [...BUILTIN_VISUALIZER_MODES]
);

/** 手机上最多同时预热几个（每个预热都占住一份 WebGL 上下文与显存）。 */
const MOBILE_PREWARM_LIMIT = 2;

/**
 * 手机上空闲预热的目标：声明了 prewarmWhenIdle 的轻样式最多两个；
 * 正在用的那个已由启动时预热过，跳过。桌面端不用这个函数（仍扫全表）。
 */
export const mobilePrewarmCandidates = (savedMode: string): VisualizerMode[] => (
    BUILTIN_VISUALIZER_MODES
        .filter(mode => mode !== savedMode && !HEAVY_VISUALIZER_MODES.has(mode))
        .slice(0, MOBILE_PREWARM_LIMIT)
);

/** 手机上的渲染像素比上限。 */
const MOBILE_RENDER_DPR_CAP = 1.5;

/** 这台机器允许的渲染像素比上限；桌面端无限（沿用原值）。 */
export const renderPixelRatioCap = (): number => (isIosNative() ? MOBILE_RENDER_DPR_CAP : Number.POSITIVE_INFINITY);

/** 把请求的像素比压到本机上限之内，至少 1：桌面端原样返回。 */
export const clampRenderPixelRatio = (dpr: number): number => {
    const safe = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    return Math.max(1, Math.min(safe, renderPixelRatioCap()));
};

/**
 * 手机上选中的样式属于重型、且没有开随机时的提示 key；其余情况返回 null。
 * 提示语写在设置页对应项下面，不在播放中弹 toast。
 */
export const heavySavedVisualizerNoticeKey = (mode: string, randomEnabled: boolean): string | null => {
    if (randomEnabled) return null;
    if (!isHeavyVisualizerOnMobile(mode)) return null;
    return 'options.iosHeavyVisualizerNotice';
};

/** 默认样式在手机上也是轻的，留一个常量兜底（将来默认样式换人时不用改调用方）。 */
export const MOBILE_FALLBACK_VISUALIZER_MODE: VisualizerMode = DEFAULT_VISUALIZER_MODE;
