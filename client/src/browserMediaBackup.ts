// 补齐浏览器里的头像、裁切原图、字体页照片和订阅封面，沿用原 IndexedDB 存储。
import { blobToDataURL } from "./imageCompression";
import { homePhotoKeys } from "./homePhotos";
import { cacheMedia, openMediaDatabase } from "./mediaStorage";
import type { AvatarCrop } from "./avatars";

type StoredPicture = string | { file: string; crop: AvatarCrop };
export type BrowserMediaBackup = Record<string, Record<string, StoredPicture>>;
const stores = [["LauncherDB", "mediaStore"], ["mian_connections", "media"]] as const;
const homeKeys = new Set(Object.values(homePhotoKeys).map(key => `savedMediaFile_${key}`));

export async function exportBrowserMedia(): Promise<BrowserMediaBackup> {
  const media: BrowserMediaBackup = {};
  for (const [name, store] of stores) {
    const db = await openMediaDatabase(name, store);
    const entries = await new Promise<[string, Blob | { file: Blob; crop: AvatarCrop }][]>((resolve, reject) => {
      const transaction = db.transaction(store);
      const keys = transaction.objectStore(store).getAllKeys();
      const values = transaction.objectStore(store).getAll();
      transaction.oncomplete = () => resolve(keys.result.map((key, i) => [String(key), values.result[i]]));
      transaction.onerror = () => reject(transaction.error);
    });
    media[name] = {};
    for (const [key, value] of entries) {
      if (name === "LauncherDB" && homeKeys.has(key)) continue;
      media[name][key] = value instanceof Blob ? await blobToDataURL(value)
        : { file: await blobToDataURL(value.file), crop: value.crop };
    }
  }
  return media;
}

export async function restoreBrowserMedia(media: BrowserMediaBackup | undefined) {
  if (!media) return; // 旧版备份没有这部分，保留原来已存的照片。
  for (const [name, store] of stores) {
    const entries = await Promise.all(Object.entries(media[name] ?? {}).map(async ([key, value]) => [key,
      typeof value === "string" ? await (await fetch(value)).blob()
        : { file: await (await fetch(value.file)).blob(), crop: value.crop },
    ] as const));
    const db = await openMediaDatabase(name, store);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      objectStore.clear();
      for (const [key, value] of entries) objectStore.put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    for (const [key, value] of entries) if (value instanceof Blob) cacheMedia(name, store, key, value);
  }
}
