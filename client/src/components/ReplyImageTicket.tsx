import { useMemo } from "react";
import { api } from "../api";
import type { ReplyImage } from "../replyImages";
import type { ChatFile } from "../types";
import FileTicket from "./FileTicket";

export default function ReplyImageTicket({
  image,
  conversationId,
  files,
  animate,
}: {
  image: ReplyImage;
  conversationId: string;
  files?: ChatFile[];
  animate: boolean;
}) {
  const stored = files?.find(
    (file) => api.fileUrl(conversationId, file.id, true) === image.src,
  );
  const file = useMemo(
    () =>
      stored ?? {
        id: image.src,
        name: image.alt || "圖片",
        size: 0,
        mimeType: "image/png",
        createdAt: new Date().toISOString(),
      },
    [stored, image.src, image.alt],
  );
  return (
    <FileTicket
      file={file}
      conversationId={conversationId}
      previewUrl={image.src}
      imageAlt={image.alt}
      hideSize={!stored}
      entryDelayMs={animate ? 0 : undefined}
    />
  );
}
