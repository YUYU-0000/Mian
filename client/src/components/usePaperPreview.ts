import { useLayoutEffect, useRef, type PointerEvent } from "react";

export type PreviewOrigin = Pick<DOMRect, "left" | "top" | "width" | "height">;
type Point = { x: number; y: number };
type Pose = Point & { scale: number };
type Gesture =
  | { kind: "drag" | "pan"; point: Point; pose: Pose }
  | {
      kind: "pinch";
      distance: number;
      focus: Point;
      center: Point;
      scale: number;
    };
const motion = { duration: 400, easing: "cubic-bezier(.22,.61,.36,1)" };
const transform = ({ x, y, scale }: Pose) =>
  `translate3d(${x}px,${y}px,0) scale(${scale})`;
const midpoint = (a: Point, b: Point) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// 手势只更新当前相纸的合成层，不触发聊天记录重渲染。
export function usePaperPreview(
  origin: PreviewOrigin,
  ready: boolean,
  image: boolean,
  onClose: () => void,
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const mask = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const pose = useRef<Pose>({ x: 0, y: 0, scale: 1 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const closing = useRef(false);

  const opacity = (value: number) => {
    for (const element of [paper.current!, mask.current!, actions.current!])
      element.style.opacity = String(value);
  };
  const draw = () => {
    paper.current!.style.transform = transform(pose.current);
  };
  const finishAnimations = () => {
    for (const element of [paper.current!, mask.current!, actions.current!])
      element.getAnimations().forEach((animation) => animation.finish());
  };

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.focus({ preventScroll: true });
    for (const layer of [mask.current!, actions.current!])
      layer.animate([{ opacity: 0 }, { opacity: 1 }], motion);
    return () => element.close();
  }, []);

  useLayoutEffect(() => {
    if (!ready) return;
    const element = paper.current!;
    const rect = element.getBoundingClientRect();
    const x = origin.left + origin.width / 2 - rect.left - rect.width / 2;
    const y = origin.top + origin.height / 2 - rect.top - rect.height / 2;
    const scale = Math.min(1, origin.width / rect.width);
    const animation = element.animate(
      [
        {
          transform: `translate3d(${x}px,${y}px,0) scale(${scale}) rotate(-6deg)`,
          opacity: 0.3,
        },
        { transform: transform(pose.current), opacity: 1 },
      ],
      motion,
    );
    return () => animation.cancel();
  }, [ready, origin]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    finishAnimations();
    const element = paper.current!;
    const animation = element.animate(
      [
        {
          transform: transform(pose.current),
          opacity: getComputedStyle(element).opacity,
        },
        {
          transform: `translate3d(${pose.current.x}px,${pose.current.y + 60}px,0) scale(${pose.current.scale * 0.96}) rotate(2deg)`,
          opacity: 0,
        },
      ],
      { ...motion, duration: 200, fill: "forwards" },
    );
    for (const layer of [mask.current!, actions.current!])
      layer.animate(
        [{ opacity: getComputedStyle(layer).opacity }, { opacity: 0 }],
        { duration: 200, fill: "forwards" },
      );
    animation.onfinish = onClose;
  };

  const rebound = () => {
    const before = transform(pose.current);
    const alpha = getComputedStyle(paper.current!).opacity;
    const rect = paper.current!.parentElement!.getBoundingClientRect();
    const limitX = (rect.width * (pose.current.scale - 1)) / 2;
    const limitY = (rect.height * (pose.current.scale - 1)) / 2;
    pose.current.x = Math.max(-limitX, Math.min(limitX, pose.current.x));
    pose.current.y = Math.max(-limitY, Math.min(limitY, pose.current.y));
    draw();
    opacity(1);
    paper.current!.animate(
      [
        { transform: before, opacity: alpha },
        { transform: transform(pose.current), opacity: 1 },
      ],
      { ...motion, duration: 240 },
    );
    for (const layer of [mask.current!, actions.current!])
      layer.animate([{ opacity: alpha }, { opacity: 1 }], { duration: 240 });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      closing.current ||
      event.button !== 0 ||
      (event.target as Element).closest(
        ".scroll-text, .pv-file-content, a, button",
      )
    )
      return;
    finishAnimations();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (image && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = midpoint(a, b);
      const rect = event.currentTarget.parentElement!.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      gesture.current = {
        kind: "pinch",
        distance: distance(a, b),
        center,
        scale: pose.current.scale,
        focus: {
          x: (mid.x - center.x - pose.current.x) / pose.current.scale,
          y: (mid.y - center.y - pose.current.y) / pose.current.scale,
        },
      };
      opacity(1);
    } else if (pointers.current.size === 1) {
      gesture.current = {
        kind: pose.current.scale > 1 ? "pan" : "drag",
        point,
        pose: { ...pose.current },
      };
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (
      !pointers.current.has(event.pointerId) ||
      !gesture.current ||
      closing.current
    )
      return;
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    const start = gesture.current;
    if (start.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      const mid = midpoint(a, b);
      const scale = Math.max(
        1,
        Math.min(4, (start.scale * distance(a, b)) / start.distance),
      );
      pose.current = {
        scale,
        x: mid.x - start.center.x - start.focus.x * scale,
        y: mid.y - start.center.y - start.focus.y * scale,
      };
    } else if (start.kind === "pan") {
      pose.current = {
        ...start.pose,
        x: start.pose.x + point.x - start.point.x,
        y: start.pose.y + point.y - start.point.y,
      };
    } else {
      pose.current.y = Math.max(0, point.y - start.point.y);
      opacity(Math.max(0, 1 - pose.current.y / (window.innerHeight * 0.65)));
    }
    draw();
  };

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (pointers.current.size) {
      gesture.current = {
        kind: "pan",
        point: [...pointers.current.values()][0],
        pose: { ...pose.current },
      };
      return;
    }
    const dismiss =
      event.type !== "pointercancel" &&
      gesture.current?.kind === "drag" &&
      pose.current.y > 120;
    gesture.current = null;
    if (dismiss) close();
    else rebound();
  };

  return {
    dialog,
    paper,
    mask,
    actions,
    close,
    gestures: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}
