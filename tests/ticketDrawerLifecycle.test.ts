import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ticket entrance timing is single-flight and cleaned up on unmount", async () => {
  const source = await readFile(
    "client/src/components/TicketDrawer.tsx",
    "utf8",
  );
  assert.match(source, /const enteringTimer = useRef<number \| null>\(null\)/);
  assert.match(
    source,
    /if \(enteringTimer\.current !== null\)\s*window\.clearTimeout\(enteringTimer\.current\)/,
  );
  assert.match(
    source,
    /enteringTimer\.current = window\.setTimeout\(\(\) => \{[\s\S]*?enteringTimer\.current = null;[\s\S]*?setEnteringId\(null\)/,
  );
  assert.doesNotMatch(source, /removedId: conversationId/);
  assert.match(source, /const pinFrame = useRef<number \| null>\(null\)/);
  assert.match(source, /cancelAnimationFrame\(pinFrame\.current\)/);
});
