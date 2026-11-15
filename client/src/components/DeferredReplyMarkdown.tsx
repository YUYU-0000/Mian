import { lazy, Suspense } from "react";
import { stripProtocolMarkers } from "../replyProtocol";
import type { ReplyMarkdownProps } from "./ReplyMarkdown";

let markdownModule: Promise<typeof import("./ReplyMarkdown")> | null = null;

// 空闲预载、入口点击和实际渲染共用一次下载。
export function preloadReplyMarkdown() {
  return (markdownModule ??= import("./ReplyMarkdown"));
}

const MarkdownContent = lazy(preloadReplyMarkdown);

export default function DeferredReplyMarkdown(props: ReplyMarkdownProps) {
  const text = stripProtocolMarkers(props.text);
  const fallbackText = props.bubble ? text.split("![")[0] : text;
  const fallback = (
    <div className="reply-markdown" style={{ whiteSpace: "pre-wrap" }}>
      {fallbackText}
      {props.typing && <span className="cursor-blink" />}
    </div>
  );
  return (
    <Suspense
      fallback={
        props.bubble
          ? fallbackText.trim() && (
              <div
                className={props.bubble.className}
                data-timeline-kind="ASSISTANT_BUBBLE"
              >
                {fallback}
              </div>
            )
          : fallback
      }
    >
      <MarkdownContent {...props} />
    </Suspense>
  );
}
