import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { BUILTIN_VISUALIZER_MODES } from '../../../types/visualizerModes';
import type { VisualizerMode } from '../../../types';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { pickRandomVisualizerMode } from '../../../utils/randomVisualizerModes';
import { getVisualizerModeLabel, VISUALIZER_REGISTRY } from '../registry';
import { isHeavyVisualizerOnMobile } from '../../../ios/iosPerformance';

// src/components/visualizer/random/useRandomPool.ts
// The random pool as its two pickers show it (the lyric style window's page and the player panel's
// layer): the built-in styles in the shelf's order, which of them are on, and what a press does.
// Also the panel's other chip: drawing another style from the pool for the song that is playing.

const BUILTIN_MODES = new Set<string>(BUILTIN_VISUALIZER_MODES);

export const useRandomPool = () => {
    const { t } = useTranslation();
    const { modes, mode, setModes, setMode } = useVisualizerSettingsStore(useShallow(state => ({
        modes: state.randomVisualizerModes,
        mode: state.visualizerMode,
        setModes: state.handleSetRandomVisualizerModes,
        setMode: state.handleSetVisualizerMode,
    })));
    // 手机上从池子里去掉 3D 场景与重着色器那几档（见 ios/iosPerformance.ts）：每首换一次，
    // 换歌时重新编译着色器再铺满屏，iPhone 扛不住。桌面端 options 与之前逐字一致。
    const options = useMemo(() => (
        VISUALIZER_REGISTRY
            .filter(entry => BUILTIN_MODES.has(entry.mode) && !isHeavyVisualizerOnMobile(entry.mode))
            .map(entry => ({ value: entry.mode, label: getVisualizerModeLabel(entry.mode, t) }))
    ), [t]);
    // 「全选」在手机上只选剩下的那些，计数也跟着走同一个池子。
    const poolModes = useMemo<readonly VisualizerMode[]>(
        () => options.map(option => option.value as VisualizerMode),
        [options],
    );
    const allOn = modes.length === poolModes.length;

    return {
        options,
        modes: modes as readonly VisualizerMode[],
        setModes: (next: readonly VisualizerMode[]) => setModes(next),
        allOn,
        /**
         * Every built-in style. The 全选 button turns disabled under the press, and focus on a disabled
         * button drops to the page, which closes the panel's layer (Popover): the focus goes to the
         * grid's tab stop first, when the grid is given.
         */
        selectAll: (grid?: HTMLElement | null) => {
            grid?.querySelector<HTMLElement>('[data-value][tabindex="0"]')?.focus();
            setModes(poolModes);
        },
        /** 「已选 5/14」 */
        countLabel: t('options.randomPoolCount', { selected: modes.length, total: poolModes.length }),
        /** The style this song drew. */
        currentLabel: getVisualizerModeLabel(mode, t),
        /** Said when the last style that is on is pressed: the pool keeps one at least. */
        refuse: () => setStatusMessage({ type: 'info', text: t('options.randomVisualizerAtLeastOne') }),
        /** The pool holds a style other than this song's. */
        canReroll: modes.some(entry => entry !== mode),
        /** Another style from the pool for this song, never the one it has; random stays on. */
        reroll: () => {
            const next = pickRandomVisualizerMode(modes, mode);
            if (next !== mode) setMode(next, { notify: false, preserveRandom: true });
        },
    };
};
