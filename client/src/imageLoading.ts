// 合并同一图片的并行解码，图片准备好以后再交给界面显影。
const decoding = new Map<string, Promise<HTMLImageElement>>();
const decoded = new Set<string>();
export const imageDecoded = (src: string) => decoded.has(src);
export function decodeImage(src: string, referrerPolicy?: HTMLImageElement["referrerPolicy"]) {
  if (!decoding.has(src)) {
    const image = new Image();
    if (referrerPolicy) image.referrerPolicy = referrerPolicy;
    image.src = src;
    decoding.set(src, image.decode().then(() => { decoded.add(src); return image; }).finally(() => decoding.delete(src)));
  }
  return decoding.get(src)!;
}
