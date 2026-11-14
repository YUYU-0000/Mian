import { lazy, Suspense } from "react";
import { stripProtocolMarkers } from "../chatModel";

let markdownModule: Promise<typeof import("./ReplyMarkdown")> | null = null;

// 空闲预载、入口点击和实际渲染共用一次下载。
export function preloadReplyMarkdown() {
  return (markdownModule ??= import("./ReplyMarkdown"));
}

const MarkdownContent = lazy(preloadReplyMarkdown);

export default function DeferredReplyMarkdown(props: {
  text: string;
  typing: boolean;
}) {
  return (
    <Suspense
      fallback={
        <div className="reply-markdown" style={{ whiteSpace: "pre-wrap" }}>
          {stripProtocolMarkers(props.text)}
          {props.typing && <span className="cursor-blink" />}
        </div>
      }
    >
      <MarkdownContent {...props} />
    </Suspense>
  );
}
