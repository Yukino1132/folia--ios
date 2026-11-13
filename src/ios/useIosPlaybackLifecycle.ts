import { useEffect } from 'react';
import { isIosNative } from './iosRuntime';
import { keepScreenAwake, onNativeMediaEvent } from './mediaSessionBridge';
import { PlayerState } from '../types';

// src/ios/useIosPlaybackLifecycle.ts
// 原生壳里的播放生命周期：播放中保持屏幕常亮、来电打断自动暂停、切到后台不做任何干预
// （声音由 AVAudioSession 的 playback 分类维持）。事件只做转发，暂停/继续的判断留在播放器里。

type IosPlaybackLifecycleOptions = {
    playerState: PlayerState;
    /** 来电、闹钟等系统打断结束、且当时正在播放时的恢复动作。 */
    onResumeAfterInterruption: () => void;
    /** 打断开始的暂停动作；原生侧已经把 session 置为非活跃，这里补应用状态。 */
    onPauseForInterruption: () => void;
};

/** 接上原生壳的打断与亮屏策略；非原生环境什么都不做。 */
export const useIosPlaybackLifecycle = ({
    playerState,
    onResumeAfterInterruption,
    onPauseForInterruption,
}: IosPlaybackLifecycleOptions): void => {
    // 只在播放中禁止息屏：暂停后要让系统照常休眠，否则会白耗电。
    useEffect(() => {
        if (!isIosNative()) return;
        void keepScreenAwake(playerState === PlayerState.PLAYING);
    }, [playerState]);

    useEffect(() => {
        if (!isIosNative()) return;
        return onNativeMediaEvent(event => {
            if (event.event === 'interruption-begin') {
                onPauseForInterruption();
                return;
            }
            if (event.event === 'interruption-end') {
                const shouldResume = (event.payload as { shouldResume?: boolean } | undefined)?.shouldResume;
                if (shouldResume === true) onResumeAfterInterruption();
            }
        });
    }, [onPauseForInterruption, onResumeAfterInterruption]);
};
