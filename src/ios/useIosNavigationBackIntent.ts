import { useEffect } from 'react';
import { isIosNative } from './iosRuntime';
import { registerIosBackIntent } from './useIosHardwareBackButton';

// src/ios/useIosNavigationBackIntent.ts
// iOS 原生壳的返回意图按「浮层 → 页面」的顺序逐层消费：先关最上层的东西，都没有才退回上一页。

type IosNavigationBackIntentOptions = {
    isCommandPaletteOpen: boolean;
    closeCommandPalette: () => void;
    isSearchOpen: boolean;
    closeSearch: () => void;
    isPanelOpen: boolean;
    closePanel: () => void;
    currentView: 'home' | 'player' | 'lattice';
    backFromLattice: () => void;
    backFromPlayer: () => void;
};

/** 把 iOS 返回手势接成和桌面端 Esc / 返回按钮一致的行为（原生壳之外是空实现）。 */
export const useIosNavigationBackIntent = ({
    isCommandPaletteOpen,
    closeCommandPalette,
    isSearchOpen,
    closeSearch,
    isPanelOpen,
    closePanel,
    currentView,
    backFromLattice,
    backFromPlayer,
}: IosNavigationBackIntentOptions): void => {
    useEffect(() => {
        if (!isIosNative()) return;

        return registerIosBackIntent(() => {
            if (isCommandPaletteOpen) {
                closeCommandPalette();
                return true;
            }
            if (isSearchOpen) {
                closeSearch();
                return true;
            }
            if (isPanelOpen) {
                closePanel();
                return true;
            }
            if (currentView === 'lattice') {
                backFromLattice();
                return true;
            }
            if (currentView === 'player') {
                backFromPlayer();
                return true;
            }
            // 首页没有可退的地方，交给系统（原生侧据此决定是否让手势回弹）。
            return false;
        });
    }, [
        backFromLattice,
        backFromPlayer,
        closeCommandPalette,
        closePanel,
        closeSearch,
        currentView,
        isCommandPaletteOpen,
        isPanelOpen,
        isSearchOpen,
    ]);
};
