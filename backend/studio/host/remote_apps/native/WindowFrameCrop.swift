import Accelerate
import CoreVideo
import Foundation

/// Fits a padded capture to the encoder surface using the window's input geometry.
final class WindowFrameCrop {
    private let windowSize: CGSize
    private let pool: CVPixelBufferPool?

    init(width: Int, height: Int, windowSize: CGSize) {
        self.windowSize = windowSize
        let attributes: [String: Any] = [
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        var pool: CVPixelBufferPool?
        CVPixelBufferPoolCreate(nil, nil, attributes as CFDictionary, &pool)
        self.pool = pool
    }

    func normalize(_ image: CVPixelBuffer, pixelsPerPoint: CGFloat) -> CVPixelBuffer {
        let width = CVPixelBufferGetWidth(image)
        let height = CVPixelBufferGetHeight(image)
        let expected = CGSize(width: windowSize.width * pixelsPerPoint, height: windowSize.height * pixelsPerPoint)
        // Small differences come from rounding the configured output to even pixels.
        let tolerance: CGFloat = 2
        guard CVPixelBufferGetPixelFormatType(image) == kCVPixelFormatType_32BGRA,
              expected.width >= 2, expected.height >= 2,
              expected.width <= CGFloat(width) + tolerance, expected.height <= CGFloat(height) + tolerance,
              CGFloat(width) - expected.width > tolerance || CGFloat(height) - expected.height > tolerance,
              let pool, CVPixelBufferLockBaseAddress(image, .readOnly) == kCVReturnSuccess else { return image }
        defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(image) else { return image }
        let stride = CVPixelBufferGetBytesPerRow(image)
        let pixels = base.assumingMemoryBound(to: UInt8.self)
        var left = width, right = -1, top = height, bottom = -1
        // Ignore the faint alpha fringe around a scaled window.
        let alphaThreshold: UInt8 = 16
        for y in 0..<height {
            let row = pixels + y * stride
            guard let first = (0..<width).first(where: { row[$0 * 4 + 3] > alphaThreshold }) else { continue }
            let last = (first..<width).last(where: { row[$0 * 4 + 3] > alphaThreshold }) ?? first
            left = min(left, first)
            right = max(right, last)
            top = min(top, y)
            bottom = y
        }
        let contentWidth = right - left + 1
        let contentHeight = bottom - top + 1
        // Only remove transparency whose extent agrees with the window used for input.
        guard contentWidth > 0, contentHeight > 0,
              abs(CGFloat(contentWidth) - expected.width) <= tolerance,
              abs(CGFloat(contentHeight) - expected.height) <= tolerance else { return image }

        var output: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &output) == kCVReturnSuccess, let output,
              CVPixelBufferLockBaseAddress(output, []) == kCVReturnSuccess else { return image }
        defer { CVPixelBufferUnlockBaseAddress(output, []) }
        guard let destination = CVPixelBufferGetBaseAddress(output) else { return image }
        var sourceBuffer = vImage_Buffer(
            data: base.advanced(by: top * stride + left * 4),
            height: vImagePixelCount(contentHeight), width: vImagePixelCount(contentWidth), rowBytes: stride
        )
        var outputBuffer = vImage_Buffer(
            data: destination, height: vImagePixelCount(CVPixelBufferGetHeight(output)),
            width: vImagePixelCount(CVPixelBufferGetWidth(output)), rowBytes: CVPixelBufferGetBytesPerRow(output)
        )
        guard vImageScale_ARGB8888(&sourceBuffer, &outputBuffer, nil, vImage_Flags(kvImageNoFlags)) == kvImageNoError else {
            return image
        }
        CVBufferPropagateAttachments(image, output)
        CVBufferRemoveAttachment(output, kCVImageBufferCleanApertureKey)
        return output
    }
}
