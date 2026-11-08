import CoreMedia
import Foundation
import ScreenCaptureKit
import VideoToolbox

final class WindowCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let queue = DispatchQueue(label: "fpl.remote-app.capture")
    private let available = DispatchSemaphore(value: 1)
    private var encoder: VTCompressionSession?
    private var stream: SCStream?
    private var forceKeyframe = true
    private var stopped = false
    private let failed: @Sendable () -> Void

    init(failed: @escaping @Sendable () -> Void) {
        self.failed = failed
    }

    @MainActor
    func start(_ window: SCWindow) async throws {
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        let scale = min(CGFloat(filter.pointPixelScale), 1280 / window.frame.width, 720 / window.frame.height)
        config.width = max(2, Int(window.frame.width * scale) / 2 * 2)
        config.height = max(2, Int(window.frame.height * scale) / 2 * 2)
        // The encoded rectangle must describe the same window bounds as input.
        config.ignoreShadowsSingleWindow = true
        config.ignoreGlobalClipSingleWindow = true
        config.scalesToFit = true
        config.preservesAspectRatio = false
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.queueDepth = 3
        config.showsCursor = false
        config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        try prepareEncoder(config.width, config.height)
        let next = SCStream(filter: filter, configuration: config, delegate: self)
        stream = next
        try next.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        try await next.startCapture()
    }

    @MainActor
    func stop() async {
        let current = stream
        stream = nil
        queue.sync { stopped = true }
        try? await current?.stopCapture()
        queue.sync {
            if let encoder {
                VTCompressionSessionInvalidate(encoder)
                self.encoder = nil
            }
        }
    }

    func keyframe() {
        queue.async { self.forceKeyframe = true }
    }

    private func prepareEncoder(_ width: Int, _ height: Int) throws {
        var next: VTCompressionSession?
        let specification = [kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder: true] as CFDictionary
        let status = VTCompressionSessionCreate(
            allocator: nil, width: Int32(width), height: Int32(height), codecType: kCMVideoCodecType_H264,
            encoderSpecification: specification, imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: nil, refcon: nil, compressionSessionOut: &next
        )
        guard status == noErr, let next else { throw CaptureError.encoder }
        VTSessionSetProperty(next, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(next, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(next, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_ConstrainedBaseline_AutoLevel)
        VTSessionSetProperty(next, key: kVTCompressionPropertyKey_AverageBitRate, value: 4_000_000 as CFNumber)
        VTSessionSetProperty(next, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: 30 as CFNumber)
        VTSessionSetProperty(next, key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, value: 1 as CFNumber)
        guard VTCompressionSessionPrepareToEncodeFrames(next) == noErr else {
            VTCompressionSessionInvalidate(next)
            throw CaptureError.encoder
        }
        encoder = next
    }

    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        failed()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard !stopped, type == .screen, Session.isUnlocked,
              let metadata = (CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false)
                              as? [[SCStreamFrameInfo: Any]])?.first,
              let rawStatus = metadata[.status] as? Int,
              SCFrameStatus(rawValue: rawStatus) == .complete,
              let image = sample.imageBuffer, let encoder,
              available.wait(timeout: .now()) == .success else { return }
        let properties = forceKeyframe ? [kVTEncodeFrameOptionKey_ForceKeyFrame: true] as CFDictionary : nil
        forceKeyframe = false
        let result = VTCompressionSessionEncodeFrame(
            encoder, imageBuffer: image, presentationTimeStamp: sample.presentationTimeStamp,
            duration: .invalid, frameProperties: properties, infoFlagsOut: nil
        ) { [self] status, _, output in
            defer { available.signal() }
            guard status == noErr, Session.isUnlocked, let output,
                  let frame = Self.annexB(output) else { return }
            Wire.send(2, frame)
        }
        if result != noErr {
            available.signal()
            failed()
        }
    }

    private static func annexB(_ output: CMSampleBuffer) -> Data? {
        guard let block = output.dataBuffer, let format = output.formatDescription else { return nil }
        var bytes = Data(count: CMBlockBufferGetDataLength(block))
        let status = bytes.withUnsafeMutableBytes { buffer in
            guard let base = buffer.baseAddress else { return kCMBlockBufferBadLengthParameterErr }
            return CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: buffer.count, destination: base)
        }
        guard status == noErr else { return nil }
        let marker: [UInt8] = [0, 0, 0, 1]
        var result = Data()
        let info = (CMSampleBufferGetSampleAttachmentsArray(output, createIfNecessary: false)
                    as? [[CFString: Any]])?.first
        if info?[kCMSampleAttachmentKey_NotSync] as? Bool != true {
            for index in 0..<2 {
                var pointer: UnsafePointer<UInt8>?
                var length = 0
                if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                    format, parameterSetIndex: index, parameterSetPointerOut: &pointer,
                    parameterSetSizeOut: &length, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil
                ) == noErr, let pointer {
                    result.append(contentsOf: marker)
                    result.append(pointer, count: length)
                }
            }
        }
        var offset = 0
        while offset + 4 <= bytes.count {
            let length = bytes[offset..<(offset + 4)].reduce(0) { ($0 << 8) | Int($1) }
            offset += 4
            guard length > 0, offset + length <= bytes.count else { return nil }
            result.append(contentsOf: marker)
            result.append(contentsOf: bytes[offset..<(offset + length)])
            offset += length
        }
        return offset == bytes.count && !result.isEmpty ? result : nil
    }

    enum CaptureError: Error { case encoder }
}
