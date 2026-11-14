import {
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent,
  type PointerEvent,
} from "react";

export function isScrollingText(target: EventTarget | null) {
  const text = (target as Element).closest<HTMLElement>(".scroll-text");
  return !!text && text.scrollWidth > text.clientWidth;
}

// 横拖文字由这一层接管，竖向手势继续交给页面。
function useTextScroll<T extends HTMLElement>(content: unknown) {
  const ref = useRef<T>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
  } | null>(null);
  const moved = useRef(false);
  const measure = () => {
    const text = ref.current!;
    text.classList.toggle(
      "is-overflowing",
      text.scrollWidth > text.clientWidth,
    );
  };
  useLayoutEffect(() => {
    const text = ref.current!;
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    if (text.firstElementChild) observer.observe(text.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, [content]);
  const end = () => {
    drag.current = null;
  };
  return {
    ref,
    onInput: measure,
    onPointerDown: (event: PointerEvent<T>) => {
      moved.current = false;
      if (event.button !== 0 || !isScrollingText(event.currentTarget)) return;
      event.stopPropagation();
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: event.currentTarget.scrollLeft,
      };
    },
    onPointerMove: (event: PointerEvent<T>) => {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!moved.current) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= 6) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          end();
          return;
        }
        moved.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.scrollLeft = start.left - dx;
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: (event: MouseEvent<T>) => {
      if (moved.current && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}

export default function ScrollText({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  const scroll = useTextScroll<HTMLSpanElement>(children);
  return (
    <span {...props} {...scroll} className={`scroll-text ${className}`}>
      <span className="scroll-text-content">{children}</span>
    </span>
  );
}

export function ScrollInput({
  className = "",
  onInput,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const scroll = useTextScroll<HTMLInputElement>(
    props.value ?? props.defaultValue,
  );
  return (
    <input
      {...props}
      {...scroll}
      className={`scroll-text ${className}`}
      onInput={(event) => {
        scroll.onInput();
        onInput?.(event);
      }}
    />
  );
}
