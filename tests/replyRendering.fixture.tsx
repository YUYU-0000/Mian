import { createRoot } from "react-dom/client";
import ReplyMarkdown from "../client/src/components/ReplyMarkdown";
import Notify, { notify } from "../client/src/components/Notify";

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
(window as any).showNotice = () => notify.ok("已複製");
