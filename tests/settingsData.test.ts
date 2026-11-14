import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileTicketServer } from "./fileTickets.server.mjs";
import {
  backupFilename,
  completeBackup,
  restoreBrowserBackup,
  type Backup,
} from "../client/src/settingsBackup.ts";
import {
  CHAT_STORAGE_KEY,
  applyReplyEvent,
  appendUserRecord,
  type ReplyGroup,
} from "../client/src/chatModel.ts";

test("字体纸片保存草稿、切换快照、恢复预设并禁止删除预设", async () => {
  const server = await fileTicketServer();
  try {
    const read = async () =>
      (await fetch(`${server.base}/api/font-presets`)).json();
    const save = async (preset: unknown, use = false) => {
      const response = await fetch(`${server.base}/api/font-presets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset, use }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const initial = await read();
    assert.equal(initial.presets[0].name, "預設");
    assert.equal(initial.style.size, 14.5);
    const preset = {
      id: "font-2",
      name: "紙上",
      face: "@font-face { font-family: Paper; src: url(https://fonts.example/paper.woff2); }",
      size: 16.5,
      view: "中文 English 123",
    };
    assert.equal((await save(preset)).activeId, "1");
    const used = await save(preset, true);
    assert.equal(used.activeId, preset.id);
    assert.deepEqual(used.style, { face: preset.face, size: preset.size });
    const draft = await save({ ...preset, size: 11.5 });
    assert.equal(draft.presets[1].size, 11.5);
    assert.equal(draft.style.size, 16.5);
    const persisted = JSON.parse(
      await readFile(
        path.join(server.directory, "server/data/font-presets.json"),
        "utf8",
      ),
    );
    assert.deepEqual(persisted, draft);
    const reset = await save(
      { ...initial.presets[0], name: "改名", face: preset.face, size: 17.5 },
      true,
    );
    assert.equal(reset.presets[0].name, "預設");
    assert.deepEqual(reset.style, { face: "", size: 14.5 });
    assert.equal(
      (await fetch(`${server.base}/api/font-presets/1`, { method: "DELETE" }))
        .status,
      400,
    );
    await save(preset, true);
    const deleted = await (
      await fetch(`${server.base}/api/font-presets/font-2`, {
        method: "DELETE",
      })
    ).json();
    assert.equal(deleted.activeId, "1");
    assert.equal(deleted.presets.length, 1);
  } finally {
    await server.close();
  }
});

test("备份覆盖档案和设置，保留本机同地址的 Key，拒绝无效备份", async () => {
  const server = await fileTicketServer();
  try {
    const get = async (url: string) => (await fetch(server.base + url)).json();
    const original = await get("/api/backup");
    assert.equal(original.format, "mian-backup");
    assert.doesNotMatch(
      JSON.stringify(original),
      /fake-key|keyHint|hasKey|"key"/,
    );
    const backup = {
      ...structuredClone(original),
      chats: { c1: [] },
      preferences: {},
      fonts: {
        ...original.fonts,
        presets: [
          ...original.fonts.presets,
          {
            id: "custom",
            name: "字體",
            face: "https://example.com/font.woff2",
            view: "hello",
            size: 15.5,
          },
        ],
      },
    };
    backup.conversations[0].title = "還原的對話";
    backup.config.channel = { kind: "codex" };
    const post = (body: unknown) =>
      fetch(`${server.base}/api/backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal((await post({ ...backup, chats: {} })).status, 400);
    assert.equal(
      (
        await post({
          ...backup,
          chats: {
            c1: [
              { role: "user", time: "12:00", groupId: "u", records: [null] },
            ],
          },
        })
      ).status,
      400,
    );
    assert.deepEqual(
      (await get("/api/backup")).conversations,
      original.conversations,
    );
    assert.equal((await post(backup)).status, 200);
    const restored = await get("/api/backup");
    assert.equal(restored.conversations[0].title, "還原的對話");
    assert.equal(restored.config.channel.kind, "codex");
    assert.equal(restored.fonts.presets[1].name, "字體");
    const presetsFile = path.join(
      server.directory,
      "server/data/api-presets.json",
    );
    assert.equal(
      JSON.parse(await readFile(presetsFile, "utf8")).presets[0].key,
      "fake-key",
    );
    backup.apiPresets[0].endpoint = "https://new-provider.example";
    assert.equal((await post(backup)).status, 200);
    assert.equal(
      JSON.parse(await readFile(presetsFile, "utf8")).presets[0].key,
      "",
    );
  } finally {
    await server.close();
  }
});

test("浏览器备份包含完整气泡和文件信息，导入清除旧对话及运行状态", () => {
  const storage = Object.create(null) as Storage;
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => storage[key] ?? null },
    setItem: {
      value: (key: string, value: string) => {
        storage[key] = value;
      },
    },
    removeItem: {
      value: (key: string) => {
        delete storage[key];
      },
    },
  });
  const reply = applyReplyEvent(
    [],
    { type: "turn-started", turnId: "reply", conversationId: "c1" },
    "12:40",
  )[0] as ReplyGroup;
  reply.bubbles = ["第一段", "第二段"];
  reply.thinking = "公開心裡話";
  const groups = [...appendUserRecord([], "你好", "12:39", "message"), reply];
  storage.setItem(CHAT_STORAGE_KEY, JSON.stringify(groups));
  storage.setItem("launcher_settings", JSON.stringify({ cssVars: {} }));
  const backup = completeBackup(
    { conversations: [{ conversationId: "c1" }] } as Backup,
    storage,
  );
  assert.equal(backup.chats.c1[1].role, "assistant");
  assert.equal((backup.chats.c1[1] as typeof reply).thinking, reply.thinking);
  storage.setItem("mian.conversation.old.mian.chat-groups.v2", "[]");
  storage.setItem("mian.chat-session.v1", "running");
  restoreBrowserBackup(backup, storage);
  assert.equal(
    storage.getItem("mian.conversation.old.mian.chat-groups.v2"),
    null,
  );
  assert.equal(storage.getItem("mian.chat-session.v1"), null);
  assert.equal(storage.getItem(CHAT_STORAGE_KEY), null);
  const restored = JSON.parse(
    storage.getItem(`mian.conversation.c1.${CHAT_STORAGE_KEY}`)!,
  );
  assert.deepEqual(restored[1].bubbles, reply.bubbles);
  assert.equal(restored[1].status, "interrupted");
  assert.deepEqual(restored[1].approvals, []);
  assert.equal(
    backupFilename(new Date(2026, 10, 15)),
    "mian-backup-20261115.json",
  );
});
