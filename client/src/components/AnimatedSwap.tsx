import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { textTransition } from "./AnimatedText";

// 非文字内容沿用 AnimatedText 的切换节奏，淡出完成后再换内容。
export default function AnimatedSwap<T extends string>({ value, children, className }: {
  value: T;
  children: (displayed: T) => ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [displayed, setDisplayed] = useState(value);
  const swapped = useRef(false);
  useLayoutEffect(() => {
    if (displayed === value) {
      if (!swapped.current) return;
      swapped.current = false;
      const incoming = root.current!.animate(textTransition.incoming.frames, textTransition.incoming.options);
      return () => incoming.cancel();
    }
    const out = root.current!.animate(textTransition.out.frames, textTransition.out.options);
    out.onfinish = () => {
      swapped.current = true;
      setDisplayed(value);
    };
    return () => { out.onfinish = null; out.cancel(); };
  }, [displayed, value]);
  return <div ref={root} className={className}>{children(displayed)}</div>;
}
