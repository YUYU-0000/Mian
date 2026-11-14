import { lazy, memo, Suspense, useCallback, useRef, useState } from "react";
import { api } from "../api";
import { previewKind } from "../filePreview";
import type { ChatFile } from "../types";
import ScrollText from "./ScrollText";

const FilePreview = lazy(() => import("./FilePreview"));

export function fileSize(size: number) {
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
  pending = false,
  previewUrl,
}: {
  file: ChatFile;
  conversationId: string;
  mine?: boolean;
  progress?: number;
  pending?: boolean;
  previewUrl?: string;
}) {
  const [viewing, setViewing] = useState(false);
  const closePreview = useCallback(() => setViewing(false), []);
  const download = useRef<HTMLAnchorElement>(null);
  const kind = previewKind(file, navigator.pdfViewerEnabled);
  const image = file.mimeType.startsWith("image/");
  const size = fileSize(file.size);
  const extension = file.name.includes(".")
    ? file.name.split(".").at(-1)!.toUpperCase()
    : "FILE";
  const open = () => {
    if (pending && !image) return;
    if (kind) setViewing(true);
    else download.current!.click();
  };
  const nameAndMeta = (
    <>
      <div className="ft-kicker">
        {image ? "IMAGE · 圖片" : mine ? "SENT · 寄出" : "FILE · 檔案"}
      </div>
      <ScrollText className="ft-name">{file.name}</ScrollText>
      <div className="ft-meta">
        <span>
          <b>{size.value}</b> {size.unit}
        </span>
        {!image && (
          <span>
            {progress !== undefined
              ? `上傳中 ${progress}%`
              : pending
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
  return (
    <>
      <div
        className={`ft${mine ? " is-mine" : ""}${image ? " is-image" : ""}`}
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
        <div className="ft-body" />
        <div className="ft-main">
          {image ? (
            <>
              <div
                className="ft-thumb"
                style={{
                  backgroundImage: `url("${previewUrl ?? api.fileUrl(conversationId, file.id, true)}")`,
                }}
              />
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
        {progress !== undefined && (
          <div className="ft-progress">
            <i style={{ width: `${progress}%` }} />
          </div>
        )}
        <a
          ref={download}
          href={api.fileUrl(conversationId, file.id)}
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
            previewUrl={previewUrl}
            onClose={closePreview}
          />
        </Suspense>
      )}
    </>
  );
});
