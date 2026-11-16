import { getAppViewport } from "./appViewport";

const editable = 'textarea,input:not([type="file"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="button"]):not([type="submit"]),[contenteditable="true"]';

export function installKeyboardScroll() {
  const positions = new Map<HTMLElement, number>();
  let frame = 0;
  const restore = () => {
    for (const [element, top] of positions) {
      element.style.removeProperty("--keyboard-room");
      delete element.dataset.keyboardActive;
      element.scrollTop = top;
    }
    positions.clear();
  };
  const reveal = () => {
    frame = 0;
    const focused = document.activeElement as HTMLElement;
    if (!focused.matches(editable) || focused.closest(".archive-input")) { restore(); return; }
    const visible = window.visualViewport;
    const height = visible?.height ?? window.innerHeight;
    const covered = getAppViewport().height - height;
    if (covered < 80) { restore(); return; }
    // 页面本身不跟随 Safari 的自动平移；滚动留在纸片内容内。
    if (window.scrollY) window.scrollTo(0, 0);
    const bottom = height - 12;
    let scroller = focused.closest<HTMLElement>("[data-keyboard-scroll]");
    while (scroller) {
      if (!positions.has(scroller)) positions.set(scroller, scroller.scrollTop);
      scroller.style.setProperty("--keyboard-room", `${covered}px`);
      scroller.dataset.keyboardActive = "";
      const field = focused.getBoundingClientRect();
      const area = scroller.getBoundingClientRect();
      const limit = Math.min(bottom, area.bottom);
      const fieldBottom = focused instanceof HTMLTextAreaElement ? field.top + Math.min(field.height, 40) : field.bottom;
      if (fieldBottom > limit) scroller.scrollTop += fieldBottom - limit;
      else if (field.top < area.top + 8) scroller.scrollTop -= area.top + 8 - field.top;
      if (focused.getBoundingClientRect().bottom <= bottom) break;
      scroller = scroller.parentElement?.closest<HTMLElement>("[data-keyboard-scroll]") ?? null;
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(reveal);
  };
  document.addEventListener("focusin", schedule, true);
  document.addEventListener("focusout", schedule, true);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
}
