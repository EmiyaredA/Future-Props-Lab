export const VOICE_INPUT_SAMPLE_RATE = 16_000;
export const VOICE_OUTPUT_SAMPLE_RATE = 24_000;

export function floatToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function pcm16ToBase64(input: Int16Array): string {
  const bytes = new Uint8Array(
    input.buffer,
    input.byteOffset,
    input.byteLength,
  );
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

export function base64ToFloat32Pcm(input: string): Float32Array {
  const binary = atob(input);
  const output = new Float32Array(Math.floor(binary.length / 2));
  for (let index = 0; index < output.length; index += 1) {
    const low = binary.charCodeAt(index * 2);
    const high = binary.charCodeAt(index * 2 + 1);
    const unsigned = (high << 8) | low;
    const signed = unsigned > 0x7fff ? unsigned - 0x10000 : unsigned;
    output[index] = signed / (signed < 0 ? 0x8000 : 0x7fff);
  }
  return output;
}

/** 跨音频块保留相位与低通状态，避免长通话逐块降采样产生累计漂移。 */
export function createStreamingDownsampler(fromRate: number, toRate: number) {
  if (fromRate <= 0 || toRate <= 0 || toRate > fromRate) {
    throw new Error(
      `unsupported sample-rate conversion: ${fromRate} -> ${toRate}`,
    );
  }
  let phase = 0;
  let filtered = 0;
  let initialized = false;
  const cutoff = toRate * 0.4;
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / fromRate);
  return (input: Float32Array): Float32Array => {
    if (fromRate === toRate) return new Float32Array(input);
    const values: number[] = [];
    for (const sample of input) {
      if (!initialized) {
        filtered = sample;
        initialized = true;
      } else {
        filtered += alpha * (sample - filtered);
      }
      phase += toRate;
      if (phase >= fromRate) {
        phase -= fromRate;
        values.push(filtered);
      }
    }
    return Float32Array.from(values);
  };
}

export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (!input.length || fromRate <= 0 || toRate <= 0) return new Float32Array();
  if (fromRate === toRate) return new Float32Array(input);
  const output = new Float32Array(
    Math.max(1, Math.round((input.length * toRate) / fromRate)),
  );
  const ratio = fromRate / toRate;
  for (let index = 0; index < output.length; index += 1) {
    const source = index * ratio;
    const left = Math.min(input.length - 1, Math.floor(source));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = source - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}
