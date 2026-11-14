import { useLayoutEffect, useRef } from "react";

type AnimatedNode = HTMLElement & { _target?: string; _busy?: boolean };
export function setText(el: AnimatedNode, text: string) {
  el._target = text;
  if (el._busy || el.textContent === text) return;
  el._busy = true;
  el.getAnimations().forEach(animation => animation.cancel());
  const out = el.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(1.25px)" }], { duration: 140, easing: "ease-out", fill: "forwards" });
  const done = () => {
    el._busy = false;
    if (el.isConnected && el.textContent !== el._target) setText(el, el._target!);
  };
  out.finished.then(() => {
    el.textContent = el._target!;
    out.cancel();
    const incoming = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
    return incoming.finished.then(() => incoming.cancel());
  }).then(done, () => { out.cancel(); el.textContent = el._target!; done(); });
}

export default function AnimatedText({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const initial = useRef(text);
  useLayoutEffect(() => { setText(ref.current!, text); }, [text]);
  useLayoutEffect(() => () => { ref.current?.getAnimations().forEach(animation => animation.cancel()); }, []);
  return <span ref={ref} className={className}>{initial.current}</span>;
}
