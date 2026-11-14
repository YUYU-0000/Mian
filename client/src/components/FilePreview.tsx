import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useLayoutEffect,
  useState,
  useRef,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { pad2 } from "../format";
import { fileLanguage, fitPhoto, type PreviewKind } from "../filePreview";
import type { ChatFile } from "../types";
import { HTML_PREVIEW_SANDBOX } from "./HtmlPreview";
import ReplyMarkdown from "./DeferredReplyMarkdown";
import ScrollText from "./ScrollText";
import { notify } from "./Notify";
import { usePaperPreview } from "./usePaperPreview";

export default function FilePreview({
  file,
  conversationId,
  kind,
  previewUrl,
  onClose,
}: {
  file: ChatFile;
  conversationId: string;
  kind: PreviewKind;
  previewUrl?: string;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const image = kind === "image";
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);
  const loaded = image ? photo !== null : kind === "pdf" || text !== null;
  const ready = loaded && availableHeight !== null;
  const download = useRef<HTMLAnchorElement>(null);
  const preview = usePaperPreview(ready, image, onClose, () => {
    download.current!.click();
    notify.ok("已保存");
  });
  useLayoutEffect(() => {
    if (!loaded) return;
    const paper = preview.paper.current!;
    const card = paper.querySelector<HTMLElement>(".pv-card")!;
    const footer = paper.querySelector<HTMLElement>(".pv-foot")!;
    const padding = parseFloat(getComputedStyle(card).paddingTop);
    const bounds = paper.parentElement!.getBoundingClientRect();
    const overhang = Math.max(
      ...Array.from(
        paper.querySelectorAll<HTMLElement>(".pv-under, .pv-card"),
        (element) => {
          const transform = new DOMMatrix(getComputedStyle(element).transform);
          return (
            transform.m42 +
            (Math.abs(transform.m12) * element.offsetWidth +
              (Math.abs(transform.m22) - 1) * element.offsetHeight) /
              2
          );
        },
      ),
    );
    // 保留原有下边界，移除保存按钮不改变相纸尺寸。
    setAvailableHeight(
      Math.min(
        viewport.height * 0.6,
        2 *
          (download.current!.getBoundingClientRect().top -
            bounds.top -
            bounds.height / 2 -
            padding -
            overhang) -
          padding -
          footer.offsetHeight,
      ),
    );
  }, [loaded, viewport.width, viewport.height]);
  const CodeHighlight = useMemo(
    () =>
      lazy(async () => {
        const module = await import("./CodeHighlight");
        await module.loadFileLanguage(fileLanguage(file.name));
        return module;
      }),
    [file.name],
  );

  useEffect(() => {
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (image || kind === "pdf") return;
    const controller = new AbortController();
    void api
      .fileText(conversationId, file.id, controller.signal)
      .then(setText)
      .catch((error) => {
        if (!controller.signal.aborted) {
          notify.fail("預覽失敗", error);
          onClose();
        }
      });
    return () => controller.abort();
  }, [conversationId, file.id, image, kind, onClose]);

  const size =
    photo &&
    fitPhoto(
      photo.width,
      photo.height,
      viewport.width,
      viewport.height,
      availableHeight ?? viewport.height * 0.6,
    );
  const style = {
    "--w": image && size ? `${size.width}px` : "calc(78vw - 32px)",
    "--r": photo ? `${photo.width} / ${photo.height}` : undefined,
    "--preview-height":
      availableHeight === null ? "60vh" : `${availableHeight}px`,
  } as CSSProperties;
  const date = new Date(file.createdAt);
  const label = image ? "IMAGE · 圖片" : "FILE · 檔案";

  return createPortal(
    <dialog
      ref={preview.dialog}
      className="pv-viewer"
      tabIndex={-1}
      aria-label={`${image ? "圖片" : "文件"}查看：${file.name}`}
      onCancel={(event) => {
        event.preventDefault();
        preview.close();
      }}
    >
      <div className="pv-mask" ref={preview.mask} onClick={preview.close} />
      <div
        className={`pv${image ? " is-image" : " is-file"}${ready ? " is-ready" : ""}`}
        style={style}
      >
        <div className="pv-motion" ref={preview.paper} {...preview.gestures}>
          <div className="pv-under a" />
          <div className="pv-under b" />
          <div className="pv-card">
            {image ? (
              <img
                className="pv-photo"
                src={previewUrl ?? api.fileUrl(conversationId, file.id, true)}
                alt={file.name}
                draggable={false}
                onLoad={(event) =>
                  setPhoto({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                onError={() => {
                  notify.fail("圖片讀取失敗", "圖片無法載入。");
                  onClose();
                }}
              />
            ) : (
              <div className="pv-photo pv-document">
                <div className="pv-file-head">
                  <div className="pv-kicker">{label}</div>
                  <ScrollText className="pv-name">{file.name}</ScrollText>
                </div>
                <div className="pv-file-content">
                  {kind === "pdf" ? (
                    <iframe
                      className="pv-file-frame"
                      title={file.name}
                      src={api.fileUrl(conversationId, file.id, true)}
                    />
                  ) : kind === "html" ? (
                    text !== null && (
                      <iframe
                        className="pv-file-frame"
                        title={file.name}
                        srcDoc={text}
                        sandbox={HTML_PREVIEW_SANDBOX}
                      />
                    )
                  ) : kind === "markdown" ? (
                    <div className="pv-markdown">
                      <ReplyMarkdown text={text ?? ""} typing={false} />
                    </div>
                  ) : (
                    <div className="pv-source reply-code">
                      <pre>
                        <code>
                          <Suspense fallback={text}>
                            <CodeHighlight
                              text={text ?? ""}
                              language={fileLanguage(file.name)}
                            />
                          </Suspense>
                        </code>
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="pv-foot">
              <div className="pv-info">
                {image && (
                  <>
                    <div className="pv-kicker">{label}</div>
                    <ScrollText className="pv-name">{file.name}</ScrollText>
                  </>
                )}
              </div>
              <div className="pv-hand">
                {pad2(date.getMonth() + 1)}.{pad2(date.getDate())}
              </div>
            </div>
          </div>
        </div>
      </div>
      <a
        className="pv-download"
        ref={download}
        href={previewUrl ?? api.fileUrl(conversationId, file.id)}
        download={file.name}
        aria-hidden="true"
        tabIndex={-1}
      />
    </dialog>,
    document.body,
  );
}
