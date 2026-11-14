// 封面和设置媒体共用的 IndexedDB 连接与删除操作。
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
