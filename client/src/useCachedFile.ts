import { useEffect, useState } from "react";
import { cachedFileUrl } from "./fileCache";

export function useCachedFile(url: string, enabled = true) {
  const [resolved, setResolved] = useState<{ source: string; url: string }>();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void cachedFileUrl(url, controller.signal).then(value => {
      setResolved({ source: url, url: value });
    }).catch(() => {});
    return () => controller.abort();
  }, [url, enabled]);
  return resolved?.source === url ? resolved.url : undefined;
}
