import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { cluePrompt, getActiveScenes, type Clue } from "../server/src/clues.ts";
import { apiRequestMessages } from "../server/src/apiPrompt.ts";
import { ChatSessionStore } from "../client/src/chatSession.ts";
import { completeBackup } from "../client/src/settingsBackup.ts";
import { createId } from "../client/src/id.ts";
import { fileTicketServer } from "./fileTickets.server.mjs";

const card = (patch: Partial<Clue> = {}): Clue => ({
  id: createId(),
  title: "常駐",
  content: "卡片內容",
  mode: "pinned",
  keywords: [],
  scenes: [],
  order: 0,
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
  ...patch,
});

test("clues match substrings without case, union scenes once, pinned first and sorted", () => {
  const clues = [
    card({
      title: "觸發二",
      mode: "trigger",
      keywords: ["HELLO"],
      scenes: ["voice"],
      order: 8,
    }),
    card({ title: "常駐二", order: 5 }),
    card({ title: "語音", mode: "trigger", scenes: ["voice"], order: -1 }),
    card({ title: "常駐一", order: 1 }),
    card({ title: "觸發一", mode: "trigger", keywords: ["你好"], order: 2 }),
    card({ title: "未命中", mode: "trigger", keywords: ["old"], order: 0 }),
  ];
  assert.deepEqual(getActiveScenes(), []);
  assert.equal(
    cluePrompt(clues, "wellHello，說你好", ["voice"]),
    ["常駐一", "常駐二", "語音", "觸發一", "觸發二"]
      .map((title) => `【${title}】\n卡片內容`)
      .join("\n\n"),
  );
  assert.equal(
    cluePrompt(
      clues.filter((clue) => clue.mode === "trigger"),
      "無匹配",
    ),
    "",
  );
  const original = apiRequestMessages(
    [{ role: "user", content: "你好" }],
    "現在",
  );
  assert.deepEqual(
    apiRequestMessages([{ role: "user", content: "你好" }], "現在", ""),
    original,
  );
  const injected = apiRequestMessages(
    [{ role: "user", content: "你好" }],
    "現在",
    "【線索】\n內容",
  );
  assert.equal(injected[0].content, original[0].content + "\n\n【線索】\n內容");
  assert.deepEqual(injected.slice(1), original.slice(1));
});

test("the latest user record travels separately from grouped history", async () => {
  let sent: unknown[] = [];
  const store = new ChatSessionStore({
    conversationId: "c1",
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    apiClient: {
      send: async (...args) => {
        sent = args;
        return { turnId: "clues" };
      },
      stop: async () => {},
    },
  });
  store.saveUserRecord("舊詞 apple");
  store.saveUserRecord("最新一句 hello");
  await store.startPendingTurn();
  assert.match(String(sent[0]), /apple/);
  assert.equal(sent[4], "最新一句 hello");
  store.dispose();
});

test("clues CRUD persist JSON and round trip through archive, accepting older backups", async () => {
  const server = await fileTicketServer();
  const request = (url: string, method = "GET", body?: unknown) =>
    fetch(server.base + url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.deepEqual(await (await request("/api/clues")).json(), []);
    const input = card({
      mode: "trigger",
      keywords: ["hello"],
      scenes: ["voice"],
    });
    const createdResponse = await request("/api/clues", "POST", input);
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    const updated = await (
      await request(`/api/clues/${input.id}`, "PUT", {
        ...created,
        title: "修改",
        order: 3,
      })
    ).json();
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(updated.title, "修改");
    assert.deepEqual(
      await (await request(`/api/clues/${input.id}`)).json(),
      updated,
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(server.directory, "server/data/clues.json"),
          "utf8",
        ),
      ),
      [updated],
    );
    const backup = completeBackup(await (await request("/api/backup")).json(), {
      getItem: () => null,
    });
    assert.deepEqual(backup.clues, [updated]);
    await request(`/api/clues/${input.id}`, "DELETE");
    assert.deepEqual(await (await request("/api/clues")).json(), []);
    assert.equal((await request("/api/backup", "POST", backup)).status, 200);
    assert.deepEqual(await (await request("/api/clues")).json(), [updated]);
    const pinned = await (
      await request(`/api/clues/${input.id}`, "PUT", {
        ...updated,
        mode: "pinned",
      })
    ).json();
    assert.deepEqual(pinned.keywords, []);
    assert.deepEqual(pinned.scenes, []);
    delete backup.clues;
    assert.equal((await request("/api/backup", "POST", backup)).status, 200);
    assert.deepEqual(await (await request("/api/clues")).json(), []);
  } finally {
    await server.close();
  }
});

test(
  "both turn channels select the latest user message instead of grouped history",
  { timeout: 20000 },
  async () => {
    const server = await fileTicketServer();
    const socket = new WebSocket(server.base.replace("http", "ws") + "/ws");
    await once(socket, "open");
    const request = (url: string, method: string, body: unknown) =>
      fetch(server.base + url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const turn = async (latestUserMessage: string) => {
      const completed = new Promise<void>((resolve) => {
        const listen = (raw: Buffer) => {
          const message = JSON.parse(String(raw));
          if (message.event?.type === "turn-completed") {
            socket.off("message", listen);
            resolve();
          }
        };
        socket.on("message", listen);
      });
      const response = await request("/api/turn", "POST", {
        conversationId: "c1",
        text: "old-word\n" + latestUserMessage,
        latestUserMessage,
        messages: [
          { role: "user", content: "old-word" },
          { role: "assistant", content: "舊回覆" },
          { role: "user", content: latestUserMessage },
        ],
      });
      assert.equal(response.status, 200);
      await completed;
    };
    try {
      for (const clue of [
        card(),
        card({ title: "命中", mode: "trigger", keywords: ["HELLO"] }),
        card({ title: "舊詞", mode: "trigger", keywords: ["old-word"] }),
        card({ title: "語音", mode: "trigger", scenes: ["voice"] }),
      ]) {
        assert.equal((await request("/api/clues", "POST", clue)).status, 201);
      }
      await turn("say hello");
      const system = server.received[0].messages[0];
      assert.equal(system.role, "system");
      assert.match(system.content, /【常駐】\n卡片內容\n\n【命中】\n卡片內容$/);
      assert.doesNotMatch(system.content, /【舊詞】|【語音】/);
      assert.doesNotMatch(
        JSON.stringify(server.received[0].messages.slice(1)),
        /卡片內容/,
      );
      assert.equal((await request("/api/subscriptions/codex/use", "POST", {})).status, 200);
      await turn("hello again");
      assert.equal(
        server.systemPrompts[0],
        "【常駐】\n卡片內容\n\n【命中】\n卡片內容",
      );
      assert.doesNotMatch(server.prompts[0], /卡片內容/);
      await turn("無匹配");
      assert.equal(server.systemPrompts[1], "【常駐】\n卡片內容");
    } finally {
      socket.close();
      await server.close();
    }
  },
);
