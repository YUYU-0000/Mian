import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("conversation display ownership is distinct from the requested active ticket", async () => {
  const source = await readFile("client/src/App.tsx", "utf8");
  assert.match(source, /activeConversationId/);
  assert.match(source, /displayedConversationId/);
  assert.match(
    source,
    /conversationSessions\.get\(displayedConversationId\)/,
  );
  assert.doesNotMatch(source, /targetConversationId/);
  assert.match(source, /conversationSwitchGeneration/);
  assert.match(source, /conversationViewStates/);
  assert.doesNotMatch(source, /key=\{activeConversationId\}/);
  assert.doesNotMatch(source, /key=\{displayedConversationId\}/);
  assert.match(source, /captureConversationFrameRef/);
  assert.match(source, /latestTargetConversationId/);
  assert.doesNotMatch(source, /route-direction-/);
  assert.match(source, /onRegisterFrameCapture=\{registerConversationFrameCapture\}/);
});

test("the layered dissolve overlaps a frozen outgoing frame with one live incoming Store", async () => {
  const css = await readFile("client/src/ticket-drawer.css", "utf8");
  assert.match(
    css,
    /chatConversationOutgoingA 160ms ease-out forwards/,
  );
  assert.match(
    css,
    /chatConversationIncomingA 180ms ease-out 40ms forwards/,
  );
  const exitBody = css.match(
    /@keyframes chatConversationOutgoingA\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  const enterBody = css.match(
    /@keyframes chatConversationIncomingA\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(exitBody);
  assert.ok(enterBody);
  assert.match(exitBody, /opacity:\s*0/);
  assert.match(exitBody, /blur\(\.8px\)/);
  assert.match(enterBody, /opacity:\s*0/);
  assert.match(enterBody, /blur\(\.8px\)/);
  assert.doesNotMatch(`${exitBody}${enterBody}`, /translate|scale|rotate/);
  assert.match(css, /\.archive-message-stage::before[\s\S]*background:\s*var\(--bg\)/);
  assert.doesNotMatch(css, /\.archive-conversation-surface/);
});

test("only the message region is duplicated and the outgoing layer is inert frozen markup", async () => {
  const chat = await readFile("client/src/pages/Chat.tsx", "utf8");
  const app = await readFile("client/src/App.tsx", "utf8");
  assert.equal((chat.match(/useSyncExternalStore\(/g) ?? []).length, 1);
  assert.match(chat, /archive-message-layer-outgoing/);
  assert.match(chat, /dangerouslySetInnerHTML/);
  assert.match(chat, /element\.inert = true/);
  assert.match(chat, /<header className="archive-header">/);
  assert.match(chat, /<form[\s\S]*className="archive-input"/);
  assert.doesNotMatch(app, /<Chat\s+key=/);
  assert.match(chat, /ConversationTransitionView/);
});
