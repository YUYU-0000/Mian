// 票根增删和重排只测量一次布局，再用合成层平移补位，不逐帧更新 React。
import { useLayoutEffect, useRef, type RefObject } from "react";

export function useTicketLayout(container: RefObject<HTMLElement | null>, ids: string, visible = true) {
  const previous = useRef(new Map<string, { x: number; y: number }>());
  const animations = useRef<{ animation: Animation; node: HTMLElement }[]>([]);
  const stop = () => {
    for (const { animation, node } of animations.current) {
      animation.onfinish = null;
      animation.cancel();
      node.style.removeProperty("will-change");
    }
    animations.current = [];
  };
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!visible) { stop(); previous.current.clear(); mounted.current = false; return; }
    const nodes = Array.from(container.current?.children ?? []) as HTMLElement[];
    // 先一次读完；快速连续增删时接上正在播放的位移，避免从旧起点跳回。
    const positions = nodes.map(node => {
      const transform = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return { node, id: node.dataset.id!, x: node.offsetLeft, y: node.offsetTop, dx: transform.m41, dy: transform.m42 };
    });
    stop();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const { node, id, x, y, dx, dy } of positions) {
      const before = previous.current.get(id);
      const entering = !before && mounted.current;
      const offsetX = before ? before.x + dx - x : 0;
      const offsetY = before ? before.y + dy - y : 8;
      if (reduced || (!entering && (!before || (!offsetX && !offsetY)))) continue;
      node.style.willChange = entering ? "transform, opacity" : "transform";
      const animation = node.animate([
        { transform: `translate3d(${offsetX}px, ${offsetY}px, 0)`, ...(entering ? { opacity: 0 } : {}) },
        { transform: "translate3d(0, 0, 0)", ...(entering ? { opacity: 1 } : {}) },
      ], { duration: 220, easing: "ease-out" });
      animation.onfinish = () => node.style.removeProperty("will-change");
      animations.current.push({ animation, node });
    }
    previous.current = new Map(positions.map(({ id, x, y }) => [id, { x, y }]));
    mounted.current = true;
  }, [ids, visible]);
  useLayoutEffect(() => stop, []);
  return () => Promise.allSettled(animations.current.map(({ animation }) => animation.finished));
}
