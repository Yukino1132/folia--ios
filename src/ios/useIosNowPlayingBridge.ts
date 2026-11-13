import { useEffect } from 'react';
import type { MotionValue } from 'framer-motion';
import type { PlayerState, SongResult } from '../types';
import { isIosNative } from './iosRuntime';
import {
    clearNowPlaying,
    onNativeMediaEvent,
    setNativePlaybackState,
    setNowPlaying,
    toBareBase64,
} from './mediaSessionBridge';

// src/ios/useIosNowPlayingBridge.ts
// 把当前显示的曲目推给 iOS 锁屏 / 控制中心 / 车机，并把锁屏与线控按钮接回播放器。

type IosNowPlayingBridgeOptions = {
    currentSong: SongResult | null;
    currentCoverUrl: string | null;
    playerState: PlayerState;
    duration: number;
    currentTime: MotionValue<number>;
    queueIndex: number;
    queueLength: number;
    unknownArtistLabel: string;
    onPlay: () => void;
    onPause: () => void;
    onToggle: () => void;
    onNext: () => void;
    onPrev: () => void;
    /** 锁屏拖动进度：传入目标秒数。 */
    onSeek: (seconds: number) => void;
    /** 线控拔出耳机：原生侧已经暂停，这里只补应用侧状态。 */
    onHeadphoneUnplugged: () => void;
};

const isPlayableArtwork = (url: string | null): url is string => (
    typeof url === 'string' && (url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:'))
);

/** 把曲目信息与播放状态同步到系统媒体中心；原生壳之外是空实现。 */
export const useIosNowPlayingBridge = ({
    currentSong,
    currentCoverUrl,
    playerState,
    duration,
    currentTime,
    queueIndex,
    queueLength,
    unknownArtistLabel,
    onPlay,
    onPause,
    onToggle,
    onNext,
    onPrev,
    onSeek,
    onHeadphoneUnplugged,
}: IosNowPlayingBridgeOptions): void => {
    const songId = currentSong?.id ?? null;

    useEffect(() => {
        if (!isIosNative()) return;

        if (!currentSong) {
            void clearNowPlaying();
            return;
        }

        const artistNames = Array.isArray(currentSong.artists)
            ? currentSong.artists.map(entry => entry?.name).filter(Boolean)
            : [];
        const payload = {
            title: currentSong.name ?? '',
            artist: artistNames.length > 0 ? artistNames.join(' / ') : unknownArtistLabel,
            album: currentSong.album?.name ?? '',
            duration: Number.isFinite(duration) ? duration : 0,
            elapsedTime: currentTime.get(),
            queueIndex,
            queueCount: queueLength,
        };

        // 封面走 base64 交给原生：本地图无法被原生侧直接按 URL 读取，跨域图也一样。
        let cancelled = false;
        const publish = async () => {
            if (isPlayableArtwork(currentCoverUrl) && !currentCoverUrl.startsWith('data:')) {
                await setNowPlaying({ ...payload, coverUrl: currentCoverUrl });
                return;
            }
            if (isPlayableArtwork(currentCoverUrl) && currentCoverUrl.startsWith('data:')) {
                await setNowPlaying({ ...payload, coverBase64: toBareBase64(currentCoverUrl) });
                return;
            }
            await setNowPlaying(payload);
        };

        void publish().catch(error => {
            if (!cancelled) console.warn('[ios] 写入锁屏信息失败', error);
        });

        return () => {
            cancelled = true;
        };
        // 只跟着曲目、封面、时长这三个「换歌量」走；进度走下面的高频通道。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [songId, currentCoverUrl, duration, queueIndex, queueLength, unknownArtistLabel]);

    useEffect(() => {
        if (!isIosNative()) return;
        void setNativePlaybackState(playerState === 'PLAYING', currentTime.get());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playerState, songId]);

    // 进度每 4 秒回写一次：原生侧自己做外推，写太勤反而打断插值。
    useEffect(() => {
        if (!isIosNative() || playerState !== 'PLAYING') return;
        const timer = window.setInterval(() => {
            void setNativePlaybackState(true, currentTime.get());
        }, 4000);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playerState, songId]);

    useEffect(() => {
        if (!isIosNative()) return;
        return onNativeMediaEvent(event => {
            switch (event.event) {
                case 'remote-play':
                    onPlay();
                    break;
                case 'remote-pause':
                    onPause();
                    break;
                case 'remote-toggle':
                    onToggle();
                    break;
                case 'remote-next':
                    onNext();
                    break;
                case 'remote-prev':
                    onPrev();
                    break;
                case 'remote-seek': {
                    const position = Number((event.payload as { position?: number } | undefined)?.position);
                    if (Number.isFinite(position)) onSeek(position);
                    break;
                }
                case 'headphone-unplugged':
                    onHeadphoneUnplugged();
                    break;
                default:
                    break;
            }
        });
    }, [onHeadphoneUnplugged, onNext, onPause, onPlay, onPrev, onSeek, onToggle]);
};
