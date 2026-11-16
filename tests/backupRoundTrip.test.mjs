// 用超过旧 64 MB 上限的隔离备份验证聊天、附件、语音和设置完整还原，凭据不导出。
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { fileTicketServer, imageBytes } from "./fileTickets.server.mjs";
import { appendUserRecord } from "../shared/chatModel.mjs";
import { mp3 } from "./voiceFixtures.mjs";

test("large complete backup restores data and covers without exporting credentials", { timeout: 90000 }, async () => {
  const backend = await fileTicketServer();
  const request = async (url, init) => {
    const response = await fetch(backend.base + url, init);
    assert.equal(response.status, 200, response.ok ? undefined : await response.text());
    return response.json();
  };
  try {
    const backup = await request("/api/backup");
    backup.preferences = {};
    backup.conversations[0].image = `data:image/png;base64,${imageBytes.toString("base64")}`;
    const conversationId = backup.conversations[0].conversationId;
    const contents = [Buffer.alloc(17 * 1024 * 1024, 17), Buffer.alloc(17 * 1024 * 1024, 31), Buffer.alloc(17 * 1024 * 1024, 49), mp3()];
    backup.files = contents.map((content, i) => ({
      conversationId,
      file: { id: `backup-file-${i}`, name: i === 3 ? "voice.mp3" : `attachment-${i}.bin`, mimeType: i === 3 ? "audio/mpeg" : "application/octet-stream", size: content.length, createdAt: "2026-11-17T00:00:00Z" },
      content: content.toString("base64"),
    }));
    backup.chats[conversationId] = appendUserRecord([], "完整還原這一條記錄", "00:00", "message-1", "group-1", backup.files.map(entry => entry.file));
    backup.voices.presets[0].note = "備份聲音";
    backup.voices.presets[0].words = "保留語音設定";
    backup.clues.cards = [{ id: "backup-clue", title: "備份線索", content: "完整正文", mode: "pinned", when: "", scenes: [], layout: 0, order: 0, x: 20, y: 40, w: 100, h: 120, r: 0, createdAt: "2026-11-17", updatedAt: "2026-11-17" }];
    const body = JSON.stringify(backup);
    assert.ok(Buffer.byteLength(body) > 64 * 1024 * 1024);
    await request("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const restored = await request("/api/backup");
    assert.equal(restored.conversations[0].image, backup.conversations[0].image);
    assert.equal(restored.chats[conversationId][0].records[0].text, "完整還原這一條記錄");
    assert.deepEqual(restored.clues, backup.clues);
    assert.deepEqual(restored.voices, backup.voices);
    assert.deepEqual(restored.fonts, backup.fonts);
    assert.deepEqual(restored.config, backup.config);
    assert.equal(restored.files.length, contents.length);
    for (const entry of restored.files) {
      const index = Number(entry.file.id.split("-").at(-1));
      assert.equal(createHash("sha256").update(Buffer.from(entry.content, "base64")).digest("hex"), createHash("sha256").update(contents[index]).digest("hex"));
    }
    assert.doesNotMatch(JSON.stringify(restored), /fake-key|fixture-password-only|passwordHash|keyHint|hasKey/);
    assert.equal(Object.hasOwn(restored, "auth"), false);
    assert.equal((await request("/api/api-presets")).presets[0].hasKey, true, "local API key survives import without entering the backup");
  } finally { await backend.close(); }
});
