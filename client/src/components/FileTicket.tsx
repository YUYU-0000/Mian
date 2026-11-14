import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { ChatFile } from "../types";
import ScrollText from "./ScrollText";

export function fileSize(size: number) {
  if (size < 1024) return { value: String(size), unit: "B" };
  if (size < 1024 * 1024)
    return { value: (size / 1024).toFixed(1), unit: "KB" };
  return { value: (size / (1024 * 1024)).toFixed(1), unit: "MB" };
}

function ImageViewer({
  file,
  conversationId,
  onClose,
}: {
  file: ChatFile;
  conversationId: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="file-image-viewer"
      aria-label={file.name}
      onClose={onClose}
    >
      <div className="file-image-actions">
        <ScrollText>{file.name}</ScrollText>
        <a href={api.fileUrl(conversationId, file.id)} download={file.name}>
          保存
        </a>
        <button type="button" onClick={onClose} aria-label="關閉圖片">
          關閉
        </button>
      </div>
      <img src={api.fileUrl(conversationId, file.id, true)} alt={file.name} />
    </dialog>,
    document.body,
  );
}

export default memo(function FileTicket({
  file,
  conversationId,
  mine = false,
  progress,
  pending = false,
}: {
  file: ChatFile;
  conversationId: string;
  mine?: boolean;
  progress?: number;
  pending?: boolean;
}) {
  const [viewing, setViewing] = useState(false);
  const download = useRef<HTMLAnchorElement>(null);
  const image = file.mimeType.startsWith("image/");
  const thumbnail = image && !mine;
  const size = fileSize(file.size);
  const extension = file.name.includes(".")
    ? file.name.split(".").at(-1)!.toUpperCase()
    : "FILE";
  const open = () => {
    if (pending) return;
    if (image) setViewing(true);
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
        {!mine && <span className="ft-act">{image ? "查看" : "下載"}</span>}
      </div>
    </>
  );
  return (
    <>
      <div
        className={`ft${mine ? " is-mine" : ""}${thumbnail ? " is-image" : ""}`}
        role={pending ? undefined : "button"}
        tabIndex={pending ? undefined : 0}
        aria-label={`${image ? "查看" : "下載"} ${file.name}`}
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
      {viewing && (
        <ImageViewer
          file={file}
          conversationId={conversationId}
          onClose={() => setViewing(false)}
        />
      )}
    </>
  );
});
