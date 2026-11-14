import {
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
} from "react";

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
const motion = { duration: 320, easing: "cubic-bezier(.22,.8,.3,1)" };
const transform = ({ x, y, scale }: Pose) =>
  `translate3d(${x}px,${y}px,0) scale(${scale})`;
const midpoint = (a: Point, b: Point) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// 手势只更新当前相纸的合成层，不触发聊天记录重渲染。
export function usePaperPreview(
  ready: boolean,
  image: boolean,
  onClose: () => void,
  onSave: () => void,
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const mask = useRef<HTMLDivElement>(null);
  const pose = useRef<Pose>({ x: 0, y: 0, scale: 1 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const closing = useRef(false);
  const hold = useRef<{ id: number; point: Point; timer: number } | null>(null);
  const saved = useRef(false);

  const cancelHold = () => {
    window.clearTimeout(hold.current?.timer);
    hold.current = null;
    paper.current!.style.scale = "1";
  };

  const opacity = (value: number) => {
    for (const element of [paper.current!, mask.current!])
      element.style.opacity = String(value);
  };
  const draw = () => {
    paper.current!.style.transform = transform(pose.current);
  };
  const finishAnimations = () => {
    for (const element of [paper.current!, mask.current!])
      element
        .getAnimations({ subtree: true })
        .forEach((animation) => animation.finish());
  };

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.focus({ preventScroll: true });
    mask.current!.animate([{ opacity: 0 }, { opacity: 1 }], motion);
    return () => {
      window.clearTimeout(hold.current?.timer);
      element.close();
    };
  }, []);

  useLayoutEffect(() => {
    if (!ready) return;
    const element = paper.current!;
    const animation = element.animate(
      [
        {
          transform: "translate3d(0,16px,0) scale(.96) rotate(1.2deg)",
          opacity: 0,
        },
        { transform: transform(pose.current), opacity: 1 },
      ],
      motion,
    );
    const sheets = Array.from(element.querySelectorAll(".pv-under"), (sheet) =>
      sheet.animate([{ opacity: 0 }, { opacity: 1 }], {
        ...motion,
        delay: 40,
        fill: "backwards",
      }),
    );
    return () => [animation, ...sheets].forEach((item) => item.cancel());
  }, [ready]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    cancelHold();
    const element = paper.current!;
    const before = getComputedStyle(element);
    const from = { transform: before.transform, opacity: before.opacity };
    const current = new DOMMatrix(from.transform);
    element.getAnimations().forEach((animation) => animation.cancel());
    const animation = element.animate(
      [
        from,
        {
          transform: transform({
            x: current.m41,
            y: current.m42 + 10,
            scale: Math.hypot(current.a, current.b) * 0.97,
          }),
          opacity: 0,
        },
      ],
      { ...motion, duration: 220, fill: "forwards" },
    );
    const layer = mask.current!;
    const alpha = getComputedStyle(layer).opacity;
    layer.getAnimations().forEach((item) => item.cancel());
    layer.animate([{ opacity: alpha }, { opacity: 0 }], {
      ...motion,
      duration: 220,
      fill: "forwards",
    });
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
      { duration: 240, easing: "cubic-bezier(.22,.61,.36,1)" },
    );
    mask.current!.animate([{ opacity: alpha }, { opacity: 1 }], {
      duration: 240,
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (closing.current || event.button !== 0) return;
    finishAnimations();
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    const target = event.target as Element;
    cancelHold();
    if (pointers.current.size === 1) {
      saved.current = false;
      if (!target.closest("a, button, input, textarea, select")) {
        paper.current!.style.scale = ".98";
        hold.current = {
          id: event.pointerId,
          point,
          timer: window.setTimeout(() => {
            saved.current = true;
            onSave();
          }, 1000),
        };
        if (event.pointerType === "mouse" && !target.closest(".scroll-text"))
          event.currentTarget.setPointerCapture(event.pointerId);
      }
    } else {
      gesture.current = null;
    }
    // 正文和长文件名保留自己的滚动，长按仍在捕获阶段计时。
    if (
      target.closest(
        ".scroll-text, .pv-file-content, a, button, input, textarea, select",
      )
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
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
    if (!pointers.current.has(event.pointerId) || closing.current) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (
      hold.current?.id === event.pointerId &&
      distance(point, hold.current.point) > 10
    )
      cancelHold();
    const start = gesture.current;
    if (!start) return;
    event.preventDefault();
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
    cancelHold();
    if (!gesture.current) return;
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
      gesture.current.kind === "drag" &&
      pose.current.y > 120;
    gesture.current = null;
    if (dismiss) close();
    else rebound();
  };

  return {
    dialog,
    paper,
    mask,
    close,
    gestures: {
      onPointerDownCapture: onPointerDown,
      onPointerMoveCapture: onPointerMove,
      onPointerUpCapture: end,
      onPointerCancelCapture: end,
      onContextMenu: (event: MouseEvent) => event.preventDefault(),
      onDragStart: (event: MouseEvent) => event.preventDefault(),
      onClickCapture: (event: MouseEvent) => {
        if (saved.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
  };
}
