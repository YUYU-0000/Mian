// 提供纸片预览容器，协调内容显示、关闭手势和窗口尺寸。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fitPhoto } from "../filePreview";
import { getAppViewport, onAppResize } from "../appViewport";
import { notify } from "./Notify";
import { cachedFileUrl } from "../fileCache";
import { usePaperPreview } from "./usePaperPreview";
import "./file-preview.css";

export default function PaperPreview({
  label,
  children,
  footer,
  loaded = true,
  photo,
  download,
  onClose,
}: {
  label: string;
  children: ReactNode;
  footer: ReactNode;
  loaded?: boolean;
  photo?: { width: number; height: number; } | null;
  download?: { href: string; name: string; };
  onClose: () => void;
}) {
  const image = photo !== undefined;
  const [viewport, setViewport] = useState(getAppViewport);
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);
  const ready = loaded && availableHeight !== null;
  const downloadLink = useRef<HTMLAnchorElement>(null);
  const preview = usePaperPreview(ready, image, onClose, download ? async () => {
    try {
      if (download.href.startsWith("/api/")) {
        downloadLink.current!.href = await cachedFileUrl(download.href);
        downloadLink.current!.click();
      } else if (new URL(download.href, location.href).origin !== location.origin) {
        const response = await fetch(download.href, { referrerPolicy: "no-referrer" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const url = URL.createObjectURL(await response.blob());
        downloadLink.current!.href = url;
        downloadLink.current!.click();
        downloadLink.current!.href = download.href;
        URL.revokeObjectURL(url);
      } else downloadLink.current!.click();
      notify.ok("已保存");
    } catch (error) {
      notify.fail("保存失敗", error);
    }
  } : undefined);

  useLayoutEffect(() => {
    if (!loaded) return;
    const paper = preview.paper.current!;
    const card = paper.querySelector<HTMLElement>(".pv-card")!;
    const footer = paper.querySelector<HTMLElement>(".pv-foot")!;
    const padding = parseFloat(getComputedStyle(card).paddingTop);
    const bounds = paper.parentElement!.getBoundingClientRect();
    const overhang = Math.max(
      ...Array.from(paper.querySelectorAll<HTMLElement>(".pv-under, .pv-card"), element => {
        const transform = new DOMMatrix(getComputedStyle(element).transform);
        return transform.m42 + (Math.abs(transform.m12) * element.offsetWidth +
          (Math.abs(transform.m22) - 1) * element.offsetHeight) / 2;
      }),
    );
    // 隐藏链接继续标记原有预览下边界，文件和台词使用同一张相纸。
    setAvailableHeight(Math.min(viewport.height * 0.6,
      2 * (downloadLink.current!.getBoundingClientRect().top - bounds.top - bounds.height / 2 - padding - overhang)
      - padding - footer.offsetHeight));
  }, [loaded, viewport.width, viewport.height]);

  useEffect(() => onAppResize(() => setViewport(getAppViewport())), []);

  const size = photo && fitPhoto(photo.width, photo.height, viewport.width, viewport.height,
    availableHeight ?? viewport.height * 0.6);
  const style = {
    "--w": image && size ? `${size.width}px` : "calc(78vw - 32px)",
    "--r": photo ? `${photo.width} / ${photo.height}` : undefined,
    "--preview-height": availableHeight === null ? "calc(var(--app-h, 100svh) * .6)" : `${availableHeight}px`,
  } as CSSProperties;

  return createPortal(
    <dialog ref={preview.dialog} className="pv-viewer" tabIndex={-1} aria-label={label}
      onCancel={event => { event.preventDefault(); preview.close(); }}>
      <div className="pv-mask" ref={preview.mask} onClick={preview.close} />
      <div className={`pv${image ? " is-image" : " is-file"}${ready ? " is-ready" : ""}`} style={style}>
        <div className="pv-motion" ref={preview.paper} {...preview.gestures}>
          <div className="pv-under a" />
          <div className="pv-under b" />
          <div className="pv-card">
            {children}
            <div className="pv-foot">{footer}</div>
          </div>
        </div>
      </div>
      <a className="pv-download" ref={downloadLink} href={download?.href} download={download?.name}
        aria-hidden="true" tabIndex={-1} />
    </dialog>,
    document.body,
  );
}
