// 为票根提供可离线打开的文件 URL，附件元数据决定正文的媒体类型。
import { useEffect, useState } from "react";
import { cachedFileUrl } from "./fileCache";

export function useCachedFile(url: string, enabled = true, mimeType?: string) {
  const [resolved, setResolved] = useState<{ source: string; url: string }>();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void cachedFileUrl(url, controller.signal, mimeType).then(value => {
      setResolved({ source: url, url: value });
    }).catch(() => {});
    return () => controller.abort();
  }, [url, enabled, mimeType]);
  return resolved?.source === url ? resolved.url : undefined;
}
