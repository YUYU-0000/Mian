import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { migrateClues, type Clue } from "../server/src/clues.ts";
import {
  selectCluePrompt,
  getActiveScenes,
  CLUE_SELECTION_INSTRUCTION,
} from "../server/src/clueSelection.ts";
import { ChatSessionStore } from "../client/src/chatSession.ts";
import { completeBackup } from "../client/src/settingsBackup.ts";
import { createId } from "../client/src/id.ts";
import { fileTicketServer } from "./fileTickets.server.mjs";

const card = (patch: Partial<Clue> = {}): Clue => ({
  id: createId(),
  title: "常駐",
  content: "卡片內容",
  mode: "pinned",
  when: "",
  scenes: [],
  layout: 0,
  x: 20,
  y: 320,
  w: 150,
  h: 160,
  r: -2,
  order: 0,
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
  ...patch,
});

test("natural selection sends only metadata and six messages; scene matches bypass selection", async () => {
  const clues = [
    card({ title: "常駐二", order: 2 }),
    card({
      id: "voice",
      title: "語音",
      mode: "trigger",
      scenes: ["voice"],
      order: -1,
    }),
    card({ title: "常駐一", order: 1 }),
    card({ id: "chosen", title: "挑中", mode: "trigger", when: "想念對方時" }),
    card({ id: "other", mode: "trigger", when: "準備出門時" }),
  ];
  const history = Array.from({ length: 9 }, (_, index) => ({
    role: index % 2 ? ("assistant" as const) : ("user" as const),
    content: `message ${index}`,
  }));
  assert.deepEqual(getActiveScenes(), []);
  const prompt = await selectCluePrompt(
    clues,
    history,
    async (system, recent) => {
      assert.equal(system.split("\n\n")[0], CLUE_SELECTION_INSTRUCTION);
      assert.deepEqual(JSON.parse(system.split("\n\n")[1]), [
        { id: "chosen", title: "挑中", when: "想念對方時" },
        { id: "other", title: "常駐", when: "準備出門時" },
      ]);
      assert.deepEqual(recent, history.slice(-6));
      assert.doesNotMatch(system, /卡片內容/);
      return "chosen,chosen,unknown";
    },
    ["voice"],
  );
  assert.equal(
    prompt,
    ["常駐一", "常駐二", "語音", "挑中"]
      .map((title) => `【${title}】\n卡片內容`)
      .join("\n\n"),
  );
  const fail = async () => {
    throw new Error("failed");
  };
  assert.equal(
    await selectCluePrompt(clues, history, fail, ["voice"]),
    ["常駐一", "常駐二", "語音"]
      .map((title) => `【${title}】\n卡片內容`)
      .join("\n\n"),
  );
  assert.equal(await selectCluePrompt([clues[3]], history, async () => ""), "");
  assert.equal(
    await selectCluePrompt([], history, async () => {
      assert.fail("no pre-request when no triggers");
    }),
    "",
  );
  await selectCluePrompt(
    [clues[0], clues[1]],
    history,
    async () => {
      assert.fail("scene already matched");
    },
    ["voice"],
  );
});

test("six recent records travel separately from grouped chat history", async () => {
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
  for (let index = 0; index < 9; index++)
    store.saveUserRecord(`record ${index}`);
  await store.startPendingTurn();
  assert.deepEqual(
    sent[4],
    Array.from({ length: 6 }, (_, index) => ({
      role: "user",
      content: `record ${index + 3}`,
    })),
  );
  store.dispose();
});

test("wall migration, CRUD, pin removal, portrait geometry and archive round trip", async () => {
  const server = await fileTicketServer();
  const request = (url: string, method = "GET", body?: unknown) =>
    fetch(server.base + url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const get = async () => (await request("/api/clues")).json();
  try {
    const legacy = {
      id: "legacy",
      title: "舊卡片",
      content: "保留內容",
      mode: "trigger",
      keywords: ["晚安"],
      scenes: [],
      order: 0,
      createdAt: "before",
      updatedAt: "before",
    };
    await writeFile(
      path.join(server.directory, "server/data/clues.json"),
      JSON.stringify([legacy, { ...legacy, id: "second" }]),
    );
    const wall = await get();
    assert.equal(wall.cards[0].when, "提到 晚安 時");
    assert.equal("keywords" in wall.cards[0], false);
    assert.ok(wall.cards[1].y > wall.cards[0].y + wall.cards[0].h);
    const input = card({ id: "new", when: "提到回家時", mode: "trigger" });
    assert.equal((await request("/api/clues", "POST", input)).status, 201);
    const saved = await (
      await request("/api/clues/new", "PUT", { ...input, title: "修改" })
    ).json();
    assert.equal(
      (await (await request("/api/clues/new")).json()).title,
      "修改",
    );
    const layout = {
      ...(await get()),
      portrait: { x: 20, y: 30, w: 170, h: 200, r: 4 },
      pins: [
        { id: "p1", cardId: "new", x: 0.25, y: 0.8 },
        { id: "p2", cardId: null, x: 10, y: 20 },
        { id: "p3", cardId: "portrait", x: 0.4, y: 0.6 },
      ],
      threads: [
        { from: "p1", to: "p2" },
        { from: "p2", to: "p3" },
      ],
    };
    assert.equal((await request("/api/clues", "PUT", layout)).status, 200);
    assert.deepEqual(await get(), layout);
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(server.directory, "server/data/clues.json"),
          "utf8",
        ),
      ),
      layout,
    );
    const backup = completeBackup(await (await request("/api/backup")).json(), {
      getItem: () => null,
    });
    assert.deepEqual(backup.clues, layout);
    await request("/api/clues/new", "DELETE");
    assert.deepEqual((await get()).threads, [{ from: "p2", to: "p3" }]);
    assert.equal((await get()).pins.length, 2);
    assert.equal((await request("/api/backup", "POST", backup)).status, 200);
    assert.deepEqual(await get(), layout);
    assert.equal((await get()).cards.at(-1).createdAt, saved.createdAt);
    const oldBackup = { ...backup, clues: [legacy] };
    assert.equal((await request("/api/backup", "POST", oldBackup)).status, 200);
    assert.equal((await get()).cards[0].when, "提到 晚安 時");
    delete backup.clues;
    assert.equal((await request("/api/backup", "POST", backup)).status, 200);
    assert.deepEqual(await get(), migrateClues());
  } finally {
    await server.close();
  }
});

for (const selectionFails of [false, true])
  test(
    `both channels ${selectionFails ? "skip failed selection" : "select naturally"} before the formal turn`,
    { timeout: 20000 },
    async () => {
      const server = await fileTicketServer({
        selection: "chosen",
        selectionFails,
      });
      const socket = new WebSocket(server.base.replace("http", "ws") + "/ws");
      await once(socket, "open");
      const events: any[] = [];
      socket.on("message", (raw) => events.push(JSON.parse(String(raw)).event));
      const request = (url: string, method: string, body: unknown) =>
        fetch(server.base + url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      const recent = [{ role: "user", content: "我有點想你" }];
      const turn = async () => {
        const completed = new Promise<void>((resolve) => {
          const listen = (raw: Buffer) => {
            if (JSON.parse(String(raw)).event?.type === "turn-completed") {
              socket.off("message", listen);
              resolve();
            }
          };
          socket.on("message", listen);
        });
        assert.equal(
          (
            await request("/api/turn", "POST", {
              conversationId: "c1",
              text: "我有點想你",
              messages: recent,
              recentMessages: recent,
            })
          ).status,
          200,
        );
        await completed;
      };
      try {
        for (const clue of [
          card(),
          card({
            id: "chosen",
            title: "回憶",
            mode: "trigger",
            when: "想念對方時",
          }),
        ])
          assert.equal((await request("/api/clues", "POST", clue)).status, 201);
        await turn();
        const pre = server.received[0];
        assert.equal(pre.model, "file-model");
        assert.match(pre.messages[0].content, /下面是一些卡片/);
        assert.deepEqual(pre.messages.slice(1), recent);
        const formal = server.received[1].messages[0];
        assert.equal(formal.role, "system");
        assert.match(formal.content, /【常駐】/);
        assert.equal(formal.content.includes("【回憶】"), !selectionFails);
        assert.equal(
          (await request("/api/subscriptions/codex/use", "POST", {})).status,
          200,
        );
        await turn();
        assert.deepEqual(server.selections[0].messages, recent);
        assert.equal(
          server.systemPrompts[0],
          "【常駐】\n卡片內容" +
            (selectionFails ? "" : "\n\n【回憶】\n卡片內容"),
        );
        assert.equal(
          events.filter((event) => event?.type === "turn-started").length,
          2,
        );
      } finally {
        socket.close();
        await server.close();
      }
    },
  );
