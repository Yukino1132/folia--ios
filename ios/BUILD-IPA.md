# Folia iOS 打包说明（在这里续做）

这个目录是从上游 folia-major 派生出来的 iOS 版工程，Web 层已经全部改好并构建过；
**唯一剩下的步骤是在 macOS 上出 IPA**（Windows 下没有 xcodebuild，无法签名或 Archive）。

## 一、把整个仓库拷到 macOS

```bash
# 需要 Node >= 22、Xcode 15+、CocoaPods
cd folia-major-main
npm ci --no-audit --no-fund --ignore-scripts
```

## 二、构建 Web 产物并同步进 Xcode 工程

```bash
# 可选：把在线音乐后端地址写进去（不填也能跑，应用内也能手动填）
export FOLIA_NETEASE_API_BASE=https://你的网易云中转
export FOLIA_KUGOU_API_BASE=https://你的酷狗中转
export FOLIA_QQ_API_BASE=https://你的QQ中转
export FOLIA_LYRIC_PROXY_BASE=https://你的歌词中转

npm run build:ios     # → dist/ 并用相对路径构建（service worker 关闭），同步到 ios/App/App/public
cd ios/App && pod install && cd -
```

`ios/App/App/public` 里现在已经是 Windows 侧构建出来的产物（1897 个文件 / 约 22MB），
在 macOS 上重跑 `npm run build:ios` 会覆盖成同源同版本的新产物，建议重跑一次以免 Node 版本差异。

## 三、出未签名 IPA（推荐，自己签名）

```bash
node scripts/ios/build-ipa.mjs
# 产物：build/ios/Folia.ipa（未签名）
# 复用上次 archive：node scripts/ios/build-ipa.mjs --skip-build
```

脚本做的事：`xcodebuild archive`（`CODE_SIGNING_ALLOWED=NO`）→ 取 `App.app` → 打成
`Payload/App.app` 的 zip 并改名为 `.ipa`。拿到后用 TrollStore / AltStore / Sideloadly /
爱思助手等注入你自己的证书即可安装。

## 四、或者直接带证书出 IPA

```bash
FORCE_SIGN=1 DEVELOPMENT_TEAM=你的TeamID npm run build:ios
node scripts/ios/build-ipa.mjs
```

也可以用 Xcode 手动：`npm run ios:open` 打开 `App.xcworkspace`，选 Team，
`Product → Archive`，Distribute App → Development 导出。

## 五、验证清单（装到真机后逐条走）

1. 首屏：深色启动图（#09090b），无白闪；顶部状态栏与底部 Home Indicator 不压内容。
2. 首页 / 播放页 / 歌词墙三视图切换正常，底部胶囊（compact 档）贴在安全区上方。
3. 选歌播放；锁屏和控制中心显示封面、标题、进度，锁屏按钮能播放/暂停/切歌/拖进度。
4. 拔耳机自动暂停。
5. 从播放页右滑（或原生返回）能退到首页；命令面板、搜索、面板按层级依次关闭。
6. 在线音乐：搜索/歌词/歌单（需自建后端地址）。原生壳里这些请求走 CapacitorHttp，不受 CORS 限制。
7. 本地音乐：文件导入（Info.plist 已开 UIFileSharingEnabled，可从「文件」App 拖入）。
8. 后台播放：切到其他 App 或锁屏后音乐继续（UIBackgroundModes=audio）。

## 六、改配置的位置

| 想改什么 | 改哪里 |
| --- | --- |
| Bundle ID / 显示名 | `capacitor.config.json` 的 `appId` / `appName`，以及 `ios/App/App.xcodeproj` 的 `PRODUCT_BUNDLE_IDENTIFIER` |
| 最低系统版本 | `ios/App/Podfile` 的 `platform :ios, '15.0'` + pbxproj 的 `IPHONEOS_DEPLOYMENT_TARGET` |
| 版本号 | `package.json` 的 `version` + pbxproj 的 `MARKETING_VERSION` |
| 后端地址 | 构建时环境变量，或运行时 `dist/runtime-config.js` 的 `iosOverrides` |
| 权限文案 | `ios/App/App/Info.plist` |

更详细的功能说明与差异见 [README.md](./README.md)。
