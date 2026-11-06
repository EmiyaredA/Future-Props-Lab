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

    init(app: MacApp, pid: pid_t, window: CGWindowID, size: CGSize) {
        self.app = app
        self.pid = pid
        self.window = window
        self.size = size
    }

    private func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, key as CFString, &result) == .success else { return nil }
        return result
    }

    private func element(_ parent: AXUIElement, _ key: String) -> AXUIElement? {
        guard let value = attribute(parent, key), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return value as! AXUIElement?
    }

    private func matchesBounds(_ element: AXUIElement, _ bounds: CGRect) -> Bool {
        guard let point = attribute(element, kAXPositionAttribute),
              let size = attribute(element, kAXSizeAttribute),
              CFGetTypeID(point) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return false }
        var origin = CGPoint.zero
        var dimensions = CGSize.zero
        guard AXValueGetValue(point as! AXValue, .cgPoint, &origin),
              AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { return false }
        return abs(origin.x - bounds.minX) <= 2 && abs(origin.y - bounds.minY) <= 2
            && abs(dimensions.width - bounds.width) <= 2 && abs(dimensions.height - bounds.height) <= 2
    }

    private func liveBounds() -> CGRect? {
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
        // AX has no public window-number attribute. Require a unique AX bounds match,
        // and require that window to be focused before posting process-targeted events.
        let target = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(target, 0.12)
        guard let focused = element(target, kAXFocusedWindowAttribute),
              let all = attribute(target, kAXWindowsAttribute) as? [AXUIElement],
              matchesBounds(focused, rect),
              all.filter({ matchesBounds($0, rect) }).count == 1 else { return nil }
        return rect
    }

    func raise(_ bounds: CGRect) {
        let target = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(target, 0.12)
        guard let all = attribute(target, kAXWindowsAttribute) as? [AXUIElement] else { return }
        let matches = all.filter { matchesBounds($0, bounds) }
        if matches.count == 1 {
            AXUIElementPerformAction(matches[0], kAXRaiseAction as CFString)
        }
    }

    private func hitTarget(_ point: CGPoint) -> Bool {
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, 0.12)
        var hit: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &hit) == .success,
              let hit else { return false }
        var owner: pid_t = 0
        guard AXUIElementGetPid(hit, &owner) == .success, owner == pid,
              let hitWindow = element(hit, kAXWindowAttribute)
                ?? ((attribute(hit, kAXRoleAttribute) as? String == kAXWindowRole) ? hit : nil),
              let focused = element(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute)
        else { return false }
        return CFEqual(hitWindow, focused)
    }

    func release() {
        if app.matches(NSRunningApplication(processIdentifier: pid)) {
            for key in keys {
                CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false)?.postToPid(pid)
            }
            if let button {
                postMouse(button == .left ? .leftMouseUp : .rightMouseUp, button, location)
            }
        }
        keys.removeAll()
        button = nil
    }

    private func postMouse(_ type: CGEventType, _ button: CGMouseButton, _ point: CGPoint, clicks: Int64 = 1) {
        let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button)
        event?.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(window))
        event?.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(window))
        event?.setIntegerValueField(.mouseEventClickState, value: clicks)
        event?.postToPid(pid)
    }

    func handle(_ message: [String: Any]) -> Bool {
        guard let kind = message["type"] as? String else { return false }
        if kind == "release" { release(); return false }
        guard let bounds = liveBounds() else { release(); return false }

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
        guard hitTarget(point) else { release(); return false }
        location = point
        if kind == "scroll", let dx = message["dx"] as? Int32, let dy = message["dy"] as? Int32,
           abs(Int64(dx)) <= 1500, abs(Int64(dy)) <= 1500 {
            let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: -dy, wheel2: -dx, wheel3: 0)
            event?.location = point
            event?.postToPid(pid)
            return event != nil
        }
        if kind == "move", let button {
            postMouse(button == .left ? .leftMouseDragged : .rightMouseDragged, button, point)
            return true
        }
        guard let raw = message["button"] as? Int, raw == 0 || raw == 2 else { return false }
        let next: CGMouseButton = raw == 0 ? .left : .right
        let clicks = message["clicks"] as? Int64 == 2 ? Int64(2) : 1
        if kind == "down", button == nil {
            button = next
            postMouse(next == .left ? .leftMouseDown : .rightMouseDown, next, point, clicks: clicks)
            return true
        }
        if kind == "up", next == button {
            button = nil
            postMouse(next == .left ? .leftMouseUp : .rightMouseUp, next, point, clicks: clicks)
            return true
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
