import AppKit
import ApplicationServices

@MainActor
final class WindowInput {
    private let app: MacApp
    private let pid: pid_t
    private let window: CGWindowID
    private let size: CGSize
    private var keys: Set<CGKeyCode> = []
    private var button: CGMouseButton?
    private var location: CGPoint = .zero
    private var lastBounds: CGRect?
    private var eventNumber = 0

    init(app: MacApp, pid: pid_t, window: CGWindowID, size: CGSize) {
        self.app = app
        self.pid = pid
        self.window = window
        self.size = size
    }

    private static func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, key as CFString, &result) == .success else { return nil }
        return result
    }

    private static func element(_ parent: AXUIElement, _ key: String) -> AXUIElement? {
        guard let value = attribute(parent, key), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return value as! AXUIElement?
    }

    private static func bounds(_ element: AXUIElement) -> CGRect? {
        guard let point = attribute(element, kAXPositionAttribute),
              let size = attribute(element, kAXSizeAttribute),
              CFGetTypeID(point) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var origin = CGPoint.zero
        var dimensions = CGSize.zero
        guard AXValueGetValue(point as! AXValue, .cgPoint, &origin),
              AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { return nil }
        return CGRect(origin: origin, size: dimensions)
    }

    @MainActor
    struct Windows {
        let focused: AXUIElement?
        private let entries: [(element: AXUIElement, bounds: CGRect)]

        init(pid: pid_t) {
            let target = AXUIElementCreateApplication(pid)
            AXUIElementSetMessagingTimeout(target, 0.12)
            focused = WindowInput.element(target, kAXFocusedWindowAttribute)
            let windows = WindowInput.attribute(target, kAXWindowsAttribute) as? [AXUIElement] ?? []
            entries = windows.compactMap { window in
                WindowInput.bounds(window).map { (window, $0) }
            }
        }

        func matching(_ bounds: CGRect) -> AXUIElement? {
            // AX exposes geometry for windows but no public CGWindowID attribute.
            let matches = entries.filter {
                abs($0.bounds.minX - bounds.minX) <= 2 && abs($0.bounds.minY - bounds.minY) <= 2
                    && abs($0.bounds.width - bounds.width) <= 2 && abs($0.bounds.height - bounds.height) <= 2
            }
            return matches.count == 1 ? matches[0].element : nil
        }

        func title(_ window: AXUIElement) -> String? {
            WindowInput.attribute(window, kAXTitleAttribute) as? String
        }
    }

    var hasFocus: Bool { focusedWindow() != nil }

    private func focusedWindow() -> (bounds: CGRect, element: AXUIElement)? {
        guard Session.isUnlocked, AXIsProcessTrusted(),
              app.matches(NSRunningApplication(processIdentifier: pid)),
              NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
              let info = (CGWindowListCopyWindowInfo(.optionIncludingWindow, window) as? [[String: Any]])?.first,
              info[kCGWindowOwnerPID as String] as? pid_t == pid,
              info[kCGWindowIsOnscreen as String] as? Bool == true,
              let raw = info[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: raw as CFDictionary),
              !rect.isEmpty,
              abs(rect.width - size.width) <= 2, abs(rect.height - size.height) <= 2 else { return nil }
        let windows = Windows(pid: pid)
        guard let focused = windows.focused,
              let match = windows.matching(rect), CFEqual(match, focused) else { return nil }
        return (rect, focused)
    }

    func raise(_ bounds: CGRect) {
        if let match = Windows(pid: pid).matching(bounds) {
            AXUIElementPerformAction(match, kAXRaiseAction as CFString)
        }
    }

    private func hitTarget(_ point: CGPoint, focused: AXUIElement) -> AXUIElement? {
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, 0.12)
        var hit: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &hit) == .success,
              let hit else { return nil }
        var owner: pid_t = 0
        guard AXUIElementGetPid(hit, &owner) == .success, owner == pid else { return nil }
        var current = hit
        for _ in 0..<32 {
            if CFEqual(current, focused) { return hit }
            if let hitWindow = Self.element(current, kAXWindowAttribute) {
                return CFEqual(hitWindow, focused) ? hit : nil
            }
            // Web content may expose its window only through the AX parent chain.
            guard let parent = Self.element(current, kAXParentAttribute),
                  !CFEqual(parent, current) else { return nil }
            current = parent
        }
        return nil
    }

    func release() {
        if app.matches(NSRunningApplication(processIdentifier: pid)) {
            for key in keys {
                CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false)?.postToPid(pid)
            }
            if let button, let bounds = lastBounds {
                postMouse(button == .left ? .leftMouseUp : .rightMouseUp, button, location, bounds: bounds)
            }
        }
        keys.removeAll()
        button = nil
    }

    @discardableResult
    private func postMouse(
        _ type: CGEventType, _ button: CGMouseButton, _ point: CGPoint,
        bounds: CGRect, clicks: Int64 = 1
    ) -> Bool {
        guard let screen = NSScreen.screens.first,
              let event = WindowMouseEvent.make(
                type: type, point: point, bounds: bounds, window: window,
                screenHeight: screen.frame.height, number: eventNumber, clicks: clicks
              ) else { return false }
        event.postToPid(pid)
        return true
    }

    func handle(_ message: [String: Any]) -> Bool {
        guard let kind = message["type"] as? String else { return false }
        if kind == "release" { release(); return false }
        guard let (bounds, focused) = focusedWindow() else { release(); return false }

        if kind == "text", let text = message["text"] as? String {
            let units = Array(text.utf16)
            guard !units.isEmpty, units.count <= 256,
                  !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return false }
            for down in [true, false] {
                guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down) else { return false }
                event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                event.postToPid(pid)
            }
            return true
        }
        if kind == "key", let code = message["code"] as? String,
           let key = Self.keyCodes[code], let down = message["down"] as? Bool {
            var flags: CGEventFlags = []
            if message["shift"] as? Bool == true { flags.insert(.maskShift) }
            if message["alt"] as? Bool == true { flags.insert(.maskAlternate) }
            if message["ctrl"] as? Bool == true { flags.insert(.maskControl) }
            if message["meta"] as? Bool == true { flags.insert(.maskCommand) }
            if flags.contains(.maskCommand), ["Tab", "Space", "Escape", "KeyQ", "KeyH"].contains(code) {
                return false
            }
            guard down || keys.contains(key),
                  let event = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: down) else { return false }
            event.flags = flags
            event.setIntegerValueField(.keyboardEventAutorepeat, value: keys.contains(key) && down ? 1 : 0)
            if down { keys.insert(key) } else { keys.remove(key) }
            event.postToPid(pid)
            return true
        }

        guard let x = message["x"] as? Double, let y = message["y"] as? Double,
              (0..<1).contains(x), (0..<1).contains(y) else { return false }
        let point = CGPoint(x: bounds.minX + x * bounds.width, y: bounds.minY + y * bounds.height)
        guard hitTarget(point, focused: focused) != nil else { release(); return false }
        location = point
        lastBounds = bounds
        if kind == "scroll", let dx = message["dx"] as? Int32, let dy = message["dy"] as? Int32,
           abs(Int64(dx)) <= 1500, abs(Int64(dy)) <= 1500 {
            let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: -dy, wheel2: -dx, wheel3: 0)
            event?.location = point
            event?.postToPid(pid)
            return event != nil
        }
        if kind == "move", let button {
            return postMouse(button == .left ? .leftMouseDragged : .rightMouseDragged, button, point, bounds: bounds)
        }
        guard let raw = message["button"] as? Int, raw == 0 || raw == 2 else { return false }
        let next: CGMouseButton = raw == 0 ? .left : .right
        let clicks = message["clicks"] as? Int64 == 2 ? Int64(2) : 1
        if kind == "down", button == nil {
            eventNumber = eventNumber == Int32.max ? 1 : eventNumber + 1
            guard postMouse(next == .left ? .leftMouseDown : .rightMouseDown, next, point,
                            bounds: bounds, clicks: clicks) else { return false }
            button = next
            return true
        }
        if kind == "up", next == button {
            button = nil
            return postMouse(next == .left ? .leftMouseUp : .rightMouseUp, next, point,
                             bounds: bounds, clicks: clicks)
        }
        return false
    }

    private static let keyCodes: [String: CGKeyCode] = [
        "KeyA": 0, "KeyS": 1, "KeyD": 2, "KeyF": 3, "KeyH": 4, "KeyG": 5, "KeyZ": 6,
        "KeyX": 7, "KeyC": 8, "KeyV": 9, "KeyB": 11, "KeyQ": 12, "KeyW": 13, "KeyE": 14,
        "KeyR": 15, "KeyY": 16, "KeyT": 17, "Digit1": 18, "Digit2": 19, "Digit3": 20,
        "Digit4": 21, "Digit6": 22, "Digit5": 23, "Equal": 24, "Digit9": 25, "Digit7": 26,
        "Minus": 27, "Digit8": 28, "Digit0": 29, "BracketRight": 30, "KeyO": 31, "KeyU": 32,
        "BracketLeft": 33, "KeyI": 34, "KeyP": 35, "Enter": 36, "KeyL": 37, "KeyJ": 38,
        "Quote": 39, "KeyK": 40, "Semicolon": 41, "Backslash": 42, "Comma": 43, "Slash": 44,
        "KeyN": 45, "KeyM": 46, "Period": 47, "Tab": 48, "Space": 49, "Backquote": 50,
        "Backspace": 51, "Escape": 53, "Home": 115, "PageUp": 116, "Delete": 117,
        "End": 119, "PageDown": 121, "ArrowLeft": 123, "ArrowRight": 124, "ArrowDown": 125,
        "ArrowUp": 126,
    ]
}
