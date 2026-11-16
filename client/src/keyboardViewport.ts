import { getAppViewport, onAppResize } from "./appViewport";

type VirtualKeyboard = EventTarget & {
  overlaysContent: boolean;
  readonly boundingRect: DOMRectReadOnly;
};
type KeyboardViewport = { height: number; offsetTop: number; keyboardOpen: boolean };
let viewport: KeyboardViewport = { height: window.innerHeight, offsetTop: 0, keyboardOpen: false };
const listeners = new Set<() => void>();

export const getKeyboardViewport = () => viewport;
export function onKeyboardViewportChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function installKeyboardViewport() {
  const root = document.getElementById("root")!;
  const keyboard = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;
  const update = () => {
    const visible = window.visualViewport;
    const bounds = keyboard?.boundingRect;
    const height = bounds?.height ? bounds.top : visible?.height ?? window.innerHeight;
    const keyboardOpen = keyboard ? bounds!.height > 0 : getAppViewport().height - height >= 80;
    const offsetTop = keyboard ? 0 : visible?.offsetTop ?? 0;
    viewport = { height, offsetTop, keyboardOpen };
    // 视口向下取景会让整页在屏幕上移，根节点正向平移同样距离抵消。
    // 在视口事件内立即写入，不经过动画或下一帧的纸片避让。
    root.style.setProperty("--keyboard-viewport-y", `${offsetTop}px`);
    for (const listener of listeners) listener();
  };
  if (keyboard) {
    keyboard.overlaysContent = true;
    keyboard.addEventListener("geometrychange", update);
  } else {
    // 没有键盘几何接口时仍需要浏览器提供缩小后的可视视口。
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!;
    meta.content = meta.content.replace("interactive-widget=overlays-content", "interactive-widget=resizes-visual");
  }
  (window.visualViewport ?? window).addEventListener("resize", update);
  window.visualViewport?.addEventListener("scroll", update);
  onAppResize(update);
  update();
}
