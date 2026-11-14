import { createRoot } from "react-dom/client";
import ReplyMarkdown from "../client/src/components/DeferredReplyMarkdown";
import Notify, { notify } from "../client/src/components/Notify";
import ToolOutput from "../client/src/components/ToolOutput";
import ArchiveRibbonTitle from "../client/src/components/ArchiveRibbonTitle";

const root = createRoot(document.getElementById("root")!);
(window as any).renderFixture = (
  bubbles: string[],
  typing = false,
  page = "/chat",
) => {
  root.render(
    <>
      <article className="archive-msg" data-role="assistant">
        <div className="archive-msg-content">
          {bubbles.map((text, index) => (
            <div className="archive-bubble" key={index}>
              <ReplyMarkdown
                text={text}
                typing={typing && index === bubbles.length - 1}
              />
            </div>
          ))}
        </div>
      </article>
      <Notify page={page} />
    </>,
  );
};
(window as any).showNotice = (title = "已複製", reason = "") =>
  reason ? notify.fail(title, reason) : notify.ok(title);
(window as any).renderTitleFixture = (title: string) =>
  root.render(
    <>
      <div className="archive-ribbon">
        <ArchiveRibbonTitle conversationId="long-title" title={title} />
      </div>
      <Notify page="/chat" />
    </>,
  );
(window as any).renderToolFixture = (command: string, result: string) =>
  root.render(
    <div className="archive-msg-content">
      <div className="archive-tool-step is-expanded">
        <div className="archive-step-body">
          <ToolOutput command={command} result={result} streaming={false} />
        </div>
      </div>
    </div>,
  );
