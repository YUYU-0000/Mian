import {
  createElement,
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { replyMarkup, type ReplyCode as Code } from "../replyMarkup";
import ReplyCode from "./ReplyCode";
import ReplyImageTicket from "./ReplyImageTicket";
import ReplyLink from "./ReplyLink";
import { replyImageSource, splitReplyImages } from "../replyImages";
import type { ChatFile } from "../types";
import "./reply-markdown.css";

const attributeNames: Record<string, string> = {
  colspan: "colSpan",
  rowspan: "rowSpan",
};

// 安全 DOM 转成 React 节点，让复制按钮和已打开的预览在流式更新中保留。
function renderNodes(
  parent: ParentNode,
  codes: Code[],
  path = "",
  typing = false,
): ReactNode[] {
  const nodes = Array.from(parent.childNodes).filter(
    (node) => node.nodeType !== Node.COMMENT_NODE,
  );
  return nodes.map((node, index) => {
    const key = `${path}.${index}`;
    const tail = typing && index === nodes.length - 1;
    const cursor = tail ? <span className="cursor-blink" /> : null;
    if (node.nodeType === Node.TEXT_NODE)
      return (
        <Fragment key={key}>
          {node.textContent}
          {cursor}
        </Fragment>
      );
    const element = node as HTMLElement;
    const codeIndex = element.getAttribute("data-mian-code");
    if (element.tagName === "PRE") {
      const code = codeIndex !== null ? codes[Number(codeIndex)] : undefined;
      return (
        <ReplyCode
          key={key}
          {...(code ?? { text: element.textContent ?? "", language: "" })}
          typing={tail}
        />
      );
    }
    const tag = element.tagName.toLowerCase();
    const props: Record<string, unknown> = { key };
    for (const { name, value } of Array.from(element.attributes)) {
      if (name === "style") {
        props.style = {
          color: element.style.color,
          backgroundColor: element.style.backgroundColor,
          fontWeight: element.style.fontWeight,
        };
      } else if (name === "open") props.open = true;
      else if (
        !["type", "checked", "disabled", "data-mian-code"].includes(name)
      )
        props[attributeNames[name] ?? name] = value;
    }
    if (tag === "input")
      Object.assign(props, {
        type: "checkbox",
        disabled: true,
        checked: element.hasAttribute("checked"),
      });
    if (tag === "img") props.loading = "lazy";
    const children = renderNodes(element, codes, key, tail);
    if (tag === "a")
      return <ReplyLink key={key} href={element.getAttribute("href") ?? ""} title={element.getAttribute("title") ?? undefined}>{children}</ReplyLink>;
    const rendered = createElement(tag, props, ...children);
    if (tag === "table")
      return (
        <div className="reply-table-scroll" key={key}>
          {rendered}
        </div>
      );
    return children.length === 0 && tail ? (
      <Fragment key={key}>
        {rendered}
        {cursor}
      </Fragment>
    ) : (
      rendered
    );
  });
}

function useThrottledText(text: string, typing: boolean) {
  const [visible, setVisible] = useState(text);
  const latest = useRef(text);
  const lastPaint = useRef(0);
  latest.current = text;
  useEffect(() => {
    const publish = () => {
      lastPaint.current = Date.now();
      setVisible(latest.current);
    };
    const delay = typing
      ? Math.max(0, 100 - (Date.now() - lastPaint.current))
      : 0;
    if (!delay) {
      publish();
      return;
    }
    const timer = window.setTimeout(publish, delay);
    return () => window.clearTimeout(timer);
  }, [text, typing]);
  return typing ? visible : text;
}

export type ReplyMarkdownProps = {
  text: string;
  typing: boolean;
  bubble?: {
    className: string;
    conversationId: string;
    files?: ChatFile[];
  };
};

export default memo(function ReplyMarkdown({
  text,
  typing,
  bubble,
}: ReplyMarkdownProps) {
  const visible = useThrottledText(text, typing);
  const parsed = useMemo(() => {
    const { fragment, codes } = replyMarkup(visible, {
      typing: Boolean(bubble) && typing,
      imageSource: bubble
        ? (src) => replyImageSource(src, bubble.conversationId, bubble.files)
        : undefined,
    });
    // Marked 的块间换行不应把光标挤到下一行。
    while (
      fragment.lastChild?.nodeType === Node.TEXT_NODE &&
      !fragment.lastChild.textContent?.trim()
    )
      fragment.lastChild.remove();
    return { fragment, codes, parts: bubble ? splitReplyImages(fragment) : [] };
  }, [visible, typing, bubble?.conversationId, bubble?.files]);
  if (bubble) {
    let imageIndex = 0;
    let textIndex = 0;
    const lastTextIndex = parsed.parts
      .map((part) => part.kind)
      .lastIndexOf("text");
    return parsed.parts.map((part, index) =>
      part.kind === "image" ? (
        <ReplyImageTicket
          key={`image-${imageIndex++}-${part.image.src}`}
          image={part.image}
          conversationId={bubble.conversationId}
          files={bubble.files}
          animate={bubble.className.includes("archive-pop-in")}
        />
      ) : (
        <div
          key={`text-${textIndex++}`}
          className={bubble.className}
          data-timeline-kind="ASSISTANT_BUBBLE"
        >
          <div className="reply-markdown">
            {renderNodes(
              part.fragment,
              parsed.codes,
              "",
              typing && index === lastTextIndex,
            )}
          </div>
        </div>
      ),
    );
  }
  const content = renderNodes(parsed.fragment, parsed.codes, "", typing);
  return (
    <div className="reply-markdown">
      {content.length ? content : typing && <span className="cursor-blink" />}
    </div>
  );
});
