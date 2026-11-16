// 记录稳定的应用尺寸，仅在屏幕宽度或方向变化时更新，避开软键盘缩放。
type AppViewport = { width: number; height: number; };
const root = document.documentElement;
let viewport: AppViewport = {
  width: window.innerWidth,
  height: Number.parseFloat(root.style.getPropertyValue("--app-h")) || window.innerHeight,
};
const listeners = new Set<() => void>();
export const getAppViewport = () => viewport;
export const onAppResize = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function installAppViewport() {
  const measure = () => {
    viewport = { width: window.innerWidth, height: window.innerHeight };
    root.style.setProperty("--app-h", `${viewport.height}px`);
    root.dataset.appCompact = String(viewport.height <= 640);
    const scales = [[520, .53], [580, .59], [640, .65], [700, .71], [760, .77],
    [820, .84], [880, .9], [940, .96], [1000, 1.02], [1080, 1.1]];
    root.style.setProperty("--connection-scale", String(scales.find(([height]) => viewport.height <= height)?.[1] ?? 1.15));
    for (const listener of listeners) listener();
  };
  measure();
  window.addEventListener("resize", () => {
    if (window.innerWidth !== viewport.width) measure();
  });
  window.addEventListener("orientationchange", () => requestAnimationFrame(measure));
}
