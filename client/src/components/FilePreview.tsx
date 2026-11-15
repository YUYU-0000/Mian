import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../api";
import { pad2 } from "../format";
import { fileLanguage, type PreviewKind } from "../filePreview";
import { cacheLazyImport } from "../lazyImport";
import type { ChatFile } from "../types";
import { HTML_PREVIEW_SANDBOX } from "./HtmlPreview";
import ReplyMarkdown from "./DeferredReplyMarkdown";
import ScrollText from "./ScrollText";
import { notify } from "./Notify";
import PaperPreview from "./PaperPreview";

export default function FilePreview({
  file,
  conversationId,
  kind,
  previewUrl,
  onImageError,
  onClose,
}: {
  file: ChatFile;
  conversationId: string;
  kind: PreviewKind;
  previewUrl?: string;
  onImageError?: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ width: number; height: number } | null>(
    null,
  );
  const image = kind === "image";
  const loaded = image ? photo !== null : kind === "pdf" || text !== null;
  const CodeHighlight = useMemo(
    () =>
      lazy(
        cacheLazyImport(`file-language:${fileLanguage(file.name)}`, async () => {
          const module = await import("./CodeHighlight");
          await module.loadFileLanguage(fileLanguage(file.name));
          return module;
        }),
      ),
    [file.name],
  );

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

  const date = new Date(file.createdAt);
  const label = image ? "IMAGE  圖片" : "FILE  檔案";

  return (
    <PaperPreview label={`${image ? "圖片" : "文件"}查看：${file.name}`} loaded={loaded}
      photo={image ? photo : undefined} onClose={onClose}
      download={{ href: previewUrl ?? api.fileUrl(conversationId, file.id), name: file.name }}
      footer={<>
        <div className="pv-info">
          {image && <>
            <div className="pv-kicker">{label}</div>
            <ScrollText className="pv-name">{file.name}</ScrollText>
          </>}
        </div>
        <div className="pv-hand">{pad2(date.getMonth() + 1)}.{pad2(date.getDate())}</div>
      </>}>
      {image ? (
        <img
          className="pv-photo"
          src={previewUrl ?? api.fileUrl(conversationId, file.id, true)}
          referrerPolicy="no-referrer"
          alt={file.name}
          draggable={false}
          onLoad={(event) =>
            setPhoto({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          onError={() => {
            if (onImageError) onImageError();
            else notify.fail("圖片讀取失敗", "圖片無法載入。");
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
    </PaperPreview>
  );
}
