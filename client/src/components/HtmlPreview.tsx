import { useEffect, useMemo, useRef, useState } from "react";

// 预览保留原始页面，在独立 sandbox 中执行，并回报内容高度。
const resizeScript = `<script>
(() => {
  let frame;
  const report = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const body = document.body;
      const style = getComputedStyle(body);
      const height = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height) + parseFloat(style.marginTop) + parseFloat(style.marginBottom));
      parent.postMessage({ type: 'mian-preview-height', height }, '*');
    });
  };
  new ResizeObserver(report).observe(document.body);
  addEventListener('load', report);
  report();
})();
</script>`;

export default function HtmlPreview({ source }: { source: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1);
  const srcDoc = useMemo(() => {
    return /<\/body>/i.test(source)
      ? source.replace(/<\/body>/i, (closingBody) => resizeScript + closingBody)
      : source + resizeScript;
  }, [source]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "mian-preview-height"
      )
        return;
      if (
        typeof event.data.height === "number" &&
        Number.isFinite(event.data.height)
      )
        setHeight(Math.max(1, Math.min(480, event.data.height)));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return (
    <iframe
      ref={frame}
      title="HTML 預覽"
      sandbox="allow-scripts allow-forms allow-modals allow-popups"
      srcDoc={srcDoc}
      style={{ height }}
    />
  );
}
