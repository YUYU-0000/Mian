import { memo, useMemo } from "react";
import ChineseText, { chineseHighlight } from "./ChineseText";
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

// 文件按扩展名补载语言，聊天页仍只加载原有常用语言。
const fileLanguages = {
  ini: () => import("highlight.js/lib/languages/ini"),
  php: () => import("highlight.js/lib/languages/php"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  lua: () => import("highlight.js/lib/languages/lua"),
  perl: () => import("highlight.js/lib/languages/perl"),
  swift: () => import("highlight.js/lib/languages/swift"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  dart: () => import("highlight.js/lib/languages/dart"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
  dos: () => import("highlight.js/lib/languages/dos"),
  r: () => import("highlight.js/lib/languages/r"),
  elixir: () => import("highlight.js/lib/languages/elixir"),
  erlang: () => import("highlight.js/lib/languages/erlang"),
  haskell: () => import("highlight.js/lib/languages/haskell"),
  clojure: () => import("highlight.js/lib/languages/clojure"),
  scala: () => import("highlight.js/lib/languages/scala"),
  groovy: () => import("highlight.js/lib/languages/groovy"),
  protobuf: () => import("highlight.js/lib/languages/protobuf"),
  graphql: () => import("highlight.js/lib/languages/graphql"),
  scss: () => import("highlight.js/lib/languages/scss"),
  less: () => import("highlight.js/lib/languages/less"),
  diff: () => import("highlight.js/lib/languages/diff"),
  latex: () => import("highlight.js/lib/languages/latex"),
  makefile: () => import("highlight.js/lib/languages/makefile"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
};

export async function loadFileLanguage(language: string) {
  const load = fileLanguages[language as keyof typeof fileLanguages];
  if (!hljs.getLanguage(language) && load) {
    const module = await load();
    hljs.registerLanguage(language, module.default);
  }
}

export default memo(function CodeHighlight({ text, language }: ReplyCode) {
  const html = useMemo(
    () =>
      hljs.getLanguage(language)
        ? chineseHighlight(
            cleanHighlight(
              hljs.highlight(text, { language, ignoreIllegals: true }).value,
            ),
          )
        : null,
    [text, language],
  );
  return html === null ? (
    <ChineseText text={text} />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
});
