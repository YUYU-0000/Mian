import { readSettingsMedia } from "./mediaStorage";

export type AvatarRole = "assistant" | "user";
const urls = new Map<AvatarRole, string>();

export function applyAvatar(role: AvatarRole, file: Blob) {
  const previous = urls.get(role);
  if (previous) URL.revokeObjectURL(previous);
  const url = URL.createObjectURL(file);
  urls.set(role, url);
  document.documentElement.style.setProperty(
    `--avatar-${role}`,
    `url("${url}")`,
  );
}

export async function loadAvatars() {
  await Promise.all(
    (["assistant", "user"] as const).map(async (role) => {
      const file = await readSettingsMedia(`avatar_${role}`);
      if (file) applyAvatar(role, file);
    }),
  );
}

// 从中央裁成正方形，保存头像所需的尺寸。
export async function cropAvatar(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(side, 512);
  canvas
    .getContext("2d")!
    .drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("圖片未能處理，請換一張圖片。"));
    }, "image/png"),
  );
}
