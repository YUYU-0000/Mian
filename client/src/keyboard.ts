import { editableSelector } from "./inputFocus";
import { getKeyboardViewport, onKeyboardViewportChange } from "./keyboardViewport";

function visiblePaperBottom(surface: HTMLElement) {
  let bottom = surface.getBoundingClientRect().bottom;
  const visit = (element: Element, clipTop: number, clipBottom: number) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return;
    const rect = element.getBoundingClientRect();
    const top = Math.max(rect.top, clipTop);
    const edge = Math.min(rect.bottom, clipBottom);
    if (edge > top) bottom = Math.max(bottom, edge);
    // 滚动区里被裁掉的内容不属于可见纸层，不能把它算成额外下沿。
    if (style.overflowY !== "visible") {
      clipTop = top;
      clipBottom = edge;
    }
    for (const child of element.children) visit(child, clipTop, clipBottom);
  };
  visit(surface, -Infinity, Infinity);
  // 只补伪元素伸出的部分；真实子元素已包含在上面的并集中。
  return bottom + (parseFloat(getComputedStyle(surface).getPropertyValue("--keyboard-extra")) || 0);
}

export function installKeyboardLift() {
  const positions = new Map<HTMLElement, number>();
  const motions = new WeakMap<HTMLElement, { y: number; animation: Animation }>();
  let surface: HTMLElement | null = null;
  let frame = 0;
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
    const viewport = getKeyboardViewport();
    const next = focused.matches(editableSelector) && !focused.closest(".archive-input") && viewport.keyboardOpen
      ? focused.closest<HTMLElement>("[data-keyboard-surface]") : null;
    if (surface && surface !== next) move(surface, 0);
    surface = next;
    if (!surface) return;
    restoreScroll();
    // 同时扣除根节点的视口抵消和纸片当前位移，始终按原纸片位置计算。
    const offset = viewport.offsetTop + currentY(surface);
    const paperBottom = visiblePaperBottom(surface) - offset;
    let y = 0;
    if (paperBottom > viewport.height) {
      y = viewport.height - 6 - paperBottom;
      const field = focused.getBoundingClientRect();
      // 纸片过高时，优先保住字段；上方本来可见的字段无需再向下推。
      if (field.top - offset + y < 0) {
        y = Math.min(0, viewport.height - 6 - (field.bottom - offset));
      }
    }
    move(surface, y);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(reveal);
  };
  document.addEventListener("focusin", () => {
    positions.clear();
    const focused = document.activeElement as HTMLElement;
    if (focused.matches(editableSelector) && !focused.closest(".archive-input") && focused.closest("[data-keyboard-surface]")) {
      for (let parent = focused.parentElement; parent; parent = parent.parentElement) positions.set(parent, parent.scrollTop);
    }
    schedule();
  }, true);
  document.addEventListener("focusout", schedule, true);
  document.addEventListener("scroll", () => { if (surface) restoreScroll(); }, true);
  onKeyboardViewportChange(schedule);
}
