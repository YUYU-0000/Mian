import { lazy, memo, Suspense, useState } from "react";
import type { ReplyCode as Code } from "../replyMarkup";
import HtmlPreview from "./HtmlPreview";
import ChineseText from "./ChineseText";
import { notify } from "./Notify";

// 第一段代码出现时才下载高亮器，加载期间保留完整代码。
const CodeHighlight = lazy(() => import("./CodeHighlight"));

// 局域网 HTTP 没有 Clipboard API，使用浏览器复制命令。
async function copyCode(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const previous = document.activeElement as HTMLElement | null;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  previous?.focus({ preventScroll: true });
  if (!copied) throw new Error("瀏覽器未能複製這段程式碼。");
}

export default memo(function ReplyCode({
  text,
  language,
  typing,
}: Code & { typing: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div className="reply-code">
      <div className="reply-code-head">
        <span>{language || "text"}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await copyCode(text);
              notify.ok("已複製");
            } catch (error) {
              notify.fail("複製失敗", error);
            }
          }}
        >
          複製
        </button>
      </div>
      <pre>
        <code>
          <Suspense fallback={<ChineseText text={text} />}>
            <CodeHighlight text={text} language={language} />
          </Suspense>
          {typing && <span className="cursor-blink" />}
        </code>
      </pre>
      {language === "html" && (
        <div className="reply-code-preview">
          <button
            type="button"
            aria-expanded={preview !== null}
            onClick={() => setPreview(preview === null ? text : null)}
          >
            {preview === null ? "預覽" : "收起"}
          </button>
          {preview !== null && <HtmlPreview source={preview} />}
        </div>
      )}
    </div>
  );
});
