import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("chat disclosures use the final design grid and timing contract", async () => {
  const css = await readFile("client/src/mobile-fixes.css", "utf8");
  const chat = await readFile("client/src/pages/Chat.tsx", "utf8");
  const motionCss = css.slice(
    css.indexOf("/* Original collapsible motion"),
    css.indexOf("/* Paper-only local font"),
  );

  assert.match(css, /grid-template-rows:\s*0fr/);
  assert.match(css, /grid-template-rows 280ms ease/);
  assert.match(css, /\.step-body-wrap\s*\{[\s\S]*?transition-duration:\s*220ms, 220ms/);
  assert.match(css, /\.archive-module\.is-expanded[\s\S]*?grid-template-rows:\s*1fr/);
  assert.match(css, /opacity:\s*0;\s*transform:\s*translateY\(-3px\)/);
  assert.match(css, /opacity 240ms ease 20ms/);
  assert.match(css, /transition:\s*transform 220ms ease/);
  assert.doesNotMatch(motionCss, /visibility/);
  assert.match(css, /\.archive-tool-step::before\s*\{[\s\S]*?transform-origin:\s*top;[\s\S]*?transform:\s*scaleY\(0\);[\s\S]*?transition:\s*transform 240ms ease/);
  assert.match(css, /\.archive-module\.is-expanded \.archive-tool-step::before\s*\{[\s\S]*?transform:\s*scaleY\(1\);[\s\S]*?transition:\s*transform 280ms ease 120ms/);
  assert.match(chat, /useDisclosureMotion\(280\)/);
  assert.match(chat, /const toggleToolExpansion[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?setExpandedTools/);
  assert.match(chat, /setExpanded\(false\);[\s\S]*?window\.setTimeout\([\s\S]*?setMounted\(false\)/);
  assert.match(chat, /open=\{disclosure\.mounted\}/);
  assert.equal((css.match(/^\.step-head\s*\{/gm) ?? []).length, 1);
  assert.equal((motionCss.match(/margin-left:\s*22px/g) ?? []).length, 1);
});
