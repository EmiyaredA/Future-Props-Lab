const TARGET_SAMPLE_RATE = 16_000;
const WAV_HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1)
    view.setUint8(offset + index, value.charCodeAt(index));
}

function sampleAt(channel: Float32Array, position: number): number {
  const left = Math.min(channel.length - 1, Math.max(0, Math.floor(position)));
  const right = Math.min(channel.length - 1, left + 1);
  const fraction = position - left;
  return channel[left]! + (channel[right]! - channel[left]!) * fraction;
}

export function audioBufferRangeToWav(
  buffer: Pick<
    AudioBuffer,
    "duration" | "numberOfChannels" | "sampleRate" | "getChannelData"
  >,
  startMs: number,
  endMs: number,
): Blob {
  const safeStartMs = Math.max(0, Math.min(buffer.duration * 1000, startMs));
  const safeEndMs = Math.max(
    safeStartMs,
    Math.min(buffer.duration * 1000, endMs),
  );
  const durationSeconds = (safeEndMs - safeStartMs) / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new Error("当前片段没有可转写的音频范围");

  const frameCount = Math.max(
    1,
    Math.round(durationSeconds * TARGET_SAMPLE_RATE),
  );
  const bytes = new ArrayBuffer(WAV_HEADER_BYTES + frameCount * 2);
  const view = new DataView(bytes);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + frameCount * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, frameCount * 2, true);

  const channels = Array.from(
    { length: buffer.numberOfChannels },
    (_, channel) => buffer.getChannelData(channel),
  );
  const startFrame = (safeStartMs / 1000) * buffer.sampleRate;
  const sourceStep = buffer.sampleRate / TARGET_SAMPLE_RATE;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sourcePosition = startFrame + frame * sourceStep;
    const mono =
      channels.reduce(
        (sum, channel) => sum + sampleAt(channel, sourcePosition),
        0,
      ) / channels.length;
    const clamped = Math.max(-1, Math.min(1, mono));
    view.setInt16(
      WAV_HEADER_BYTES + frame * 2,
      clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff),
      true,
    );
  }
  return new Blob([bytes], { type: "audio/wav" });
}
