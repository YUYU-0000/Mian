import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";

// 预览中的脚本也先消毒，只注入回报高度的脚本。
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
    const html = DOMPurify.sanitize(source, {
      WHOLE_DOCUMENT: true,
      ADD_TAGS: ["style"],
      FORBID_TAGS: ["iframe"],
    });
    return html.replace(/<\/body>/i, `${resizeScript}</body>`);
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
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ height }}
    />
  );
}
