import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/config';
import './index.css';
import App from './App';
import AppSplashGate from './components/AppSplashGate';
import RemoteControlApp from './components/remote/RemoteControlApp';
import ObsBrowserSourceApp from './components/obs/ObsBrowserSourceApp';
import ObsNowPlayingSourceApp from './components/obs/ObsNowPlayingSourceApp';
import ObsPlayerCapSourceApp from './components/obs/ObsPlayerCapSourceApp';
import { initializeLocalCoverRuntime } from './services/localCoverRuntime';
import { installFoliumHomePageDismissal } from './components/app/home/foliumHomePageDismissal';
import { installLibrarySuiteChromeCommands } from './library/app/installLibrarySuiteChromeCommands';
import { noteFoliumFirstScreenMounted, startFoliumForMainWindow } from './mods/runtime/mainWindowStart';
import { installNativeDragGuard } from './utils/nativeDragGuard';
import { prewarmSavedVisualizer, prewarmVisualizersWhenIdle } from './components/visualizer/prewarmVisualizers';
import { bootNavidromeServerPreset } from './services/navidromeServerPreset';
import { isNavidromeEnabled } from './services/navidromeService';
import { setNavidromeEnabledState } from './stores/useLibraryStore';
import { isMainAppSurface, isObsBrowserSourceSurface, isRemoteControlSurface, obsSourceKind } from './utils/appSurface';
import { bootstrapIosRuntime, isIosNative } from './ios/iosRuntime';
import { installIosMobileChrome } from './ios/installIosMobileChrome';
import { installNativeHttp } from './ios/installNativeHttp';
import { useIosKeyboardInset, useIosSafeAreaMetrics } from './ios/useIosSafeAreaMetrics';
import { installMobileWebChrome } from './mobile/installMobileWebChrome';
// 副作用 import：store 在模块加载时就把 `<html data-reduce-motion>` 写好并保持同步。放在 bootstrap
// 而不是 App 里，是因为下面按 URL 挂的根不是 App —— 远程控制窗口的进度光效也读这个属性。
import './stores/useMotionSettingsStore';

// src/bootstrap.tsx
// Mounts the React app after index.tsx installs runtime-level browser shims.

// A mod visualizer or background saved to localStorage can only survive a
// restart if its registry entry exists before the settings store validates the
// stored mode. The store initializes eagerly through the static import graph,
// so the mode it read may already have fallen back to a builtin; after mod
// clients register their entries we restore the saved selections
// (src/mods/runtime/missingEntries.ts, which also re-runs on every mod reload).
//
// So the first screen waits for the mods' clients, but not for long: all of
// them together get FIRST_SCREEN_MOD_WAIT_MS. A mod that is not up by then
// keeps starting behind the first screen, and its saved style or background
// comes back when it is (src/mods/runtime/mainWindowStart.ts). The cap is here
// and nowhere else: the export window waits for its mods in full.
const FIRST_SCREEN_MOD_WAIT_MS = 1500;

// #394: with a selection on the page, native drag-and-drop would hijack slider gestures. Installed
// here, for every surface this bundle mounts, rather than inside App so the remote-control and OBS
// roots are covered too and App.tsx does not grow. See utils/nativeDragGuard.ts.
if (isIosNative()) {
    // iOS 壳：写入安全区变量、接管刘海/Home Indicator、开启移动端布局与手势；原生插件在启动后异步回报设备信息。
    void bootstrapIosRuntime();
    installIosMobileChrome();
    // 第三方接口不给跨域头，WKWebView 的 fetch 会被 CORS 拦掉；跨域请求改走原生 HTTP。
    installNativeHttp();
} else {
    // 手机浏览器：触控样式层、真实可视高度、输入法避让。桌面浏览器在这里什么都不做。
    installMobileWebChrome();
}

installNativeDragGuard();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const isObsBrowserSource = isObsBrowserSourceSurface;
// obsSource=now-playing / playercap: static OBS overlay that connects directly to NowPlaying / PlayerCap in the browser (no Electron SSE relay).
const isNowPlayingObsSource = isObsBrowserSource && obsSourceKind === 'now-playing';
const isPlayerCapObsSource = isObsBrowserSource && obsSourceKind === 'playercap';
const isRemoteControl = isRemoteControlSurface;
// Mod clients belong to the main app window only. The remote-control window
// also has the Electron bridge, but mod state pushes only reach the main
// window, so a client activated there would never be torn down.
const isMainApp = isMainAppSurface;

// Its effect runs after the effects of everything inside it in the same commit, so by then every
// mod `mount` of the first screen has returned: the moment the mods' start counts as over.
const FirstScreenMounted: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    React.useEffect(() => {
        noteFoliumFirstScreenMounted();
        prewarmVisualizersWhenIdle();
    }, []);
    // 安全区与键盘高度在每次方向变化、输入法弹出时重算，样式层只读 CSS 变量。
    useIosSafeAreaMetrics();
    useIosKeyboardInset();
    return <>{children}</>;
};

const renderApp = () => root.render(
    <React.StrictMode>
      <AppSplashGate>
        {isNowPlayingObsSource
          ? <ObsNowPlayingSourceApp />
          : isPlayerCapObsSource
            ? <ObsPlayerCapSourceApp />
            : isObsBrowserSource
              ? <ObsBrowserSourceApp />
              : isRemoteControl
                ? <RemoteControlApp />
                : <FirstScreenMounted><App /></FirstScreenMounted>}
      </AppSplashGate>
    </React.StrictMode>
  );

// Library suites declare their chrome actions in their manifests; the palette cannot import the
// registry, so the commands are put into its list here, before anything renders (main window only,
// like the mod commands below). A clashing execute shortcut throws here, at startup.
if (isMainApp) installLibrarySuiteChromeCommands();

// 不等待它，和下面的 mod 加载一起跑；别的启动慢的样式等首屏出来、页面空闲时再准备（FirstScreenMounted）。
if (isMainApp) prewarmSavedVisualizer();
const bootFolium = async () => {
    if (!isMainApp) return;
    // 显式打开集合时关掉开着的模组首页；与 Home 挂没挂着无关，所以在这里剥（见 foliumHomePageDismissal）。
    installFoliumHomePageDismissal();
};

// Docker 预置的 Navidrome 凭据要在渲染前落进 localStorage（原因见 services/navidromeServerPreset.ts）。
const bootNavidrome = async () => {
    if (!isMainApp) return;
    const result = await bootNavidromeServerPreset();
    // useLibraryStore 在模块加载时就读过开关，这里补一次同步。
    if (result === 'applied') setNavidromeEnabledState(isNavidromeEnabled());
};

// allSettled：mod 加载失败也要等预置写完再渲染，失败原因单独打出来，不吞掉。
void Promise.allSettled([bootFolium(), bootNavidrome()])
    .then(([folium, navidrome]) => {
        if (folium.status === 'rejected') console.error('[Bootstrap] Folium boot failed:', folium.reason);
        if (navidrome.status === 'rejected') console.warn('[Navidrome] Server preset boot failed:', navidrome.reason);
    })
    .finally(() => {
        initializeLocalCoverRuntime();
        renderApp();
    });
