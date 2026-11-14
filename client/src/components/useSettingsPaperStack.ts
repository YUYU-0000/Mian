import { useLayoutEffect, useRef, useState } from "react";
import { makeStack, type PaperStack } from "./paperStack";
import { isScrollingText } from "./ScrollText";

// 设置页只管理页数与选中页，拖动和翻页交给共用纸堆。
export function useSettingsPaperStack(count: number, open: boolean) {
  const track = useRef<HTMLDivElement>(null);
  const stack = useRef<PaperStack>(null);
  const [index, setIndex] = useState(0);
  const focus = useRef<{ index: number; animate: boolean } | null>(null);
  const removal = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const viewport = track.current!.parentElement!;
    const controller = makeStack(track.current!, (next) => {
      setIndex(next);
      const remove = removal.current;
      removal.current = null;
      remove?.();
    });
    stack.current = controller;
    const controlPointer = (event: PointerEvent) => {
      if (
        (event.target as Element).closest(
          "button, .apiBtnAdd, .apiBtnDel, .action-btn, .vc-stub, .video-play-btn",
        ) &&
        !isScrollingText(event.target)
      ) {
        controller.dragged = false;
        event.stopPropagation();
      }
    };
    viewport.addEventListener("pointerdown", controlPointer, true);
    window.addEventListener("resize", controller.update);
    return () => {
      viewport.removeEventListener("pointerdown", controlPointer, true);
      window.removeEventListener("resize", controller.update);
      controller.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    const controller = stack.current!;
    const target = focus.current;
    focus.current = null;
    controller.index =
      target && !target.animate
        ? target.index
        : Math.min(controller.index, count - 1);
    controller.update();
    if (target?.animate) controller.goTo(target.index);
  }, [count, open]);

  return {
    track,
    index,
    showAdded: () => {
      focus.current = { index: count, animate: true };
    },
    remove: (commit: () => void) => {
      const current = stack.current!.index;
      removal.current = () => {
        focus.current = { index: Math.max(0, current - 1), animate: false };
        commit();
      };
      // 先抽走或盖回相邻纸片，再移除已离开的页。
      stack.current!.goTo(current > 0 ? current - 1 : 1);
    },
  };
}
