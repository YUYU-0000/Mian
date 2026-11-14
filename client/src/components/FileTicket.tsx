import { lazy, memo, Suspense, useCallback, useRef, useState } from "react";
import { api } from "../api";
import { previewKind } from "../filePreview";
import type { ChatFile } from "../types";
import ScrollText from "./ScrollText";
import type { PreviewOrigin } from "./usePaperPreview";

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
  getNumber,
}: {
  file: ChatFile;
  conversationId: string;
  mine?: boolean;
  progress?: number;
  pending?: boolean;
  getNumber?: () => number;
}) {
  const [viewing, setViewing] = useState<{
    origin: PreviewOrigin;
    number: number;
  } | null>(null);
  const ticket = useRef<HTMLDivElement>(null);
  const closePreview = useCallback(() => setViewing(null), []);
  const download = useRef<HTMLAnchorElement>(null);
  const kind = previewKind(file, navigator.pdfViewerEnabled);
  const image = file.mimeType.startsWith("image/");
  const thumbnail = image && !mine;
  const size = fileSize(file.size);
  const extension = file.name.includes(".")
    ? file.name.split(".").at(-1)!.toUpperCase()
    : "FILE";
  const open = () => {
    if (pending) return;
    if (kind)
      setViewing({
        origin: ticket.current!.getBoundingClientRect(),
        number: getNumber?.() ?? 1,
      });
    else download.current!.click();
  };
  const nameAndMeta = (
    <>
      <div className="ft-kicker">
        {mine ? "SENT · 寄出" : image ? "IMAGE · 圖片" : "FILE · 檔案"}
      </div>
      <ScrollText className="ft-name">{file.name}</ScrollText>
      <div className="ft-meta">
        <span>
          <b>{size.value}</b> {size.unit}
        </span>
        {!thumbnail && (
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
        {!mine && <span className="ft-act">{kind ? "查看" : "下載"}</span>}
      </div>
    </>
  );
  return (
    <>
      <div
        ref={ticket}
        className={`ft${mine ? " is-mine" : ""}${thumbnail ? " is-image" : ""}`}
        role={pending ? undefined : "button"}
        tabIndex={pending ? undefined : 0}
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
          {thumbnail ? (
            <>
              <div
                className="ft-thumb"
                style={{
                  backgroundImage: `url("${api.fileUrl(conversationId, file.id, true)}")`,
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
            number={viewing.number}
            origin={viewing.origin}
            onClose={closePreview}
          />
        </Suspense>
      )}
    </>
  );
});
