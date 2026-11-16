// 缓存懒加载请求，分块失效时沿用一次刷新恢复，防止刷新循环。
const RELOAD_KEY = "mian.lazy-import-reload.v1";
const VITE_PRELOAD = "vite:preloadError";
let refreshing = false;

export function reloadOnPreloadError(moduleId = VITE_PRELOAD) {
  const failedModule = sessionStorage.getItem(RELOAD_KEY);
  if (failedModule && (!refreshing || failedModule !== VITE_PRELOAD)) return;

  // Vite 先发事件，再让 import 拒绝；随后用模块名补上这次失败的标记。
  sessionStorage.setItem(RELOAD_KEY, moduleId);
  if (refreshing) return;
  refreshing = true;
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.getRegistration().then(registration => registration?.update())
      .catch(() => { }).finally(() => window.location.reload());
  } else window.location.reload();
}

export function cacheLazyImport<T>(moduleId: string, load: () => Promise<T>) {
  let request: Promise<T> | undefined;
  return () =>
  (request ??= load().then(
    (module) => {
      const failedModule = sessionStorage.getItem(RELOAD_KEY);
      if (
        !refreshing &&
        (failedModule === moduleId || failedModule === VITE_PRELOAD)
      )
        sessionStorage.removeItem(RELOAD_KEY);
      return module;
    },
    (error) => {
      reloadOnPreloadError(moduleId);
      throw error;
    },
  ));
}
