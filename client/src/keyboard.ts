import { getAppViewport } from "./appViewport";

const editable = 'textarea,input:not([type="file"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="button"]):not([type="submit"]),[contenteditable="true"]';

export function installKeyboardLift() {
  const positions = new Map<HTMLElement, number>();
  const motions = new WeakMap<HTMLElement, { y: number; animation: Animation }>();
  let surface: HTMLElement | null = null;
  let frame = 0;
  const keyboardOpen = () => getAppViewport().height - (window.visualViewport?.height ?? window.innerHeight) >= 80;
  const currentY = (element: HTMLElement) => parseFloat(getComputedStyle(element).translate.split(" ")[1]) || 0;
  const move = (element: HTMLElement, y: number) => {
    const previous = motions.get(element);
    if ((previous?.y ?? 0) === y) return;
    const from = currentY(element);
    previous?.animation.cancel();
    // 独立的 translate 也是合成层变换，不覆盖纸片原有的居中、旋转和翻页 transform。
    element.style.translate = `0px ${y}px`;
    const animation = element.animate(
      [{ translate: `0px ${from}px` }, { translate: `0px ${y}px` }],
      { duration: 200, easing: "ease-out" },
    );
    animation.onfinish = () => { if (y === 0) element.style.removeProperty("translate"); };
    motions.set(element, { y, animation });
  };
  const restoreScroll = () => {
    // 只撤销浏览器聚焦时擅自滚动的祖先容器，不用滚动对齐字段。
    for (const [element, top] of positions) {
      if (element.scrollTop !== top) element.scrollTop = top;
    }
  };
  const reveal = () => {
    frame = 0;
    const focused = document.activeElement as HTMLElement;
    const next = focused.matches(editable) && !focused.closest(".archive-input") && keyboardOpen()
      ? focused.closest<HTMLElement>("[data-keyboard-surface]") : null;
    if (surface && surface !== next) move(surface, 0);
    surface = next;
    if (!surface) return;
    restoreScroll();
    const visible = window.visualViewport;
    const bottom = visible ? visible.offsetTop + visible.height : window.innerHeight;
    // 用未平移的位置计算，键盘连续调整或在字段间切换时不会累加位移。
    const fieldBottom = focused.getBoundingClientRect().bottom - currentY(surface);
    move(surface, fieldBottom > bottom ? bottom - 8 - fieldBottom : 0);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(reveal);
  };
  document.addEventListener("focusin", () => {
    positions.clear();
    const focused = document.activeElement as HTMLElement;
    if (focused.matches(editable) && !focused.closest(".archive-input") && focused.closest("[data-keyboard-surface]")) {
      for (let parent = focused.parentElement; parent; parent = parent.parentElement) positions.set(parent, parent.scrollTop);
    }
    schedule();
  }, true);
  document.addEventListener("focusout", schedule, true);
  document.addEventListener("scroll", () => { if (surface) restoreScroll(); }, true);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
}
