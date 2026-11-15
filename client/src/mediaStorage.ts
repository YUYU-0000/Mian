// 封面和设置媒体共用 IndexedDB 连接。
const databases = new Map<string, Promise<IDBDatabase>>();
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
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function readSettingsMedia(
  key: string,
): Promise<Blob | undefined> {
  const db = await openMediaDatabase("LauncherDB", "mediaStore");
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("mediaStore")
      .objectStore("mediaStore")
      .get(`savedMediaFile_${key}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
