import { useEffect } from 'react';
import { isIosNative } from './iosRuntime';
import { onNativeMediaEvent } from './mediaSessionBridge';

// src/ios/useIosHardwareBackButton.ts
// iOS 原生壳的手势与硬件事件接入：这里只处理「返回」意图（原生侧预留的返回事件、系统返回手势）

type BackIntentHandler = () => boolean | void;

const handlers: BackIntentHandler[] = [];

/** 注册一个返回拦截器；返回 true 表示这一层已经消费了返回意图。 */
export const registerIosBackIntent = (handler: BackIntentHandler): (() => void) => {
    handlers.push(handler);
    return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
    };
};

/** 从最外层往里找一个愿意消费返回意图的拦截器。 */
export const dispatchIosBackIntent = (): boolean => {
    for (let i = handlers.length - 1; i >= 0; i -= 1) {
        if (handlers[i]() === true) return true;
    }
    return false;
};

/** 监听原生壳转发的返回事件（iOS 侧用侧滑或返回按钮触发）。 */
export const useIosBackIntentBridge = (): void => {
    useEffect(() => {
        if (!isIosNative()) return;
        return onNativeMediaEvent(event => {
            if (event.event !== 'back-intent' && event.event !== 'remote-back') return;
            dispatchIosBackIntent();
        });
    }, []);
};
