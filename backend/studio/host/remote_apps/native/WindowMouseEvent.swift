import AppKit

/// Constructs a process-targeted event with an actual AppKit window number.
enum WindowMouseEvent {
    static func make(
        type: CGEventType, point: CGPoint, bounds: CGRect, window: CGWindowID,
        screenHeight: CGFloat, number: Int, clicks: Int64 = 1
    ) -> CGEvent? {
        let kind: NSEvent.EventType
        switch type {
        case .leftMouseDown: kind = .leftMouseDown
        case .leftMouseUp: kind = .leftMouseUp
        case .leftMouseDragged: kind = .leftMouseDragged
        case .rightMouseDown: kind = .rightMouseDown
        case .rightMouseUp: kind = .rightMouseUp
        case .rightMouseDragged: kind = .rightMouseDragged
        default: return nil
        }
        // This process does not own the destination NSWindow. AppKit converts
        // this location using the primary screen's height, not that window's.
        // Compensate so the resulting CGEvent carries window-local top-left XY.
        // The public "window under mouse" CGEvent fields do not bind NSWindow.
        return NSEvent.mouseEvent(
            with: kind,
            location: NSPoint(x: point.x - bounds.minX, y: screenHeight - (point.y - bounds.minY)),
            modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: Int(window), context: nil, eventNumber: number,
            clickCount: Int(clicks), pressure: 0
        )?.cgEvent
    }
}
