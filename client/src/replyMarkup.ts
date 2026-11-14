import createDOMPurify from "dompurify";
import { Marked } from "marked";

export type ReplyCode = { text: string; language: string };
const purifier = createDOMPurify(window);
const tags = [
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "del",
  "mark",
  "span",
  "sub",
  "sup",
  "kbd",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "input",
  "blockquote",
  "pre",
  "code",
  "div",
  "details",
  "summary",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
];
const attributes = [
  "href",
  "title",
  "src",
  "alt",
  "style",
  "start",
  "colspan",
  "rowspan",
  "align",
  "type",
  "checked",
  "disabled",
  "open",
  "data-mian-code",
];

// 正文只开放文字颜色、底色和字重，禁止布局及事件属性。
purifier.addHook("uponSanitizeAttribute", (node, attribute) => {
  if (attribute.attrName !== "style") return;
  if (node.nodeName !== "SPAN") {
    attribute.keepAttr = false;
    return;
  }
  const source = document.createElement("span").style;
  const allowed = document.createElement("span").style;
  source.cssText = attribute.attrValue;
  for (const property of ["color", "background-color", "font-weight"])
    allowed.setProperty(property, source.getPropertyValue(property));
  attribute.attrValue = allowed.cssText;
});

// 每个气泡独立解析，尚未闭合的围栏只作用于当前气泡。
export function replyMarkup(text: string) {
  const codes: ReplyCode[] = [];
  const parser = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      code({ text, lang }) {
        const index =
          codes.push({
            text,
            language: (lang ?? "").split(/\s+/)[0].toLowerCase(),
          }) - 1;
        return `<pre data-mian-code="${index}"></pre>`;
      },
    },
  });
  const fragment = purifier.sanitize(parser.parse(text, { async: false }), {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: attributes,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  return { fragment, codes };
}

export function cleanHighlight(html: string) {
  return purifier.sanitize(html, {
    ALLOWED_TAGS: ["span"],
    ALLOWED_ATTR: ["class"],
  });
}
