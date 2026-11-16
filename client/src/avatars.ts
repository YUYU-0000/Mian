// 保存头像裁剪与图片，向共用媒体缓存和页面主题同步头像。
import { cacheMedia, openMediaDatabase, readSettingsMedia } from "./mediaStorage";
import { decodeImage } from "./imageLoading";

export type AvatarRole = "assistant" | "user";
export type AvatarCrop = { x: number; y: number; zoom: number; };
export type AvatarEditor = { file: Blob; crop: AvatarCrop; };
export const INITIAL_AVATAR_CROP: AvatarCrop = { x: 0, y: 0, zoom: 1 };
const images = new Map<AvatarRole, HTMLImageElement>();
const listeners = new Set<() => void>();
export const avatarUrl = (role: AvatarRole) => images.get(role)?.src ?? "";
export function watchAvatars(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function applyAvatar(role: AvatarRole, file: Blob) {
  const url = URL.createObjectURL(file);
  const image = await decodeImage(url);
  const previous = images.get(role);
  images.set(role, image);
  listeners.forEach(listener => listener());
  if (previous) URL.revokeObjectURL(previous.src);
}

export async function loadAvatars() {
  await Promise.all(
    (["assistant", "user"] as const).map(async (role) => {
      if (images.has(role)) return;
      const file = await readSettingsMedia(`avatar_${role}`);
      if (file) await applyAvatar(role, file);
    }),
  );
}

export async function readAvatarEditor(
  role: AvatarRole,
): Promise<AvatarEditor> {
  const db = await openMediaDatabase("LauncherDB", "mediaStore");
  const editor = await new Promise<AvatarEditor | undefined>(
    (resolve, reject) => {
      const request = db
        .transaction("mediaStore")
        .objectStore("mediaStore")
        .get(`avatarEditor_${role}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    },
  );
  return (
    editor ?? {
      file: (await readSettingsMedia(`avatar_${role}`))!,
      crop: INITIAL_AVATAR_CROP,
    }
  );
}

export async function saveAvatar(role: AvatarRole, editor: AvatarEditor) {
  const picture = await cropAvatar(editor.file, editor.crop);
  const db = await openMediaDatabase("LauncherDB", "mediaStore");
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("mediaStore", "readwrite");
    const store = transaction.objectStore("mediaStore");
    store.put(picture, `savedMediaFile_avatar_${role}`);
    store.put(editor, `avatarEditor_${role}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  await applyAvatar(role, picture);
  cacheMedia("LauncherDB", "mediaStore", `savedMediaFile_avatar_${role}`, picture);
  return picture;
}

// 位移以圆形取景框的直径为单位，预览与导出使用同一裁切区域。
async function cropAvatar(file: Blob, crop: AvatarCrop): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height) / crop.zoom;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(Math.round(side), 512);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fbfaf6";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2 - crop.x * side,
    (bitmap.height - side) / 2 - crop.y * side,
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
