// 提供文字替换和逐字出现动画，切换中断时释放上一段动画。
import { useLayoutEffect, useRef } from "react";

export const textTransition = {
  out: {
    frames: [{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(1.25px)" }],
    options: { duration: 140, easing: "ease-out", fill: "forwards" as const },
  },
  incoming: {
    frames: [{ opacity: 0 }, { opacity: 1 }],
    options: { duration: 180, easing: "ease-out" },
  },
};

export default function AnimatedText({
  text,
  className = "",
  as: Tag = "span",
  revealCharacters = false,
  transitionKey = "",
}: {
  text: string;
  className?: string;
  as?: "span" | "tspan";
  revealCharacters?: boolean;
  transitionKey?: string | boolean;
}) {
  const ref = useRef<HTMLSpanElement | SVGTSpanElement>(null);
  const initial = useRef(text);
  const previousKey = useRef(transitionKey);
  useLayoutEffect(() => {
    const element = ref.current!;
    const changedMode = previousKey.current !== transitionKey;
    previousKey.current = transitionKey;
    const writeCharacters = (animate: boolean) => {
      if (!element.hasAttribute("data-reveal-characters")) {
        element.replaceChildren();
        element.setAttribute("data-reveal-characters", "");
      }
      const characters = Array.from(text);
      while (element.children.length > characters.length) element.lastElementChild!.remove();
      for (let index = element.children.length; index < characters.length; index++) {
        const character = document.createElement("span");
        character.textContent = characters[index];
        element.append(character);
        if (animate) {
          const incoming = character.animate(textTransition.incoming.frames, textTransition.incoming.options);
          incoming.onfinish = () => incoming.cancel();
        }
      }
    };
    if (revealCharacters && !changedMode) {
      writeCharacters(true);
      return;
    }
    if (element.textContent === text) return;
    let incoming: Animation | null = null;
    const out = element.animate(textTransition.out.frames, textTransition.out.options);
    const reveal = () => {
      out.onfinish = out.oncancel = null;
      out.cancel();
      element.textContent = text;
      element.removeAttribute("data-reveal-characters");
      if (revealCharacters) writeCharacters(false);
    };
    out.oncancel = reveal;
    out.onfinish = () => {
      reveal();
      incoming = element.animate(textTransition.incoming.frames, textTransition.incoming.options);
      incoming.onfinish = () => incoming!.cancel();
    };
    return () => {
      out.onfinish = out.oncancel = null;
      out.cancel();
      if (incoming) {
        incoming.onfinish = null;
        incoming.cancel();
      }
    };
  }, [text, revealCharacters, transitionKey]);
  return (
    <Tag ref={(node: HTMLSpanElement | SVGTSpanElement | null) => { ref.current = node; }} className={className}>
      {initial.current}
    </Tag>
  );
}
