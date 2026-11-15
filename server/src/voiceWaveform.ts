import { MPEGDecoder } from "mpg123-decoder";

type PcmPart = { channelData: Float32Array[]; duration: number };

// 整条语音等分为 38 段；分段音频按各自时长接在同一条时间线上。
export function voicePeaks(parts: PcmPart[]) {
  const peaks = Array<number>(38).fill(0);
  const duration = parts.reduce((sum, part) => sum + part.duration, 0);
  let offset = 0;
  for (const part of parts) {
    for (const channel of part.channelData) {
      for (let sample = 0; sample < channel.length; sample++) {
        const time = offset + sample / channel.length * part.duration;
        const index = Math.min(37, Math.floor(time / duration * 38));
        peaks[index] = Math.min(1, Math.max(peaks[index], Math.abs(channel[sample])));
      }
    }
    offset += part.duration;
  }
  return peaks;
}

export async function decodeVoicePeaks(parts: { audio: Uint8Array; duration: number }[]) {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  try {
    const decoded: PcmPart[] = [];
    for (const [index, part] of parts.entries()) {
      if (index > 0) await decoder.reset();
      const { channelData } = decoder.decode(part.audio);
      decoded.push({ channelData, duration: part.duration });
    }
    return voicePeaks(decoded);
  } finally {
    decoder.free();
  }
}
