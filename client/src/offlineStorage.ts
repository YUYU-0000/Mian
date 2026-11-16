import { openMediaDatabase } from "./mediaStorage";

const database = () => openMediaDatabase("MianOffline", "entries");
export async function readOffline<T>(key: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction("entries").objectStore("entries").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 队列与对应的本地快照一起落盘，刷新后也不会丢掉尚未补发的修改。
export async function writeOffline(values: Record<string, unknown>, cacheKey?: string) {
  const db = await database();
  return new Promise<boolean>((resolve, reject) => {
    const transaction = db.transaction("entries", "readwrite");
    const store = transaction.objectStore("entries");
    let written = false;
    const put = () => {
      for (const [key, value] of Object.entries(values)) store.put(value, key);
      written = true;
    };
    if (cacheKey) {
      const queue = store.get("outbox");
      queue.onsuccess = () => {
        if (!queue.result?.some((save: { keys: string[] }) => save.keys.includes(cacheKey))) put();
      };
    } else put();
    transaction.oncomplete = () => resolve(written);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
