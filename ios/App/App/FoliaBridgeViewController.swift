import UIKit
import Capacitor

// Folia 的 CAPBridgeViewController 子类
// - 把自定义插件 FoliaMediaPlugin 注册进 Capacitor 桥（autoRegisterPlugins 打开时
//   registerPluginType 会被忽略，只有子类创建时能赶上桥的初始化；
//   见 CapacitorBridge.swift:337 registerPluginType 的 autoRegisterPlugins 早退）
// - 让 WebView 背景跟随主题，避免首帧闪白
// storyboard 里的 RootViewController 用的就是这个类（Main.storyboard 的 customClass）。

class FoliaBridgeViewController: CAPBridgeViewController {

    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginType(FoliaMediaPlugin.self)
    }

    override open func viewDidLoad() {
        super.viewDidLoad()
        if let webView = self.webView {
            webView.backgroundColor = UIColor(red: 0.035, green: 0.035, blue: 0.043, alpha: 1.0)
            webView.isOpaque = false
            webView.scrollView.backgroundColor = webView.backgroundColor
            // 页面自己处理安全区与滚动，WKWebView 不要再自作主张加 inset（否则上下各多一条）。
            webView.scrollView.contentInsetAdjustmentBehavior = .never
            webView.scrollView.bounces = false
        }
    }
}
