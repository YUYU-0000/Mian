import { useLayoutEffect, useRef, type CSSProperties } from "react";

export default function PortraitCaption({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const line = row.current!;
    const [label, signature] = Array.from(line.children) as HTMLElement[];
    const fit = () => {
      const scale = Math.min(
        1,
        (width - 16) / (label.offsetWidth + signature.offsetWidth + 4),
        (height - 16) / line.offsetHeight,
      );
      line.style.setProperty("--caption-scale", String(scale));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(label);
    observer.observe(signature);
    return () => observer.disconnect();
  }, [width, height]);

  return (
    <div
      className="portrait-caption"
      style={{ "--portrait-width": `${width}px` } as CSSProperties}
    >
      <div className="caption-line" ref={row}>
        <span>彼方肖像</span>
        <span>
          <i>Mian</i>
        </span>
      </div>
    </div>
  );
}
