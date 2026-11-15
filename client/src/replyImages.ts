import { api } from "./api";
import type { ChatFile } from "./types";

export type ReplyImage = { src: string; alt: string };
export type ReplyPart =
  | { kind: "text"; fragment: DocumentFragment }
  | { kind: "image"; image: ReplyImage };

export function replyImageSource(
  src: string,
  conversationId: string,
  files: ChatFile[] = [],
) {
  if (/^(?:https?:|data:|blob:|\/\/)/i.test(src)) return src;
  const path = src.replace(/\\/g, "/");
  const upload = path.match(/(?:^|\/)\.mian-uploads\/[^/]+\/([\w-]+)\//);
  if (upload) return api.fileUrl(conversationId, upload[1], true);
  const file = files.find(
    (item) => path === item.name || path.endsWith(`/${item.name}`),
  );
  return file ? api.fileUrl(conversationId, file.id, true) : src;
}

// 每段文字里的图片移到这段后面，后续段落仍按原顺序排列。
export function splitReplyImages(fragment: DocumentFragment): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let text = document.createDocumentFragment();
  const flushText = () => {
    if (text.textContent?.trim() || text.querySelector("pre,hr,input,table"))
      parts.push({ kind: "text", fragment: text });
    text = document.createDocumentFragment();
  };
  for (const node of Array.from(fragment.childNodes)) {
    const images =
      node instanceof Element
        ? node.matches("img")
          ? [node]
          : Array.from(node.querySelectorAll("img"))
        : [];
    const values = images.map((image) => ({
      src: image.getAttribute("src") ?? "",
      alt: image.getAttribute("alt") ?? "",
    }));
    images.forEach((image) => image.remove());
    if (
      !images.length ||
      node.textContent?.trim() ||
      (node instanceof Element && node.querySelector("pre,hr,input,table"))
    )
      text.appendChild(node);
    if (values.length) {
      flushText();
      parts.push(...values.map((image) => ({ kind: "image" as const, image })));
    }
  }
  flushText();
  return parts;
}
