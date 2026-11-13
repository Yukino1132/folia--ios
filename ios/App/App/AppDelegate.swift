import UIKit
import Capacitor
import AVFoundation

// Folia iOS 宿主 AppDelegate
// - 配置 AVAudioSession 为 Playback，支持锁屏/后台播放与混音
// - 注册 Remote Command Center（锁屏控制中心上一首/下一首/播放/暂停）
// - 把系统媒体事件通过 NotificationCenter 投递给 WebView 中的 FoliaMediaBridge
// - 在没有原生编译宏的 Capacitor 7 里，插件注册靠下面的 `@objc` 类名 + registerPlugin。
//   这里直接 registerPlugin(FoliaMediaPlugin.self)，省掉 CAPBridgeViewController 子类与 storyboard 改动。

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureAudioSession()
        configureRemoteCommands()
        return true
    }

    // MARK: - 音频会话

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.allowAirPlay, .allowBluetooth, .mixWithOthers])
            try session.setActive(true)
        } catch {
            NSLog("[Folia] AVAudioSession configure failed: \(error)")
        }
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance()
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRouteChange(_:)),
            name: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    @objc private func handleAudioInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        switch type {
        case .began:
            postMediaEvent("interruption-begin")
        case .ended:
            let optionsValue = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let shouldResume = AVAudioSession.InterruptionOptions(rawValue: optionsValue).contains(.shouldResume)
            postMediaEvent("interruption-end", extra: ["shouldResume": shouldResume])
        @unknown default:
            break
        }
    }

    @objc private func handleRouteChange(_ note: Notification) {
        guard let info = note.userInfo,
              let reasonValue = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else { return }
        // 耳机拔出 → 暂停，与系统音乐行为一致
        if reason == .oldDeviceUnavailable {
            postMediaEvent("headphone-unplugged")
        }
    }

    // MARK: - 锁屏 / 控制中心

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true
        center.skipForwardCommand.isEnabled = false
        center.skipBackwardCommand.isEnabled = false

        center.playCommand.addTarget { _ in
            self.postMediaEvent("remote-play"); return .success
        }
        center.pauseCommand.addTarget { _ in
            self.postMediaEvent("remote-pause"); return .success
        }
        center.togglePlayPauseCommand.addTarget { _ in
            self.postMediaEvent("remote-toggle"); return .success
        }
        center.nextTrackCommand.addTarget { _ in
            self.postMediaEvent("remote-next"); return .success
        }
        center.previousTrackCommand.addTarget { _ in
            self.postMediaEvent("remote-prev"); return .success
        }
        center.changePlaybackPositionCommand.addTarget { event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.postMediaEvent("remote-seek", extra: ["position": e.positionTime])
            return .success
        }
    }

    /// 通过 NotificationCenter 把原生媒体事件广播给 Capacitor 插件层
    private func postMediaEvent(_ name: String, extra: [String: Any] = [:]) {
        var payload = extra
        payload["event"] = name
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: Notification.Name("FoliaMediaEvent"), object: nil, userInfo: payload)
        }
    }

    // MARK: - 生命周期

    func applicationDidEnterBackground(_ application: UIApplication) {
        postMediaEvent("background")
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        postMediaEvent("foreground")
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        try? AVAudioSession.sharedInstance().setActive(true)
        postMediaEvent("active")
    }

    func applicationWillTerminate(_ application: UIApplication) {
        postMediaEvent("terminate")
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
