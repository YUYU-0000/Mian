import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import express from "express";
import {
  previewKind,
  fileLanguage,
  fitPhoto,
  TEXT_PREVIEW_LIMIT,
} from "../client/src/filePreview.ts";
import { api } from "../client/src/api.ts";
import type { ChatFile } from "../client/src/types.ts";
import { ChatFiles } from "../server/src/chatFiles.ts";
import { fileRoutes } from "../server/src/fileRoutes.ts";

const file = (
  name: string,
  size = 123,
  mimeType = "application/octet-stream",
): ChatFile => ({
  id: name,
  name,
  size,
  mimeType,
  createdAt: "2026-11-14T12:00:00Z",
});

test("按文件类型选择预览，2 MB 以上文本与未知格式直接下载", () => {
  for (const name of [
    "a.txt",
    "a.log",
    "a.json",
    "a.csv",
    "a.xml",
    "a.yaml",
    "a.ini",
    "a.tsx",
    "a.py",
    "Dockerfile",
    "a.PHP",
  ])
    assert.equal(previewKind(file(name), true), "text", name);
  assert.equal(previewKind(file("readme.MD"), true), "markdown");
  assert.equal(previewKind(file("page.htm"), true), "html");
  assert.equal(previewKind(file("notes", 123, "text/plain"), true), "text");
  for (const name of ["a.txt", "a.md", "a.html"]) {
    assert.notEqual(previewKind(file(name, TEXT_PREVIEW_LIMIT), true), null);
    assert.equal(previewKind(file(name, TEXT_PREVIEW_LIMIT + 1), true), null);
  }
  assert.equal(previewKind(file("a.docx"), true), null);
  assert.equal(
    previewKind(file("a.png", TEXT_PREVIEW_LIMIT * 4, "image/png"), true),
    "image",
  );
});

test("PDF 根据浏览器的内嵌能力选择查看或下载", () => {
  assert.equal(previewKind(file("a.PDF", TEXT_PREVIEW_LIMIT * 4), true), "pdf");
  assert.equal(previewKind(file("a.pdf"), false), null);
  assert.equal(
    previewKind(file("document", 123, "application/pdf"), true),
    "pdf",
  );
});

test("代码扩展名映射到共用高亮器的语言", () => {
  assert.equal(fileLanguage("View.TSX"), "typescript");
  assert.equal(fileLanguage("module.mjs"), "javascript");
  assert.equal(fileLanguage("index.vue"), "xml");
  assert.equal(fileLanguage("types.hpp"), "cpp");
  assert.equal(fileLanguage("setup.sh"), "bash");
});

test("照片按原比例缩小，横图受宽度约束，竖图受高度约束", () => {
  const wide = fitPhoto(1600, 800, 390, 844);
  assert.equal(wide.width, 390 * 0.78 - 32);
  assert.equal(wide.width / wide.height, 2);
  const tall = fitPhoto(200, 2400, 390, 844);
  assert.equal(tall.height, 844 * 0.6);
  assert.equal(tall.width / tall.height, 1 / 12);
  assert.deepEqual(fitPhoto(100, 80, 390, 844), { width: 100, height: 80 });
});

test("读取预览原文保留 HTML，失败显示服务端返回的原因", async (t) => {
  const mockedFetch = t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response('<button onclick="run()">点</button><script>run()</script>'),
  );
  assert.equal(
    await api.fileText("c1", "page", new AbortController().signal),
    '<button onclick="run()">点</button><script>run()</script>',
  );
  mockedFetch.mock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ error: "文件已移走" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
  );
  await assert.rejects(
    api.fileText("c1", "page", new AbortController().signal),
    /文件已移走/,
  );
});

test("PDF 在线地址提供 application/pdf，保存地址仍返回附件", async (t) => {
  const directory = await mkdtemp(
    path.join(process.cwd(), ".tmp-preview-route-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = new ChatFiles(directory);
  const pdf = await files.save(
    "c1",
    "readme.pdf",
    Buffer.from("%PDF-1.4\n%%EOF"),
  );
  const app = express();
  app.use(
    "/api",
    fileRoutes(files, () => {}),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/conversations/c1/files/${pdf.id}`;
  const inline = await fetch(url + "?inline=1");
  assert.equal(inline.status, 200);
  assert.equal(inline.headers.get("content-type"), "application/pdf");
  assert.equal(inline.headers.get("content-disposition"), null);
  assert.equal(inline.headers.get("content-security-policy"), null);
  const download = await fetch(url);
  assert.match(download.headers.get("content-disposition")!, /^attachment/);
});
