import CoreVideo
import Foundation

@main
enum RemoteWindowFrameContract {
    static func main() {
        let width = 120, height = 80
        var image: CVPixelBuffer?
        let attributes = [kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: String]]
        guard CVPixelBufferCreate(
            nil, width, height, kCVPixelFormatType_32BGRA, attributes as CFDictionary, &image
        ) == kCVReturnSuccess else { exit(77) }
        let source = image!
        CVPixelBufferLockBaseAddress(source, [])
        let stride = CVPixelBufferGetBytesPerRow(source)
        let pixels = CVPixelBufferGetBaseAddress(source)!.assumingMemoryBound(to: UInt8.self)
        for y in 0..<height {
            for x in 0..<width {
                let pixel = pixels + y * stride + x * 4
                let inside = y >= 20 && x < 90
                pixel[0] = inside && x >= 45 ? 255 : 0
                pixel[1] = inside && y >= 50 ? 255 : 0
                pixel[2] = 0 // The upper left of the window is opaque black.
                pixel[3] = inside ? 255 : 8 // A weak resampling fringe is not content.
            }
        }
        CVPixelBufferUnlockBaseAddress(source, [])

        let crop = WindowFrameCrop(width: width, height: height, windowSize: CGSize(width: 180, height: 120))
        let normalized = crop.normalize(source, pixelsPerPoint: 0.5)
        precondition(normalized !== source)
        precondition(CVPixelBufferGetWidth(normalized) == width && CVPixelBufferGetHeight(normalized) == height)
        CVPixelBufferLockBaseAddress(normalized, .readOnly)
        let result = CVPixelBufferGetBaseAddress(normalized)!.assumingMemoryBound(to: UInt8.self)
        let resultStride = CVPixelBufferGetBytesPerRow(normalized)
        precondition(result[0] == 0 && result[1] == 0 && result[3] == 255)
        precondition(result[(width - 1) * 4] == 255)
        precondition(result[(height - 1) * resultStride + 1] == 255)
        CVPixelBufferUnlockBaseAddress(normalized, .readOnly)

        precondition(crop.normalize(source, pixelsPerPoint: 0) === source)
        precondition(crop.normalize(source, pixelsPerPoint: 0.3) === source)
        let fullSize = WindowFrameCrop(width: width, height: height, windowSize: CGSize(width: 240, height: 160))
        precondition(fullSize.normalize(source, pixelsPerPoint: 0.5) === source)
    }
}
