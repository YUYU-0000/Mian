import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isScrollingText } from "./ScrollText";

export function useSettingsCarousel(count: number, voice = false) {
  const track = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const dragging = useRef(false);
  const dragged = useRef(false);
  const startX = useRef(0);
  const currentX = useRef(0);
  const update = () => {
    track.current!.style.transition = "transform 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.1)";
    track.current!.style.transform = `translateX(calc(-${index * 100}% - ${index * 16}px)) rotateZ(0deg)`;
    Array.from(track.current!.children).forEach((child, i) => {
      const page = child as HTMLElement;
      page.style.transition = "opacity 0.4s ease-in-out";
      page.style.opacity = i === index ? "1" : "0";
      if (voice) page.classList.toggle("current", i === index);
      else page.style.pointerEvents = i === index ? "auto" : "none";
    });
  };
  useLayoutEffect(update, [index, count]);
  const start = (x: number, target: EventTarget) => {
    if (isScrollingText(target)) return;
    if (
      (target as Element).closest(
        voice
          ? "input, .vc-stub, .vc-add, .vc-del"
          : "input, .apiBtnAdd, .apiBtnDel, .btnSaveStyle, .btnTestStyle",
      )
    )
      return;
    startX.current = currentX.current = x;
    dragging.current = true;
    dragged.current = false;
    track.current!.style.transition = "none";
    Array.from(track.current!.children).forEach(
      (page) => ((page as HTMLElement).style.transition = "none"),
    );
  };
  const move = (x: number) => {
    if (!dragging.current) return;
    currentX.current = x;
    let diff = x - startX.current;
    if (Math.abs(diff) > 6) dragged.current = true;
    if (index === 0 && diff > 0) diff *= 0.4;
    if (index === count - 1 && diff < 0) diff *= 0.4;
    track.current!.style.transform = `translateX(calc(-${index * 100}% - ${index * 16}px + ${diff}px)) rotateZ(${diff * 0.012}deg)`;
    const ratio = diff / (viewport.current!.clientWidth || 340);
    Array.from(track.current!.children).forEach((page, i) => {
      const progress = Math.abs(i - index + ratio);
      const opacity = progress > 0.75 ? 1 - (progress - 0.75) * 4 : 1;
      (page as HTMLElement).style.opacity = String(Math.max(0, Math.min(1, opacity)));
    });
  };
  const end = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const diff = currentX.current - startX.current;
    if (diff < -40 && index < count - 1) setIndex(index + 1);
    else if (diff > 40 && index > 0) setIndex(index - 1);
    else update();
    startX.current = currentX.current = 0;
  };
  useEffect(() => {
    const mousemove = (event: MouseEvent) => move(event.clientX);
    window.addEventListener("mousemove", mousemove);
    window.addEventListener("mouseup", end);
    return () => {
      window.removeEventListener("mousemove", mousemove);
      window.removeEventListener("mouseup", end);
    };
  }, [index, count]);
  return {
    track,
    viewport,
    index,
    setIndex,
    dragged,
    handlers: {
      onTouchStart: (event: React.TouchEvent) =>
        start(event.touches[0].clientX, event.target),
      onTouchMove: (event: React.TouchEvent) => move(event.touches[0].clientX),
      onTouchEnd: end,
      onMouseDown: (event: React.MouseEvent) => start(event.clientX, event.target),
    },
  };
}
