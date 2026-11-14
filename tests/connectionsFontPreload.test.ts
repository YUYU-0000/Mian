import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function linkAttributes(html: string) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  return tags.map((tag) => {
    const attributes = new Map<string, string>();
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    const body = tag.replace(/^<link\b/i, "").replace(/\/?>$/, "");
    for (const match of body.matchAll(pattern))
      attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
    return attributes;
  });
}

function preloadFor(links: Map<string, string>[], href: string) {
  return links.filter((attributes) => {
    const rel = attributes.get("rel")?.toLowerCase().split(/\s+/) ?? [];
    return attributes.get("href") === href && rel.includes("preload");
  });
}

function cssRule(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

test("Connections fonts needed on first entry are preloaded exactly once", async () => {
  const html = await readFile("client/index.html", "utf8");
  const links = linkAttributes(html);
  const light = preloadFor(links, "/fonts/zsft/light.woff2");
  const main = preloadFor(links, "/fonts/zsft/main.woff2");

  assert.equal(light.length, 1);
  assert.equal(light[0].get("as"), "font");
  assert.equal(light[0].get("type"), "font/woff2");
  assert.ok(light[0].has("crossorigin"));

  assert.equal(main.length, 1);
  assert.equal(main[0].get("as"), "font");
  assert.equal(main[0].get("type"), "font/woff2");
  assert.ok(main[0].has("crossorigin"));
});

test("Connections title typography and the 220ms route transition stay intact", async () => {
  const [layout, connections, theme, motion] = await Promise.all([
    readFile("client/src/pages/ConnectionLayout.tsx", "utf8"),
    readFile("client/src/pages/connections.css", "utf8"),
    readFile("client/src/theme.css", "utf8"),
    readFile("client/src/mobile-fixes.css", "utf8"),
  ]);

  assert.match(
    layout,
    /className="env1-title-text">[\s\S]*?CLOUD[\s\S]*?<span className="maison">PLANS<\/span>/,
  );

  const title = cssRule(connections, ".connections-page .env1-title-text");
  assert.match(title, /font-size:\s*52px/);
  assert.match(title, /letter-spacing:\s*5px/);
  assert.match(title, /transform:\s*rotate\(90deg\) translateY\(-100%\)/);
  assert.match(cssRule(connections, ".connections-page .env1-title-text .maison"), /font-weight:\s*300/);

  const lightFace = (theme.match(/@font-face\s*\{[^}]*\}/g) ?? []).find(
    (block) => block.includes("/fonts/zsft/light.woff2"),
  );
  assert.ok(lightFace);
  assert.match(lightFace, /font-family:\s*ZSFT-br/);
  assert.match(lightFace, /font-weight:\s*300/);
  assert.match(lightFace, /font-display:\s*swap/);

  assert.match(motion, /animation:\s*routeControlPress 40ms ease-out both/);
  assert.match(motion, /animation:\s*routePageEnter 180ms ease-out both/);
});
