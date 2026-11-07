import AppKit
import ApplicationServices
import Foundation
import ScreenCaptureKit

enum Wire {
    private static let lock = NSLock()

    static func send(_ message: [String: Any]) {
        if let bytes = try? JSONSerialization.data(withJSONObject: message) { send(1, bytes) }
    }

    static func send(_ kind: UInt8, _ bytes: Data) {
        var size = UInt32(bytes.count).bigEndian
        var packet = Data([kind])
        withUnsafeBytes(of: &size) { packet.append(contentsOf: $0) }
        packet.append(bytes)
        lock.lock()
        defer { lock.unlock() }
        try? FileHandle.standardOutput.write(contentsOf: packet)
    }
}

@MainActor
final class Session {
    private let app: MacApp
    private var target: NSRunningApplication?
    private var selection: CGWindowID?
    private var selectedSize: CGSize?
    private var starting = false
    private var capture: WindowCapture?
    private var input: WindowInput?
    private var listing = Data()
    private var lastActivity = ContinuousClock.now
    private var ended = false

    init(_ app: MacApp) {
        self.app = app
    }

    nonisolated static var isUnlocked: Bool {
        guard let state = CGSessionCopyCurrentDictionary() as? [String: Any],
              state["kCGSSessionOnConsoleKey"] as? Bool == true,
              state["kCGSessionLoginDoneKey"] as? Bool != false else { return false }
        return state["CGSSessionScreenIsLocked"] as? Bool != true
    }

    func run() async {
        guard Self.isUnlocked else {
            Wire.send(["type": "error", "message": "请先在 Mac 本机解锁"])
            return
        }
        guard CGPreflightScreenCaptureAccess(), AXIsProcessTrusted() else {
            Wire.send(["type": "error", "message": "请在 Mac 设置中授予屏幕录制和辅助功能权限"])
            return
        }
        Wire.send(["type": "waiting"])
        do {
            target = try await open()
            guard app.matches(target) else { throw SessionError.application }
            _ = target?.activate()
            try await refresh()
        } catch {
            Wire.send(["type": "error", "message": "无法启动应用或读取其窗口"])
            return
        }

        let commands = Task {
            do {
                for try await line in FileHandle.standardInput.bytes.lines {
                    if let message = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] {
                        await handle(message)
                    }
                    if ended { break }
                }
            } catch {}
            ended = true
        }
        let deadline = ContinuousClock.now.advanced(by: .seconds(25))
        while !ended && !Task.isCancelled {
            do {
                try await Task.sleep(for: .milliseconds(500))
                guard !ended else { break }
                try await refresh()
                if selection == nil && listing == Data("[]".utf8) && ContinuousClock.now > deadline {
                    await fail("应用没有可共享的窗口，请在 Mac 上打开窗口后重试")
                }
            } catch {
                await fail("Mac 窗口已不可用，请检查屏幕录制权限")
            }
        }
        commands.cancel()
        input?.release()
        await capture?.stop()
    }

    private func open() async throws -> NSRunningApplication {
        if let running = NSRunningApplication.runningApplications(withBundleIdentifier: app.bundleID)
            .first(where: app.matches), !running.isTerminated {
            return running
        }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        return try await NSWorkspace.shared.openApplication(at: app.url, configuration: config)
    }

    private func availableWindows() async throws -> [SCWindow] {
        guard let target, !target.isTerminated, app.matches(target) else { throw SessionError.application }
        let shareable = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        return shareable.windows.filter {
            $0.owningApplication?.processID == target.processIdentifier
                && $0.windowLayer == 0 && $0.isOnScreen
                && $0.frame.width >= 40 && $0.frame.height >= 40
        }
    }

    private func refresh() async throws {
        guard Self.isUnlocked else {
            await fail("Mac 已锁屏，请在主机解锁后重连")
            return
        }
        let windows = try await availableWindows()
        let descriptions: [[String: Any]] = windows.enumerated().map { index, item in
            let title = item.title.flatMap { $0.isEmpty ? nil : $0 } ?? "窗口 \(index + 1)"
            return ["id": item.windowID, "title": String(title.prefix(160))]
        }
        let snapshot = try JSONSerialization.data(withJSONObject: descriptions, options: .sortedKeys)
        if snapshot != listing {
            listing = snapshot
            Wire.send(["type": "windows", "windows": descriptions])
        }
        if let selection, let selectedSize, !starting, capture != nil,
           !windows.contains(where: {
               $0.windowID == selection && abs($0.frame.width - selectedSize.width) <= 2
                   && abs($0.frame.height - selectedSize.height) <= 2
           }) {
            input?.release()
            input = nil
            let previous = capture
            capture = nil
            await previous?.stop()
            Wire.send(["type": "paused", "message": "窗口已关闭、最小化或尺寸已变化，请重新选择窗口"])
        } else if NSWorkspace.shared.frontmostApplication?.processIdentifier != target?.processIdentifier {
            input?.release()
        }
    }

    private func handle(_ message: [String: Any]) async {
        switch message["type"] as? String {
        case "select":
            guard !ended, Self.isUnlocked, selection == nil, let id = message["window"] as? UInt32,
                  let target, let windows = try? await availableWindows(),
                  let window = windows.first(where: { $0.windowID == id }) else {
                await fail("所选窗口已不可用")
                return
            }
            selection = id
            selectedSize = window.frame.size
            starting = true
            defer { starting = false }
            let nextInput = WindowInput(app: app, pid: target.processIdentifier, window: id, size: window.frame.size)
            _ = target.activate()
            nextInput.raise(window.frame)
            input = nextInput
            let next = WindowCapture { [weak self] in
                Task { @MainActor in await self?.fail("窗口采集已停止，请重连") }
            }
            capture = next
            do {
                try await next.start(window)
            } catch {
                await fail("无法启动窗口采集或硬件编码")
            }
        case "keyframe":
            capture?.keyframe()
        case "input":
            guard !ended, let event = message["event"] as? [String: Any],
                  input?.handle(event) == true, ContinuousClock.now - lastActivity >= .seconds(1) else { return }
            lastActivity = .now
            Wire.send(["type": "activity"])
        default:
            break
        }
    }

    private func fail(_ message: String) async {
        guard !ended else { return }
        ended = true
        input?.release()
        Wire.send(["type": "error", "message": message])
    }

    private enum SessionError: Error { case application }
}

@main
enum RemoteAppCapture {
    static func main() async {
        let args = CommandLine.arguments
        if args.count == 1 {
            _ = CGRequestScreenCaptureAccess()
            let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        } else if args.count == 2, args[1] == "catalog" {
            guard let data = try? JSONSerialization.data(withJSONObject: MacApp.installed().map(\.descriptor)) else { exit(1) }
            FileHandle.standardOutput.write(data + Data([10]))
        } else if args.count == 3, args[1] == "status", NativeChannel.attach(to: args[2]) {
            let status = [
                "unlocked": Session.isUnlocked,
                "screen_capture": CGPreflightScreenCaptureAccess(),
                "accessibility": AXIsProcessTrusted(),
            ]
            if let data = try? JSONSerialization.data(withJSONObject: status, options: .sortedKeys) {
                FileHandle.standardOutput.write(data + Data([10]))
            }
        } else if args.count == 4, args[1] == "session", NativeChannel.attach(to: args[3]),
                  let app = MacApp.installed().first(where: { $0.id == args[2] }) {
            await Session(app).run()
        } else {
            exit(1)
        }
    }
}
