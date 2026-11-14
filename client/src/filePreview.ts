import type { ChatFile } from "./types";

export type PreviewKind = "image" | "text" | "markdown" | "html" | "pdf";
export const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;
const textExtensions = new Set(
  "txt log json jsonl csv tsv xml yaml yml ini conf config env toml css scss sass less js jsx ts tsx mjs cjs py rb go rs java c h cpp hpp cs swift kt kts sh bash zsh ps1 bat cmd sql r vue svelte tex diff patch php lua pl pm dart ex exs erl hrl hs clj cljs scala groovy zig proto graphql gql dockerfile makefile".split(
    " ",
  ),
);

export function fileExtension(name: string) {
  return name.toLowerCase().split(".").at(-1)!;
}

export function previewKind(
  file: ChatFile,
  pdfEnabled: boolean,
): PreviewKind | null {
  const extension = fileExtension(file.name);
  if (file.mimeType.startsWith("image/")) return "image";
  if (extension === "pdf" || file.mimeType === "application/pdf")
    return pdfEnabled ? "pdf" : null;
  if (file.size > TEXT_PREVIEW_LIMIT) return null;
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "html" || extension === "htm") return "html";
  if (textExtensions.has(extension) || file.mimeType.startsWith("text/"))
    return "text";
  return null;
}

export function fileLanguage(name: string) {
  const extension = fileExtension(name);
  const aliases: Record<string, string> = {
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    tsx: "typescript",
    h: "cpp",
    hpp: "cpp",
    vue: "xml",
    svelte: "xml",
    svg: "xml",
    sh: "bash",
    zsh: "bash",
    rb: "ruby",
    pl: "perl",
    pm: "perl",
    kt: "kotlin",
    kts: "kotlin",
    ps1: "powershell",
    bat: "dos",
    cmd: "dos",
    ex: "elixir",
    exs: "elixir",
    erl: "erlang",
    hrl: "erlang",
    hs: "haskell",
    clj: "clojure",
    cljs: "clojure",
    proto: "protobuf",
    gql: "graphql",
    tex: "latex",
    patch: "diff",
    env: "ini",
    conf: "ini",
    toml: "ini",
  };
  return aliases[extension] ?? extension;
}

export function fitPhoto(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  availableHeight = viewportHeight * 0.6,
) {
  const scale = Math.min(
    1,
    (viewportWidth * 0.78 - 32) / width,
    Math.min(viewportHeight * 0.6, availableHeight) / height,
  );
  return { width: width * scale, height: height * scale };
}
