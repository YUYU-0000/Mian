// 缓存完整文件正文，并为图片、语音和下载复用 Blob URL。
import { backendFetch, readResponse } from "./backend";
import { readOffline, writeOffline } from "./offlineStorage";

type CachedFile = { blob: Blob; createdAt: string };
const loading = new Map<string, Promise<CachedFile>>();
const objectUrls = new Map<string, string>();
const fileKey = (url: string) => url.split("?")[0];

// 文件 ID 对应的正文不变。使用整份 Blob，离线播放也支持拖动进度。
export async function cachedFile(url: string, signal?: AbortSignal): Promise<CachedFile> {
  const key = fileKey(url);
  const saved = await readOffline<CachedFile>(`file:${key}`).catch(() => undefined);
  signal?.throwIfAborted();
  if (saved) return saved;
  const response = await backendFetch(url, { signal });
  if (!response.ok) await readResponse(response);
  const file = { blob: await response.blob(), createdAt: response.headers.get("X-File-Created-At") ?? "" };
  await writeOffline({ [`file:${key}`]: file }).catch(() => {});
  return file;
}

export async function cachedFileUrl(url: string, signal?: AbortSignal, mimeType?: string) {
  if (!url.startsWith("/api/")) return url;
  const key = fileKey(url);
  const objectKey = `${key}:${mimeType ?? ""}`;
  signal?.throwIfAborted();
  if (objectUrls.has(objectKey)) return objectUrls.get(objectKey)!;
  let task = loading.get(key);
  if (!task) {
    task = cachedFile(url).finally(() => loading.delete(key));
    loading.set(key, task);
  }
  const file = await task;
  signal?.throwIfAborted();
  // 旧下载响应曾统一标成二进制；按附件元数据恢复类型，已有离线图片也能解码。
  if (!objectUrls.has(objectKey)) {
    const blob = mimeType ? file.blob.slice(0, file.blob.size, mimeType) : file.blob;
    objectUrls.set(objectKey, URL.createObjectURL(blob));
  }
  return objectUrls.get(objectKey)!;
}
