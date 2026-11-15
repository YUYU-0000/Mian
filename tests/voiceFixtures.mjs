// MPEG-1 Layer III 帧：128 kbps / 44.1 kHz，供实际时长解析测试。
export function mp3(seconds = 1) {
  const frames = Math.ceil(seconds * 44100 / 1152);
  const bytes = Buffer.alloc(frames * 417);
  for (let index = 0; index < frames; index++)
    bytes.set([0xff, 0xfb, 0x90, 0x00], index * 417);
  return bytes;
}
