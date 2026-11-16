import { onBackendRecovery } from "./backend";
import { reloadForNewShell } from "./lazyImport";

export function registerShellWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  let controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controlled) reloadForNewShell();
    controlled = true;
  });
  void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(registration => {
    const update = () => { void registration.update().catch(() => {}); };
    onBackendRecovery(update);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") update(); });
    window.setInterval(update, 60000);
  }).catch(() => {});
}
