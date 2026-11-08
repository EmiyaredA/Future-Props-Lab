import AppKit

@main
enum RemoteWindowMouseContract {
    static func main() {
        guard let screen = NSScreen.screens.first else {
            print("A macOS login session is required")
            exit(77)
        }
        let types: [(CGEventType, NSEvent.EventType)] = [
            (.leftMouseDown, .leftMouseDown), (.leftMouseUp, .leftMouseUp),
            (.leftMouseDragged, .leftMouseDragged), (.rightMouseDown, .rightMouseDown),
            (.rightMouseUp, .rightMouseUp), (.rightMouseDragged, .rightMouseDragged),
        ]
        // A moved window and a window on a display above/left of the primary.
        for bounds in [CGRect(x: 135, y: 87, width: 900, height: 640),
                       CGRect(x: -1280, y: -720, width: 1000, height: 680)] {
            for local in [CGPoint(x: 12, y: 35), CGPoint(x: 720, y: 570)] {
                for (kind, expected) in types {
                    let event = WindowMouseEvent.make(
                        type: kind, point: CGPoint(x: bounds.minX + local.x, y: bounds.minY + local.y),
                        bounds: bounds, window: 4242, screenHeight: screen.frame.height, number: 17, clicks: 2
                    )!
                    // Verify the actual serialized event delivered across processes,
                    // rather than just the arguments given to the factory.
                    let received = CGEvent(withDataAllocator: nil, data: event.data!)!
                    let cocoa = NSEvent(cgEvent: received)!
                    precondition(cocoa.windowNumber == 4242)
                    precondition(cocoa.type == expected && cocoa.clickCount == 2 && cocoa.eventNumber == 17)
                    precondition(abs(received.location.x - local.x) < 0.01)
                    precondition(abs(received.location.y - local.y) < 0.01)
                    precondition(cocoa.modifierFlags.isEmpty)
                }
            }
        }
        print("24 process-targeted mouse event contracts passed")
    }
}
