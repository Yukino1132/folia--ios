import { isIosNative } from '../../../ios/iosRuntime';

// src/components/visualizer/random/randomPoolNote.ts
// 随机池在手机上的那行说明：原生壳里重型的歌词样式不参与「每首随机」（见 ios/iosPerformance.ts），
// 不写出来，用的人会以为是样式丢了。桌面端返回 null，那一行不画。

export const randomPoolMobileNoteKey = (): string | null => (
    isIosNative() ? 'options.randomPoolMobileNote' : null
);
