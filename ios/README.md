# Folia iOS 版（IPA）

把 https://github.com/chthollyphile/folia-major 的 Web 前端原样搬进 Capacitor 壳，功能集与原版一致：
首页 / 播放页 / 歌词墙（lattice）、全部 9 个在线音乐平台、本地音乐库、Navidrome、AI 主题、
模组（folium）、刮擦垫、可视化器 24 套样式……界面代码一行未删，手机端只多了布局与系统集成适配。

- Bundle ID：`top.izuna.foliamajor.ios`
- 显示名：Folia
- 最低系统：iOS 15.0（Web 产物用 ES2022，WKWebView 从 iOS 15 起才完整支持）
- 版本号：跟随上游 `package.json`（当前 0.7.28）

## 一次性准备

在 macOS 上（出 IPA 必须有 Xcode）：

```bash
node -v            # 需要 >= 22
npm ci
cd ios/App && pod install && cd -   # 没有 pod 就先 sudo gem install cocoapods
```

## 构建

```bash
# 1. 出 Web 产物（相对路径 + 关掉 service worker）并同步进 ios/App/App/public
npm run build:ios

# 2. Xcode 打开工程，选自己的 Team 签名，真机运行或 Archive
npm run ios:open
```

`build:ios` 做三件事：`CAPACITOR_BUILD=true vite build`（`base: './'`、`VitePWA.disable`）→
`scripts/ios/patch-runtime-config.mjs` 写后端地址 → `scripts/ios/sync-web-assets.mjs` 把 `dist`
清空复制到 `ios/App/App/public`。Windows 上也能跑前两步，只是没法 Archive。

### 在线音乐后端地址

网易云 / 酷狗 / QQ 的接口都走自建中转（上游 .env 里的 `VITE_*_API_BASE`）。原生壳没有构建期环境变量，
改成打包时写进 `runtime-config.js`：

```bash
FOLIA_NETEASE_API_BASE=https://你的网易云中转 \
FOLIA_LYRIC_PROXY_BASE=https://你的歌词中转 \
npm run build:ios
```

四项都留空也能用：应用内「设置 → 在线音乐」仍可手动填后端地址，本地音乐库与 Nadivrome 不依赖它。

### 出未签名 IPA

```bash
node scripts/ios/build-ipa.mjs          # → build/ios/Folia.ipa（未签名）
node scripts/ios/build-ipa.mjs --skip-build   # 复用上次 archive
```

脚本会 `xcodebuild archive`（`CODE_SIGNING_ALLOWED=NO`），再把 `App.app` 压成
`Payload/App.app` 的 zip。拿到的 IPA 用你惯用的自签工具（TrollStore / AltStore / Sideloadly）注入证书即可。

想直接出带证书的包：`FORCE_SIGN=1 DEVELOPMENT_TEAM=XXXXXXXXXX npm run build:ios && node scripts/ios/build-ipa.mjs`。

## 手机端适配（改了哪些）

| 文件 | 作用 |
| --- | --- |
| `src/ios/iosRuntime.ts` | 判定原生壳、读设备信息、把安全区写进 CSS 变量 |
| `src/ios/installIosMobileChrome.ts` | viewport 锁定、禁双击缩放与长按菜单、输入框防自动放大、键盘 inset、音频首次手势解锁 |
| `src/ios/useIosSafeAreaMetrics.ts` | `--folia-safe-top` / `--folia-safe-bottom` / `--folia-keyboard-inset` |
| `src/ios/useIosSafeAreaInsetBottom.ts` | 底部安全区数值（脱离 AppShell 的 fixed 层用；底栏已在 AppShell 盒子里，不叠加） |
| `src/ios/fetchIosNetwork.ts` | 原生 HTTP：把 CapacitorHttp 包成 fetch 签名，绕开 WKWebView 的 CORS 限制 |
| `src/ios/installNativeHttp.ts` | 全局替换 `window.fetch`：跨域走原生、同源与包内资源走 WebView |
| `src/ios/useIosNowPlayingBridge.ts` | 锁屏 / 控制中心 Now Playing 同步，锁屏按钮回传给播放器 |
| `src/ios/useIosHardwareBackButton.ts` | 原生返回事件的分发栈 |
| `src/ios/useIosNavigationBackIntent.ts` | 返回顺序：命令面板 → 搜索 → 面板 → 歌词墙 → 播放页 |
| `src/ios/mediaSessionBridge.ts` | Media Session / 分享 / 打开外链 / 触觉的 JS 侧封装 |
| `ios/App/App/AppDelegate.swift` | AVAudioSession playback、Remote Command Center、打断与拔耳机事件 |
| `ios/App/App/FoliaMediaPlugin.swift` | 原生插件：Now Playing、保持亮屏、分享、外链、触觉、设备信息 |
| `ios/App/App/FoliaBridgeViewController.swift` | 注册插件、WebView 底色与 `contentInsetAdjustmentBehavior = .never` |
| `src/hooks/useBottomLayoutTracking.ts` | 原生壳固定走 compact 底部档（胶囊态），不再按 960px 断点判断 |
| `src/components/app/AppShell.tsx` | 跳过 Electron 标题栏/圆角，根节点让开安全区 |

## 已知差异（相对桌面版）

- 桌面专属能力在手机上不存在，对应 UI 会自行降级：窗口透明/壁纸穿透、MPRIS、任务栏媒体控制、
  系统托盘、全局快捷键、本地音频缓存目录选择、`folia_mnn.dll` 的 MNN 音频分析后端。
- 在线音乐后端需要你自己部署（上游同样要求）；不填只影响在线曲库。
- 第三方接口（网易云 / QQ / 酷狗 / 各图片与音频 CDN）在 WKWebView 里会被 CORS 拦掉，原生壳统一改走
  CapacitorHttp 的原生请求（`CapacitorHttp.enabled = true`）；登录用的 Cookie 由原生 HTTP 层按域缓存并同步回 WebView。
- Service Worker 在原生壳里关闭：资源都在包内，留着只会命中旧缓存。

## 授权

上游为 AGPL-3.0，本衍生版本沿用同一许可。分发时请保留上游版权声明与仓库链接。

<!-- 构建触发时间：2026-11-13T23:01:50.347Z -->
