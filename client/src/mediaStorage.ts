import { compressImage } from "./imageCompression";

// 封面和设置媒体共用 IndexedDB 连接。
const databases = new Map<string, Promise<IDBDatabase>>();
export type CachedMedia = { url: string; video: boolean; time: number };
const media = new Map<string, CachedMedia | null>();
const reads = new Map<string, Promise<CachedMedia | null>>();
const listeners = new Map<string, Set<() => void>>();
const mediaId = (name: string, store: string, key: string) => JSON.stringify([name, store, key]);
export const getCachedMedia = (name: string, store: string, key: string) => media.get(mediaId(name, store, key));
export function watchMedia(name: string, store: string, key: string, listener: () => void) {
  const id = mediaId(name, store, key);
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(listener);
  return () => { listeners.get(id)!.delete(listener); };
}
export function cacheMedia(name: string, store: string, key: string, file: Blob | undefined) {
  const id = mediaId(name, store, key);
  const previous = media.get(id);
  const picture = file ? { url: URL.createObjectURL(file), video: file.type.startsWith("video/"), time: 0 } : null;
  media.set(id, picture);
  if (previous) URL.revokeObjectURL(previous.url);
  listeners.get(id)?.forEach(listener => listener());
  return picture;
}
export function loadCachedMedia(name: string, store: string, key: string) {
  const id = mediaId(name, store, key);
  if (media.has(id)) return Promise.resolve(media.get(id)!);
  if (!reads.has(id)) reads.set(id, readMedia(name, store, key).then(file =>
    media.has(id) ? media.get(id)! : cacheMedia(name, store, key, file),
  ).finally(() => reads.delete(id)));
  return reads.get(id)!;
}
export function openMediaDatabase(name: string, store: string) {
  if (!databases.has(name))
    databases.set(
      name,
      new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          databases.delete(name);
          reject(request.error);
        };
      }),
    );
  return databases.get(name)!;
}
export async function removeSettingsMedia(key: string) {
  const db = await openMediaDatabase("LauncherDB", "mediaStore");
  const transaction = db.transaction("mediaStore", "readwrite");
  transaction.objectStore("mediaStore").delete(`savedMediaFile_${key}`);
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => { cacheMedia("LauncherDB", "mediaStore", `savedMediaFile_${key}`, undefined); resolve(); };
    transaction.onerror = () => reject(transaction.error);
  });
}

export function readSettingsMedia(key: string) {
  return readMedia("LauncherDB", "mediaStore", `savedMediaFile_${key}`);
}

export async function readMedia(
  name: string,
  store: string,
  key: string,
): Promise<Blob | undefined> {
  const db = await openMediaDatabase(name, store);
  const file = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = db
      .transaction(store)
      .objectStore(store)
      .get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!file || !file.type.startsWith("image/")) return file;
  const compressed = await compressImage(file, 1600, true);
  if (compressed !== file) await writeMedia(name, store, key, compressed);
  return compressed;
}

export async function writeMedia(
  name: string,
  store: string,
  key: string,
  file: Blob,
) {
  const db = await openMediaDatabase(name, store);
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    transaction.objectStore(store).put(file, key);
    transaction.oncomplete = () => { cacheMedia(name, store, key, file); resolve(); };
    transaction.onerror = () => reject(transaction.error);
  });
}
