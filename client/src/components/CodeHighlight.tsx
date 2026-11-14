import { memo, useMemo } from "react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { cleanHighlight, type ReplyCode } from "../replyMarkup";

// 只注册常用语言，HTML、JS 等别名沿用各语言定义。
for (const [name, language] of Object.entries({
  bash,
  cpp,
  csharp,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
}))
  hljs.registerLanguage(name, language);

export default memo(function CodeHighlight({ text, language }: ReplyCode) {
  const html = useMemo(
    () =>
      hljs.getLanguage(language)
        ? cleanHighlight(
            hljs.highlight(text, { language, ignoreIllegals: true }).value,
          )
        : null,
    [text, language],
  );
  return html === null ? (
    text
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
});
