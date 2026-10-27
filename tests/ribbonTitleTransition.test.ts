import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ribbon title crossfades only its overlapping text layers", async () => {
  const title = await readFile(
    "client/src/components/ArchiveRibbonTitle.tsx",
    "utf8",
  );
  const css = await readFile("client/src/ticket-drawer.css", "utf8");
  assert.match(title, /function ArchiveRibbonTitle/);
  assert.match(title, /archive-title-outgoing/);
  assert.match(title, /archive-title-incoming/);
  assert.match(title, /data-title-transition-generation/);
  assert.match(css, /archiveTitleInkOut 90ms ease-out forwards/);
  assert.match(css, /archiveTitleInkIn 130ms ease-out 30ms forwards/);
  assert.match(css, /blur\(\.6px\)/);
  assert.match(
    css,
    /#archiveRibbonTitle[\s\S]*width:\s*180px[\s\S]*height:\s*20px[\s\S]*background:\s*#e2dacf/,
  );
  const titleAnimations = css.match(
    /@keyframes archiveTitleInkOut[\s\S]*?@keyframes archiveTitleInkIn[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(titleAnimations);
  assert.doesNotMatch(titleAnimations, /translate|scale|rotate/);
});

test("title source is the formally displayed conversation and rename updates only after PATCH resolves", async () => {
  const app = await readFile("client/src/App.tsx", "utf8");
  const chat = await readFile("client/src/pages/Chat.tsx", "utf8");
  assert.match(
    chat,
    /<ArchiveRibbonTitle[\s\S]*conversationId=\{displayedConversation\.conversationId\}[\s\S]*title=\{displayedConversation\.title\}/,
  );
  assert.doesNotMatch(chat, /ArchiveRibbonTitle[\s\S]{0,180}activeConversationId/);
  assert.match(
    app,
    /const \{ conversation \} = await api\.updateConversation\(conversationId, patch\);[\s\S]*setConversations/,
  );
});
