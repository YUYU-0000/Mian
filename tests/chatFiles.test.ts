import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { ChatFiles, MAX_FILE_SIZE } from "../server/src/chatFiles.ts";
import { fileRoutes } from "../server/src/fileRoutes.ts";
import { WorkspaceFiles } from "../server/src/workspaceFiles.ts";
import {
  apiRequestMessages,
  API_FORMAT_REMINDER,
} from "../server/src/apiPrompt.ts";
import { completeChat } from "../server/src/providers/openai.ts";
import { ChatSessionStore } from "../client/src/chatSession.ts";
import { FileDrafts } from "../client/src/fileDrafts.ts";
import { api } from "../client/src/api.ts";
import { CodexBridge } from "../server/src/codex.ts";
import { chatHistory } from "../client/src/chatModel.ts";
import { conversationExport } from "../client/src/chatExport.ts";
import type { ChatFile, ConversationRecord } from "../client/src/types.ts";

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(path.join(process.cwd(), ".tmp-chat-files-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = new ChatFiles(path.join(directory, "data"));
  const workspace = path.join(directory, "workspace");
  await mkdir(workspace);
  return { directory, files, workspace };
}

test("附件草稿拒绝超大文件并允许取消正在上传的文件", async (t) => {
  const failures: unknown[][] = [];
  let signal: AbortSignal | undefined;
  t.mock.method(api, "uploadFile", (_id, _file, progress, abortSignal) => {
    signal = abortSignal;
    progress(40);
    return new Promise((_resolve, reject) =>
      abortSignal.addEventListener("abort", () =>
        reject(new Error("cancelled")),
      ),
    );
  });
  const drafts = new FileDrafts("c1");
  drafts.add(
    [new File([new Uint8Array(MAX_FILE_SIZE + 1)], "large.bin")],
    (...error) => failures.push(error),
  );
  assert.deepEqual(failures, [["文件太大", "單個文件不能超過 20MB。"]]);
  assert.equal(drafts.getSnapshot().length, 0);
  drafts.add([new File(["text"], "notes.txt")], (...error) =>
    failures.push(error),
  );
  assert.equal(drafts.getSnapshot()[0].progress, 40);
  drafts.remove(drafts.getSnapshot()[0].draftId);
  assert.equal(signal?.aborted, true);
  assert.equal(drafts.getSnapshot().length, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failures.length, 1);
  drafts.dispose();
});

test("Codex 只为成功的文件修改发出收集事件，工具事件保持原样", () => {
  const bridge = new CodexBridge(() => {
    throw new Error("不启动真实 Codex");
  });
  bridge.restoreConversationThreads([
    { conversationId: "c1", threadId: "thread-files" },
  ]);
  const files: unknown[] = [],
    tools: unknown[] = [];
  bridge.on("files-changed", (event) => files.push(event));
  bridge.on("event", (event) => tools.push(event));
  const notification = (
    bridge as unknown as {
      handleNotification(method: string, params: unknown): void;
    }
  ).handleNotification.bind(bridge);
  for (const status of ["declined", "failed", "completed"]) {
    notification("item/completed", {
      threadId: "thread-files",
      turnId: "turn-files",
      item: {
        type: "fileChange",
        id: status,
        status,
        changes: [{ path: "hello.txt" }],
      },
    });
  }
  assert.deepEqual(files, [{ conversationId: "c1", paths: ["hello.txt"] }]);
  assert.equal(tools.length, 3);
  bridge.close();
});

test("文件上传、读取和 20 MB 限制使用本地接口，HTML 只可下载", async (t) => {
  const { files } = await fixture(t);
  const app = express();
  app.use(
    "/api",
    fileRoutes(files, (id) => {
      assert.equal(id, "c1");
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/conversations/c1/files`;
  const response = await fetch(
    `${base}?name=${encodeURIComponent("頁面.html")}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: "<script>hello()</script>",
    },
  );
  assert.equal(response.status, 201);
  const saved = (await response.json()) as ChatFile;
  assert.equal(saved.name, "頁面.html");
  assert.equal(saved.size, 24);
  const download = await fetch(`${base}/${saved.id}?inline=1`);
  assert.match(download.headers.get("content-disposition")!, /^attachment/);
  assert.equal(await download.text(), "<script>hello()</script>");
  assert.equal(download.headers.get("content-security-policy"), "sandbox");
  const empty = await fetch(`${base}?name=empty.txt`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: "",
  });
  assert.equal(empty.status, 201);
  const large = await fetch(`${base}?name=large.bin`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.alloc(MAX_FILE_SIZE + 1),
  });
  assert.equal(large.status, 413);
  assert.deepEqual(await large.json(), { error: "單個文件不能超過 20MB。" });
  await assert.rejects(files.get("c1", "../../outside"), /文件不存在/);
});

test("API 附件保留完整历史：图片为 base64，文本附内容，其它只附名称和大小", async (t) => {
  const { files } = await fixture(t);
  const image = await files.save(
    "c1",
    "photo.png",
    Buffer.from([137, 80, 78, 71]),
  );
  const text = await files.save(
    "c1",
    "example.ts",
    Buffer.from("const value = 42;"),
  );
  const pdf = await files.save(
    "c1",
    "manual.pdf",
    Buffer.from("private-binary-content"),
    "application/pdf",
  );
  const history = [
    { role: "user" as const, content: "看这些", files: [image, text, pdf] },
    { role: "assistant" as const, content: "看到了" },
    { role: "user" as const, content: "再解释" },
  ];
  const messages = await files.apiMessages("c1", history);
  assert.deepEqual(messages[0].content[1], {
    type: "image_url",
    image_url: { url: "data:image/png;base64,iVBORw==" },
  });
  assert.match(
    (messages[0].content[0] as { text: string }).text,
    /example.ts.*\nconst value = 42;/,
  );
  assert.match(
    (messages[0].content[0] as { text: string }).text,
    /manual.pdf（22 bytes）/,
  );
  assert.doesNotMatch(
    JSON.stringify(messages),
    /private-binary-content|"files"|"id"/,
  );
  assert.equal(messages[2].content, "再解释");
  const reminder = apiRequestMessages(
    [messages[0]],
    "現在是 2026-11-14 星期六 02:01",
  );
  assert.deepEqual(reminder[1].content.at(-1), {
    type: "text",
    text: `\n\n${API_FORMAT_REMINDER}`,
  });
  assert.equal(history[0].content, "看这些");
  assert.equal((messages[0].content as unknown[]).length, 2);
});

test("不支持图片时保留服务商原因，不重发或丢弃图片", async (t) => {
  const requests: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)));
    return new Response(
      JSON.stringify({
        error: {
          message: "This model does not support image_url input",
          param: "messages",
        },
      }),
      { status: 400 },
    );
  });
  const run = async () => {
    for await (const _event of completeChat(
      {
        endpoint: "https://fake.invalid",
        key: "fake",
        model: "text-model",
        format: "openai",
      },
      [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AA==" },
            },
          ],
        },
      ],
      new AbortController().signal,
    )) {
    }
  };
  await assert.rejects(run, /does not support image_url/);
  assert.equal(requests.length, 1);
});

test("Codex 输入复制到工作目录，命令写入和补丁修改都保存独立快照", async (t) => {
  const { files, workspace, directory } = await fixture(t);
  const input = await files.save(
    "c1",
    "设计.md",
    Buffer.from("original input"),
  );
  const prompt = await files.codexPrompt("c1", workspace, "帮我修改", [
    input.id,
  ]);
  const inputPath = path.join(
    workspace,
    ".mian-uploads",
    "c1",
    input.id,
    input.name,
  );
  assert.ok(prompt.includes(inputPath));
  assert.equal(await readFile(inputPath, "utf8"), "original input");
  const existing = path.join(workspace, "existing.txt");
  await writeFile(existing, "before");
  const capture = new WorkspaceFiles(workspace);
  t.after(() => capture.close());
  await writeFile(existing, "after");
  capture.add(["existing.txt", existing]);
  await mkdir(path.join(workspace, "new-folder"));
  await writeFile(
    path.join(workspace, "new-folder", "hello.html"),
    "<p>new</p>",
  );
  await writeFile(inputPath, "edited input");
  await new Promise((resolve) => setTimeout(resolve, 80));
  const outputs = await capture.finish(files, "c1", "turn-files");
  assert.deepEqual(
    outputs.map((file) => file.name).sort(),
    ["existing.txt", "hello.html", "设计.md"].sort(),
  );
  await writeFile(existing, "next turn");
  const output = await files.get(
    "c1",
    outputs.find((file) => file.name === "existing.txt")!.id,
  );
  assert.equal(await readFile(output.path, "utf8"), "after");
  await writeFile(path.join(directory, "outside.txt"), "outside");
  assert.equal(
    await files.capture("c1", "turn-files", workspace, "../outside.txt"),
    undefined,
  );
  await files.copyConversation("c1", "branch");
  const copied = await files.get("branch", input.id);
  assert.equal(await readFile(copied.path, "utf8"), "original input");
  const copiedOutput = await files.get("branch", output.file.id);
  assert.equal(await readFile(copiedOutput.path, "utf8"), "after");
});

test("只发文件、重载、分支和导出都保留票根，导出不带内容或下载路径", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const sent: unknown[][] = [];
  const apiClient = {
    send: async (...args: unknown[]) => {
      sent.push(args);
      return { turnId: "reply" };
    },
    stop: async () => {},
  };
  const input: ChatFile = {
    id: "input-id",
    name: "input.txt",
    size: 12,
    mimeType: "text/plain",
    createdAt: "2026-11-14T02:01:00Z",
  };
  const output = { ...input, id: "output-id", name: "reply.txt" };
  const store = new ChatSessionStore({
    conversationId: "c1",
    storage,
    apiClient,
  });
  store.saveUserRecord("", [input]);
  assert.equal(store.getSnapshot().messages.length, 1);
  await store.startPendingTurn();
  assert.deepEqual(sent[0][3], [input]);
  store.enqueueEvent({
    type: "files",
    conversationId: "c1",
    turnId: "reply",
    files: [output],
  });
  store.enqueueEvent({
    type: "turn-completed",
    conversationId: "c1",
    turnId: "reply",
    status: "completed",
  });
  const snapshot = store.getSnapshot();
  store.dispose();
  const reloaded = new ChatSessionStore({
    conversationId: "c1",
    storage,
    apiClient,
  });
  assert.deepEqual(chatHistory(reloaded.getSnapshot().messages)[0].files, [
    input,
  ]);
  assert.deepEqual(
    (reloaded.getSnapshot().messages[1] as { files: ChatFile[] }).files,
    [output],
  );
  const branch = new ChatSessionStore({
    conversationId: "branch",
    storage,
    apiClient,
  });
  branch.seedFrom(snapshot);
  assert.deepEqual(branch.getSnapshot().messages, snapshot.messages);
  const exported = conversationExport(
    [
      {
        conversationId: "branch",
        title: "附件对话",
        frontName: "Mian",
      } as ConversationRecord,
    ],
    storage,
  );
  assert.deepEqual(
    exported.conversations[0].messages.map((message) => message.files),
    [[{ name: "input.txt", size: 12 }], [{ name: "reply.txt", size: 12 }]],
  );
  assert.doesNotMatch(
    JSON.stringify(exported),
    /input-id|output-id|base64|mimeType|\/files\//,
  );
  reloaded.dispose();
  branch.dispose();
});
