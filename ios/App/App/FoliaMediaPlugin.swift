import Foundation
import Capacitor
import AVFoundation
import MediaPlayer
import UIKit

// FoliaMediaBridge：把 iOS 原生能力暴露给 WebView（window.Capacitor.Plugins.FoliaMedia）
// 职责：
//  1. 锁屏 / 控制中心 Now Playing 信息同步（标题、艺术家、专辑、封面、进度、播放状态）
//  2. 原生媒体事件（锁屏按钮、线控、耳机拔出、来电打断）回传给 JS
//  3. 后台保活：播放期间保持 AVAudioSession active
//  4. 分享 / 打开外部链接 / 剪贴板 / 触觉反馈等移动端常用能力
@objc(FoliaMediaPlugin)
public class FoliaMediaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FoliaMediaPlugin"
    public let jsName = "FoliaMedia"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setNowPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlaybackState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearNowPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deviceInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise),
    ]

    private var listening = false
    private var nowPlayingInfo: [String: Any] = [:]

    override public func load() {
        startListening()
    }

    deinit {
        if listening {
            NotificationCenter.default.removeObserver(self)
        }
    }

    // MARK: - 事件监听

    private func startListening() {
        guard !listening else { return }
        listening = true
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleMediaEvent(_:)),
            name: Notification.Name("FoliaMediaEvent"),
            object: nil
        )
    }

    @objc private func handleMediaEvent(_ note: Notification) {
        guard let userInfo = note.userInfo else { return }
        // AppDelegate 发出的通知要在主线程上回调；Capacitor 的 notifyListeners 会碰 WebView。
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in
                self?.forward(userInfo)
            }
            return
        }
        forward(userInfo)
    }

    private func forward(_ userInfo: [AnyHashable: Any]) {
        var payload: [String: Any] = [:]
        for (key, value) in userInfo where (key as? String) != "event" {
            payload[key as? String ?? "\(key)"] = value
        }
        let event = (userInfo["event"] as? String) ?? "unknown"
        notifyListeners("mediaEvent", data: [
            "event": event,
            "payload": payload
        ])
    }

    // MARK: - Now Playing

    @objc func setNowPlaying(_ call: CAPPluginCall) {
        let info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        var merged = info

        if let title = call.getString("title") { merged[MPMediaItemPropertyTitle] = title }
        if let artist = call.getString("artist") { merged[MPMediaItemPropertyArtist] = artist }
        if let album = call.getString("album") { merged[MPMediaItemPropertyAlbumTitle] = album }
        if let duration = call.getDouble("duration"), duration > 0 {
            merged[MPMediaItemPropertyPlaybackDuration] = duration
        }
        if let elapsed = call.getDouble("elapsedTime") {
            merged[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        }
        if let rate = call.getDouble("playbackRate") {
            merged[MPNowPlayingInfoPropertyPlaybackRate] = rate
        }
        if let index = call.getInt("queueIndex") {
            merged[MPNowPlayingInfoPropertyPlaybackQueueIndex] = index
        }
        if let count = call.getInt("queueCount") {
            merged[MPNowPlayingInfoPropertyPlaybackQueueCount] = count
        }

        nowPlayingInfo = merged
        MPNowPlayingInfoCenter.default().nowPlayingInfo = merged

        // 封面：base64 或远程 URL
        if let coverBase64 = call.getString("coverBase64"),
           let data = Data(base64Encoded: stripDataURLPrefix(coverBase64)),
           let image = UIImage(data: data) {
            applyArtwork(image)
        } else if let coverUrlStr = call.getString("coverUrl"), let url = URL(string: coverUrlStr) {
            URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
                guard let self = self, let data = data, let image = UIImage(data: data) else { return }
                DispatchQueue.main.async { self.applyArtwork(image) }
            }.resume()
        }

        call.resolve()
    }

    private func applyArtwork(_ image: UIImage) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func stripDataURLPrefix(_ value: String) -> String {
        if let commaIndex = value.firstIndex(of: ",") {
            return String(value[value.index(after: commaIndex)...])
        }
        return value
    }

    @objc func setPlaybackState(_ call: CAPPluginCall) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        let isPlaying = call.getBool("isPlaying") ?? false
        if let elapsed = call.getDouble("elapsedTime") {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        }
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        // 后台播放保持 session active；停止播放后允许系统回收
        do {
            let session = AVAudioSession.sharedInstance()
            if isPlaying {
                try session.setActive(true)
            } else {
                try? session.setActive(false, options: [.notifyOthersOnDeactivation])
            }
        } catch {
            NSLog("[Folia] setPlaybackState session error: \(error)")
        }
        call.resolve()
    }

    @objc func clearNowPlaying(_ call: CAPPluginCall) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        call.resolve()
    }

    // MARK: - 后台保活

    @objc func keepAwake(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? true
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
        }
        call.resolve()
    }

    // MARK: - 分享

    @objc func share(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let vc = self.bridge?.viewController else {
                call.reject("No view controller")
                return
            }
            var items: [Any] = []
            if let text = call.getString("text") { items.append(text) }
            if let urlStr = call.getString("url"), let url = URL(string: urlStr) { items.append(url) }
            if let path = call.getString("filePath"), let data = FileManager.default.contents(atPath: path) {
                let tmp = FileManager.default.temporaryDirectory.appendingPathComponent((path as NSString).lastPathComponent)
                try? data.write(to: tmp)
                items.append(tmp)
            }
            guard !items.isEmpty else {
                call.reject("Nothing to share")
                return
            }
            let activity = UIActivityViewController(activityItems: items, applicationActivities: nil)
            if let popover = activity.popoverPresentationController {
                popover.sourceView = vc.view
                popover.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.maxY, width: 0, height: 0)
            }
            vc.present(activity, animated: true) {
                call.resolve()
            }
        }
    }

    // MARK: - 外部链接

    @objc func openExternal(_ call: CAPPluginCall) {
        guard let urlStr = call.getString("url"), let url = URL(string: urlStr) else {
            call.reject("Invalid URL")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in
                ok ? call.resolve() : call.reject("Cannot open URL")
            }
        }
    }

    // MARK: - 触觉

    @objc func haptic(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "light"
        DispatchQueue.main.async {
            switch style {
            case "heavy":
                UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            case "medium":
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            case "success":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning":
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "error":
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            case "selection":
                UISelectionFeedbackGenerator().selectionChanged()
            default:
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
        }
        call.resolve()
    }

    // MARK: - 设备信息

    @objc func deviceInfo(_ call: CAPPluginCall) {
        let device = UIDevice.current
        let screen = UIScreen.main
        call.resolve([
            "model": device.model,
            "name": device.name,
            "systemVersion": device.systemVersion,
            "systemName": device.systemName,
            "idiom": device.userInterfaceIdiom == .pad ? "ipad" : "iphone",
            "screenWidth": screen.bounds.width,
            "screenHeight": screen.bounds.height,
            "scale": screen.scale,
            "safeAreaTop": bridge?.viewController?.view.safeAreaInsets.top ?? 0,
            "safeAreaBottom": bridge?.viewController?.view.safeAreaInsets.bottom ?? 0,
            "isLowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
        ])
    }
}
