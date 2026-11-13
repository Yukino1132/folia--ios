// public/runtime-config.js
// 运行时配置：非 Docker Web 部署留空，具体值继续由 Vite 环境变量提供。
// iOS / Android 原生壳没有构建期环境变量，平台后端地址在这里注入（打包时由
// scripts/ios/patch-runtime-config.mjs 覆盖成带 iosOverrides 的版本）。
window.__FOLIA_RUNTIME_CONFIG__ = window.__FOLIA_RUNTIME_CONFIG__ || {};

(function patchNativeRuntimeConfig() {
    var capacitor = window.Capacitor;
    var isNative = Boolean(capacitor && typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform());
    if (!isNative) return;

    var runtime = window.__FOLIA_RUNTIME_CONFIG__;
    var platform = typeof capacitor.getPlatform === 'function' ? capacitor.getPlatform() : 'ios';
    if (platform === 'ios' || platform === 'android') {
        runtime.platform = platform;
    }

    // 打包脚本写进来的地址优先；没有的话沿用这里的空值，界面内仍可手动配置后端。
    var overrides = runtime.iosOverrides || {
        neteaseApiBase: '',
        kugouApiBase: '',
        qqApiBase: '',
        lyricProxyBase: ''
    };
    Object.keys(overrides).forEach(function (key) {
        if (overrides[key]) runtime[key] = overrides[key];
    });
})();
