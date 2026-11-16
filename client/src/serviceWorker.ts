// 注册界面外壳缓存并触发后台版本检查，更新留到下次冷启动生效。
import { onBackendRecovery } from "./backend";

export function registerShellWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(registration => {
    const update = () => { void registration.update().catch(() => { }); };
    onBackendRecovery(update);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") update(); });
    window.setInterval(update, 60000);
  }).catch(() => { });
}
