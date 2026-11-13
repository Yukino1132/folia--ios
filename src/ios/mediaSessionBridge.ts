// src/ios/mediaSessionBridge.ts
// 把 Folia 的播放状态同步到 iOS 锁屏 / 控制中心 / CarPlay，并把原生媒体事件回灌给应用。
// 非 iOS 环境为空实现，Web 与桌面端不会走到这里。

import { getNativePlugin, isIosNative } from './iosRuntime';

type NowPlayingPayload = {
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
    elapsedTime?: number;
    playbackRate?: number;
    queueIndex?: number;
    queueCount?: number;
    coverUrl?: string;
    coverBase64?: string;
};

type MediaEventName =
    | 'remote-play'
    | 'remote-pause'
    | 'remote-toggle'
    | 'remote-next'
    | 'remote-prev'
    | 'remote-seek'
    | 'headphone-unplugged'
    | 'interruption-begin'
    | 'interruption-end'
    | 'background'
    | 'foreground'
    | 'active'
    | 'back-intent'
    | 'remote-back';

type MediaEventPayload = {
    event: MediaEventName;
    payload?: Record<string, unknown>;
};

type FoliaMediaPlugin = {
    setNowPlaying?: (data: NowPlayingPayload) => Promise<void>;
    setPlaybackState?: (data: { isPlaying: boolean; elapsedTime?: number }) => Promise<void>;
    clearNowPlaying?: () => Promise<void>;
    keepAwake?: (data: { enabled: boolean }) => Promise<void>;
    share?: (data: { text?: string; url?: string; filePath?: string }) => Promise<void>;
    openExternal?: (data: { url: string }) => Promise<void>;
    haptic?: (data: { style?: string }) => Promise<void>;
    deviceInfo?: () => Promise<Record<string, unknown>>;
    addListener?: (event: 'mediaEvent', cb: (data: MediaEventPayload) => void) => { remove: () => void };
};

const plugin = (): FoliaMediaPlugin | undefined => (
    isIosNative() ? getNativePlugin<FoliaMediaPlugin>('FoliaMedia') : undefined
);

const listeners = new Set<(payload: MediaEventPayload) => void>();
let listenerHandle: { remove: () => void } | null = null;

/** 订阅原生媒体事件（锁屏按钮、线控、耳机拔出、来电打断）。 */
export const onNativeMediaEvent = (cb: (payload: MediaEventPayload) => void): (() => void) => {
    listeners.add(cb);
    if (!listenerHandle) {
        const p = plugin();
        listenerHandle = p?.addListener?.('mediaEvent', (payload) => {
            listeners.forEach(fn => {
                try {
                    fn(payload);
                } catch (error) {
                    console.warn('[ios] 媒体事件处理失败', error);
                }
            });
        }) ?? null;
    }
    return () => {
        listeners.delete(cb);
    };
};

/** 写入锁屏 Now Playing 信息。封面优先用 base64（本地封面无法被原生读取时）。 */
export const setNowPlaying = async (payload: NowPlayingPayload): Promise<void> => {
    const p = plugin();
    if (!p?.setNowPlaying) return;
    try {
        await p.setNowPlaying(payload);
    } catch (error) {
        console.warn('[ios] setNowPlaying 失败', error);
    }
};

/** 同步播放/暂停与进度（锁屏进度条与系统播放状态）。 */
export const setNativePlaybackState = async (isPlaying: boolean, elapsedTime?: number): Promise<void> => {
    const p = plugin();
    if (!p?.setPlaybackState) return;
    try {
        await p.setPlaybackState({ isPlaying, elapsedTime });
    } catch (error) {
        console.warn('[ios] setPlaybackState 失败', error);
    }
};

export const clearNowPlaying = async (): Promise<void> => {
    await plugin()?.clearNowPlaying?.().catch((error: unknown) => {
        console.warn('[ios] clearNowPlaying 失败', error);
    });
};

/** 播放时阻止屏幕休眠；暂停时恢复。 */
export const keepScreenAwake = async (enabled: boolean): Promise<void> => {
    await plugin()?.keepAwake?.({ enabled }).catch((error: unknown) => {
        console.warn('[ios] keepAwake 失败', error);
    });
};

export const shareIos = async (data: { text?: string; url?: string; filePath?: string }): Promise<void> => {
    await plugin()?.share?.(data);
};

export const openExternalIos = async (url: string): Promise<void> => {
    await plugin()?.openExternal?.({ url });
};

export const haptic = async (style: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection' = 'light'): Promise<void> => {
    await plugin()?.haptic?.({ style }).catch(() => {});
};

/** 把 data URL 转成裸 base64（原生插件只接受裸 base64）。 */
export const toBareBase64 = (dataUrl: string): string => {
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
};
