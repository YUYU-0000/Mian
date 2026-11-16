// 只缓存前端界面资源和字体，绕过鉴权接口、WebSocket 与私人文件。
const SHELL = "mian-shell-__MIAN_VERSION__";
const ASSETS = __MIAN_ASSETS__;
const assetPaths = new Set(ASSETS);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: "reload" })));
    // 新版下载完成后等待旧页面全部关闭，下次冷启动再接管。
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    // 保留上一版分块，兼容尚在结束的旧导航请求。
    const previous = (await caches.keys()).filter(key => key.startsWith("mian-shell-") && key !== SHELL);
    await Promise.all(previous.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || !["http:", "https:"].includes(url.protocol)) return;
  if (url.origin === self.location.origin && (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/ws")) return;
  if ((request.mode === "navigate" || url.pathname === "/index.html") && url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store", signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error("shell unavailable");
        // 新 HTML 交给新 worker 连同分块一起入库，保持旧版离线壳完整。
        return response;
      } catch {
        return (await caches.open(SHELL)).match("/index.html");
      }
    })());
    return;
  }
  const localAsset = url.origin === self.location.origin && (assetPaths.has(url.pathname) || url.pathname.startsWith("/assets/"));
  if (!localAsset && request.destination !== "font") return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const saved = await cache.match(request) ?? await caches.match(request);
    if (saved) return saved;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
