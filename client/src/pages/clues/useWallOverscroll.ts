// 只在手指越过真实边界时平移墙面内容，松手或中断后统一归零。
import { useLayoutEffect, useRef, type RefObject } from "react";
import { getKeyboardViewport, onKeyboardViewportChange } from "../../keyboardViewport";

export function useWallOverscroll(
  scroll: RefObject<HTMLDivElement | null>,
  board: RefObject<HTMLDivElement | null>,
) {
  const stop = useRef(() => { });
  useLayoutEffect(() => {
    const wall = scroll.current!, content = board.current!;
    let finger: { x: number; y: number; lastY: number; vertical: boolean; } | null = null;
    let edge: "top" | "bottom" | null = null;
    let distance = 0;
    let animation: Animation | null = null;
    const reset = () => {
      animation?.cancel();
      animation = null;
      content.style.removeProperty("transform");
      if (edge) wall.scrollTop = edge === "top" ? 0 : wall.scrollHeight - wall.clientHeight;
      finger = null;
      edge = null;
      distance = 0;
    };
    stop.current = reset;
    const start = (event: TouchEvent) => {
      reset();
      if (event.touches.length !== 1 || getKeyboardViewport().keyboardOpen ||
        (event.target as Element).closest(".item,.pin")) return;
      const touch = event.touches[0];
      finger = { x: touch.clientX, y: touch.clientY, lastY: touch.clientY, vertical: false };
    };
    const move = (event: TouchEvent) => {
      if (!finger) return;
      if (event.touches.length !== 1) { reset(); return; }
      const touch = event.touches[0];
      if (!finger.vertical) {
        const dx = touch.clientX - finger.x, dy = touch.clientY - finger.y;
        if (Math.hypot(dx, dy) < 4) return;
        if (Math.abs(dx) > Math.abs(dy)) { reset(); return; }
        finger.vertical = true;
      }
      const dy = touch.clientY - finger.lastY;
      finger.lastY = touch.clientY;
      if (!edge) {
        const bottom = wall.scrollHeight - wall.clientHeight;
        if (wall.scrollTop <= 1 && dy > 0) edge = "top";
        else if (wall.scrollTop >= bottom - 1 && dy < 0) edge = "bottom";
        else return;
        wall.scrollTop = edge === "top" ? 0 : bottom;
      }
      distance += dy;
      // 手指往回越过原边界后，交还正常滚动，不继续拉另一侧。
      if ((edge === "top" && distance <= 0) || (edge === "bottom" && distance >= 0)) {
        reset();
        return;
      }
      if (event.cancelable) event.preventDefault();
      // 距离越大增量越小，并渐近 36px；不读取滚动速度，甩动不会带出额外惯性。
      const y = 36 * distance / (72 + Math.abs(distance));
      content.style.transform = `translate3d(0, ${y}px, 0)`;
    };
    const end = () => {
      finger = null;
      if (!edge) return;
      const from = content.style.transform;
      // 基础样式先归零，由短动画接住当前位移；结束或取消都只走 reset。
      content.style.removeProperty("transform");
      animation = content.animate(
        [{ transform: from }, { transform: "translate3d(0, 0, 0)" }],
        { duration: 220, easing: "ease-out" },
      );
      animation.onfinish = reset;
    };
    const stopKeyboard = onKeyboardViewportChange(() => {
      if (getKeyboardViewport().keyboardOpen) reset();
    });
    wall.addEventListener("touchstart", start, { passive: true });
    wall.addEventListener("touchmove", move, { passive: false });
    wall.addEventListener("touchend", end);
    wall.addEventListener("touchcancel", reset);
    window.addEventListener("popstate", reset);
    window.addEventListener("pagehide", reset);
    return () => {
      reset();
      stopKeyboard();
      wall.removeEventListener("touchstart", start);
      wall.removeEventListener("touchmove", move);
      wall.removeEventListener("touchend", end);
      wall.removeEventListener("touchcancel", reset);
      window.removeEventListener("popstate", reset);
      window.removeEventListener("pagehide", reset);
    };
  }, [scroll, board]);
  return () => stop.current();
}
