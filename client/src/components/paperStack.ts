import { isScrollingText } from "./ScrollText";

// 纸堆手势、独立阴影和翻页动画。
export type PaperStack = {
  index: number;
  dragged: boolean;
  busy: boolean;
  update: () => void;
  current: () => HTMLElement;
  goTo: (index: number) => void;
  destroy: () => void;
};
export function makeStack(
  track: HTMLDivElement,
  onChange: (index: number) => void,
): PaperStack {
  /* 紙張層級按頁序固定；只顯示目前頁與下一頁，抽走的紙保持隱藏。 */
  const viewport = track.parentElement!;
  const controller = new AbortController();
  const signal = controller.signal;
  const stack: PaperStack = {
    index: 0,
    dragged: false,
    busy: false,
    update: () => {},
    current: () => track.children[0] as HTMLElement,
    goTo: () => {},
    destroy: () => {},
  };
  const shade = document.createElement("div");
  shade.className = "stack-shadow";
  shade.setAttribute("aria-hidden", "true");
  const pages = () =>
    (Array.from(track.children) as HTMLElement[]).filter((p) => p !== shade);
  const pageEasing = "cubic-bezier(.25,.8,.3,1)";
  const pageDuration = 620;
  const soft = (d: number, width: number) => {
    const cap = width * 0.85;
    return Math.sign(d) * cap * (1 - Math.exp(-Math.abs(d) / cap));
  };
  let width = 0,
    offscreenDistance = 0;
  let motion: { animation: Animation; shadowAnimation: Animation; index: number } | null =
    null;
  let startX = 0,
    startY = 0,
    currentX = 0,
    startedAt = 0,
    dragging = false,
    pointerId = 0;
  /* 拖動時微微旋轉並帶陰影；抽出末段淡出，上一張隨右拖淡入。 */
  const transform = (x: number) =>
    `translate3d(${x}px, ${-x * 0.012}px, 0) rotate(${x * 0.01}deg)`;
  function shadow(paper: HTMLElement, strength: number) {
    shade.style.zIndex = String(Number(paper.style.zIndex) - 1);
    shade.style.transform = paper.style.transform;
    shade.style.opacity = String(strength * Number(paper.style.opacity));
  }

  function rest() {
    width = viewport.clientWidth;
    offscreenDistance =
      (window.innerWidth + width) / 2 + viewport.clientHeight * 0.2 + 40;
    const list = pages();
    list.forEach((p, i) => {
      p.style.zIndex = String((list.length - i) * 2);
      p.style.visibility =
        i === stack.index || i === stack.index + 1 ? "visible" : "hidden";
      p.style.opacity = String(i < stack.index ? 0 : 1);
      p.style.transform = transform(i < stack.index ? -offscreenDistance : 0);
      p.inert = i !== stack.index;
    });
    shade.style.opacity = String(0);
  }
  stack.update = () => {
    track.appendChild(shade);
    rest();
    if (motion) {
      motion.animation.onfinish = null;
      motion.animation.cancel();
      motion.shadowAnimation.cancel();
      motion = null;
    }
    dragging = false;
    stack.busy = false;
    onChange && onChange(stack.index);
  };
  stack.current = () => pages()[stack.index];

  function paint(d: number) {
    const list = pages(),
      cur = list[stack.index],
      prev = list[stack.index - 1];
    const pulling = d < 0 && stack.index < list.length - 1;
    const k = pulling ? Math.min(1, -d / width) : 0;
    cur.style.transform = transform(pulling ? d : 0);
    cur.style.opacity = String(k > 0.85 ? Math.max(0, 1 - (k - 0.85) / 0.15) : 1);
    if (prev) {
      /* 右拖時，上一張從紙堆左側淡入，隨手勢蓋回。 */
      const kp = Math.min(1, Math.max(0, d) / width);
      prev.style.transform = transform(-(width + 40) * (1 - kp));
      prev.style.opacity = String(Math.min(1, kp * 3));
      prev.style.visibility = kp > 0 ? "visible" : "hidden";
      if (d > 0) {
        shadow(prev, 1 - kp);
        return;
      }
    }
    shadow(cur, k);
  }

  function finish() {
    if (!motion) return;
    const changed = stack.index !== motion.index;
    stack.index = motion.index;
    motion.animation.onfinish = null;
    /* 先寫入落定狀態，再取消動畫；淡出的紙不會重新變成不透明。 */
    rest();
    motion.animation.cancel();
    motion.shadowAnimation.cancel();
    motion = null;
    stack.busy = false;
    if (changed && onChange) onChange(stack.index);
  }

  /* 回彈與翻頁共用動畫，先設定終點樣式，再銜接拖曳位置。 */
  function settle(i: number, d: number) {
    const list = pages();
    const returning = d > 0 && stack.index > 0;
    const paper = list[returning ? stack.index - 1 : stack.index];
    const from = { transform: paper.style.transform, opacity: paper.style.opacity || 1 };
    const shadowFrom = { transform: from.transform, opacity: shade.style.opacity };
    const toX = returning
      ? i < stack.index
        ? 0
        : -offscreenDistance
      : i > stack.index
        ? -offscreenDistance
        : 0;
    const out = toX !== 0; /* 移至螢幕外 */
    /* 保留可見範圍內的淡出；結束後先隱藏，再移到螢幕外。 */
    const visX = out ? (returning ? -(width + 40) : -width * 1.08) : 0;
    const to = { transform: transform(visX), opacity: out ? 0 : 1 };
    const shadowTo = { transform: to.transform, opacity: 0 };
    paper.style.visibility = "visible";
    paper.style.transform = to.transform;
    paper.style.opacity = String(to.opacity);
    shade.style.zIndex = String(Number(paper.style.zIndex) - 1);
    shade.style.transform = shadowTo.transform;
    shade.style.opacity = String(shadowTo.opacity);
    stack.busy = true;
    /* 抽出時延後淡出；蓋回時提早恢復不透明。 */
    const frames = out
      ? [from, { opacity: from.opacity, offset: 0.4 }, to]
      : [from, { opacity: 1, offset: 0.3 }, to];
    /* 蓋回時使用較長時間與較緩的緩動。 */
    const timing: KeyframeAnimationOptions = out
      ? { duration: pageDuration, easing: pageEasing, fill: "both" }
      : {
          duration: pageDuration + 120,
          easing: "cubic-bezier(.22,.65,.2,1)",
          fill: "both",
        };
    const animation = paper.animate(frames, timing);
    const shadowAnimation = shade.animate(
      out
        ? [shadowFrom, { opacity: from.opacity, offset: 0.4 }, shadowTo]
        : [shadowFrom, shadowTo],
      timing,
    );
    animation.startTime = shadowAnimation.startTime = document.timeline.currentTime;
    motion = { animation, shadowAnimation, index: i };
    animation.onfinish = finish;
  }
  stack.goTo = (i) => {
    i = Math.max(0, Math.min(i, pages().length - 1));
    finish();
    if (i === stack.index) return;
    if (Math.abs(i - stack.index) === 1) {
      settle(i, i < stack.index ? 1 : -1);
      return;
    }
    stack.index = i;
    stack.update();
  };

  viewport.addEventListener(
    "pointerdown",
    (e) => {
      if (!e.isPrimary || e.button > 0) return;
      stack.dragged = false;
      if ((e.target as Element).closest("input") || isScrollingText(e.target)) return;
      finish();
      rest();
      startY = e.clientY;
      startX = currentX = e.clientX;
      startedAt = performance.now();
      dragging = true;
      pointerId = e.pointerId;
    },
    { signal },
  );
  viewport.addEventListener(
    "pointermove",
    (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      currentX = e.clientX;
      if (!stack.dragged) {
        const dx = Math.abs(currentX - startX),
          dy = Math.abs(e.clientY - startY);
        if (dy > 6 && dy > dx) {
          dragging = false;
          return;
        }
        if (dx <= 6) return;
        stack.dragged = true;
        viewport.setPointerCapture(pointerId);
      }
      paint(soft(currentX - startX, width));
    },
    { signal },
  );
  const end = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    if (!stack.dragged) return;
    const d = soft(currentX - startX, width);
    const fast =
      Math.abs(currentX - startX) / Math.max(1, performance.now() - startedAt) > 0.5;
    let i = stack.index;
    if (e.type !== "pointercancel") {
      if ((d < -width * 0.22 || (fast && d < -30)) && i < pages().length - 1) i++;
      else if ((d > width * 0.22 || (fast && d > 30)) && i > 0) i--;
    }
    settle(i, d);
  };
  viewport.addEventListener("pointerup", end, { signal });
  viewport.addEventListener("pointercancel", end, { signal });
  /* Safari 的原生文字／圖片拖曳不能接管紙張手勢。 */
  viewport.addEventListener(
    "dragstart",
    (e) => {
      if (!(e.target as Element).closest("input")) e.preventDefault();
    },
    { signal },
  );
  /* 攔下拖曳結束後的點擊；下次按下時重設 dragged。 */
  viewport.addEventListener(
    "click",
    (e) => {
      if (stack.dragged && e.detail !== 0) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    { capture: true, signal },
  );
  stack.destroy = () => {
    controller.abort();
    motion?.animation.cancel();
    motion?.shadowAnimation.cancel();
    shade.remove();
  };
  return stack;
}
