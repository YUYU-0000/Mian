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

type AnimatedNode = Element & { _target?: string; _busy?: boolean };
function setText(el: AnimatedNode, text: string) {
  el._target = text;
  if (el._busy || el.textContent === text) return;
  el._busy = true;
  el.getAnimations().forEach((animation) => animation.cancel());
  const out = el.animate(textTransition.out.frames, textTransition.out.options);
  const done = () => {
    el._busy = false;
    if (el.isConnected && el.textContent !== el._target) setText(el, el._target!);
  };
  out.finished
    .then(() => {
      el.textContent = el._target!;
      out.cancel();
      const incoming = el.animate(textTransition.incoming.frames, textTransition.incoming.options);
      return incoming.finished.then(() => incoming.cancel());
    })
    .then(done, () => {
      out.cancel();
      el.textContent = el._target!;
      done();
    });
}

export default function AnimatedText({
  text,
  className = "",
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  as?: "span" | "tspan";
}) {
  const ref = useRef<HTMLSpanElement | SVGTSpanElement>(null);
  const initial = useRef(text);
  useLayoutEffect(() => {
    setText(ref.current!, text);
  }, [text]);
  useLayoutEffect(
    () => () => {
      ref.current?.getAnimations().forEach((animation) => animation.cancel());
    },
    [],
  );
  return (
    <Tag ref={(node: HTMLSpanElement | SVGTSpanElement | null) => { ref.current = node; }} className={className}>
      {initial.current}
    </Tag>
  );
}
