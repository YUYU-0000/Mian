import { lazy, memo, Suspense, useCallback, useRef, useState } from "react";
import { api } from "../api";
import { cachedFileUrl } from "../fileCache";
import { useCachedFile } from "../useCachedFile";
import { notify } from "./Notify";
import { previewKind } from "../filePreview";
import { cacheLazyImport } from "../lazyImport";
import type { ChatFile } from "../types";
import ScrollText from "./ScrollText";

const FilePreview = lazy(
  cacheLazyImport("file-preview", () => import("./FilePreview")),
);

function fileSize(size: number) {
  if (size < 1024) return { value: String(size), unit: "B" };
  if (size < 1024 * 1024)
    return { value: (size / 1024).toFixed(1), unit: "KB" };
  return { value: (size / (1024 * 1024)).toFixed(1), unit: "MB" };
}

export default memo(function FileTicket({
  file,
  conversationId,
  mine = false,
  progress,
  uploadComplete = false,
  pending = false,
  previewUrl,
  entryDelayMs,
  imageAlt,
  hideSize = false,
}: {
  file: ChatFile;
  conversationId: string;
  mine?: boolean;
  progress?: number;
  uploadComplete?: boolean;
  pending?: boolean;
  previewUrl?: string;
  entryDelayMs?: number;
  imageAlt?: string;
  hideSize?: boolean;
}) {
  const [viewing, setViewing] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [showProgress, setShowProgress] = useState(() => pending && progress !== undefined && !uploadComplete);
  const closePreview = useCallback(() => setViewing(false), []);
  const download = useRef<HTMLAnchorElement>(null);
  const kind = previewKind(file, navigator.pdfViewerEnabled);
  const image = file.mimeType.startsWith("image/");
  const sourceUrl = previewUrl ?? api.fileUrl(conversationId, file.id);
  const cachedUrl = useCachedFile(sourceUrl, !pending && sourceUrl.startsWith("/api/"));
  const displayUrl = sourceUrl.startsWith("/api/") ? cachedUrl : previewUrl;
  const size = fileSize(file.size);
  const extension = file.name.includes(".")
    ? file.name.split(".").at(-1)!.toUpperCase()
    : imageAlt !== undefined
      ? "IMAGE"
      : "FILE";
  const open = async () => {
    if (pending && !image) return;
    if (kind) setViewing(true);
    else {
      try {
        download.current!.href = previewUrl ?? await cachedFileUrl(api.fileUrl(conversationId, file.id));
        download.current!.click();
      } catch (error) { notify.fail("文件讀取失敗", error); }
    }
  };
  const nameAndMeta = (
    <>
      <div className="ft-kicker">
        {image ? "IMAGE  圖片" : mine ? "SENT  寄出" : "FILE  檔案"}
      </div>
      <ScrollText className="ft-name">{file.name}</ScrollText>
      <div className="ft-meta">
        {!hideSize && (
          <span>
            <b>{size.value}</b> {size.unit}
          </span>
        )}
        {!image && (
          <span>
            {pending
                ? "待寄出"
                : new Date(file.createdAt).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
          </span>
        )}
        {(!mine || image) && (
          <span className="ft-act">{kind ? "查看" : "下載"}</span>
        )}
      </div>
    </>
  );
  if (imageAlt !== undefined && (imageFailed || !previewUrl)) {
    return (
      <a
        className="reply-image-failure"
        href={previewUrl || undefined}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
      >
        <span>圖片載入失敗</span>
        {imageAlt && <small>{imageAlt}</small>}
      </a>
    );
  }
  return (
    <>
      <div
        className={`ft${mine ? " is-mine" : ""}${image ? " is-image" : ""}${entryDelayMs !== undefined ? " archive-pop-in" : ""}`}
        style={
          entryDelayMs === undefined
            ? undefined
            : { animationDelay: `${entryDelayMs}ms`, willChange: "transform, opacity" }
        }
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.style.removeProperty("will-change");
        }}
        role={pending && !image ? undefined : "button"}
        tabIndex={pending && !image ? undefined : 0}
        aria-label={`${kind ? "查看" : "下載"} ${file.name}`}
        onClick={(event) => {
          if (!(event.target as Element).closest("a")) open();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
      >
        <div className="ft-body">
          {showProgress && pending && progress !== undefined && (
            <div className={`ft-progress${uploadComplete ? " is-complete" : ""}`}
              style={{ transform: `scaleX(${progress / 100})` }} aria-hidden="true"
              onTransitionEnd={event => {
                if (event.propertyName === "opacity" && uploadComplete) setShowProgress(false);
              }} />
          )}
        </div>
        <div className="ft-main">
          {image ? (
            <>
              {imageAlt !== undefined ? (
                <img
                  className="ft-thumb"
                  src={displayUrl}
                  alt={imageAlt}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <div
                  className="ft-thumb"
                  style={{
                    backgroundImage: displayUrl ? `url("${displayUrl}")` : undefined,
                  }}
                />
              )}
              <div className="ft-col">{nameAndMeta}</div>
            </>
          ) : (
            nameAndMeta
          )}
        </div>
        <div className="ft-perf" />
        <div className="ft-stub">
          <span className="ft-ext">{extension}</span>
        </div>
        <a
          ref={download}
          href={displayUrl}
          download={file.name}
          hidden
        />
      </div>
      {viewing && kind && (
        <Suspense fallback={null}>
          <FilePreview
            file={file}
            conversationId={conversationId}
            kind={kind}
            previewUrl={displayUrl}
            onImageError={
              imageAlt === undefined ? undefined : () => setImageFailed(true)
            }
            onClose={closePreview}
          />
        </Suspense>
      )}
    </>
  );
});
