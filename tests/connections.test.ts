import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import type { CodexBridge } from "../server/src/codex.ts";

test("connection routes persist presets and use the selected endpoint and credentials", async () => {
  const workspace = process.cwd();
  const directory = await mkdtemp(path.join(workspace, ".tmp-connection-test-"));
  process.chdir(directory);
  const { connectionRoutes } = await import("../server/src/connections.ts");
  const calls: string[] = [];
  const bridge = {
    connect: async () => {},
    readAccount: async () => ({ loggedIn: true, account: "test@example.com", plan: "plus" }),
    request: async (method: string, params: { cursor?: string }) => {
      calls.push(method);
      if (method === "model/list") return params.cursor
        ? { data: [{ model: "second" }], nextCursor: null }
        : { data: [{ model: "first" }], nextCursor: "next" };
      return { loginId: "login", authUrl: "https://example.com/login" };
    },
  } as unknown as CodexBridge;
  const provider = express();
  provider.use(express.json());
  provider.get("/v1/models", (req, res) => {
    if (req.headers.authorization !== "Bearer test-key") { res.status(401).json({ error: "金鑰不正確" }); return; }
    res.json({ data: [{ id: "example-model" }] });
  });
  provider.post("/v1/chat/completions", (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-key");
    assert.equal(req.body.model, "example-model");
    res.json({ choices: [{ message: { content: "hello" } }] });
  });
  const providerServer = provider.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => providerServer.once("listening", resolve));
  const app = express(); app.use(express.json()); app.use("/api", connectionRoutes(bridge));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const endpoint = `http://127.0.0.1:${(providerServer.address() as AddressInfo).port}`;
  const request = async (route: string, method = "GET", body?: unknown) => {
    const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(response.ok, true);
    return response.json();
  };
  try {
    assert.deepEqual(await request("/api-presets"), { presets: [], activeId: null });
    const preset = await request("/api-presets", "POST", { id: "", note: "first", endpoint, key: "test-key", model: "example-model" });
    assert.ok(preset.id);
    await request("/api-presets", "POST", { ...preset, note: "updated" });
    await request(`/api-presets/${preset.id}/use`, "POST");
    const stored = JSON.parse(await readFile(path.join(directory, "server/data/api-presets.json"), "utf8"));
    assert.equal(stored.activeId, preset.id);
    assert.equal(stored.presets.length, 1);
    assert.equal(stored.presets[0].note, "updated");
    assert.deepEqual(await request("/api-models", "POST", preset), ["example-model"]);
    assert.deepEqual(await request("/api-models", "POST", { ...preset, endpoint: endpoint + "/v1/" }), ["example-model"]);
    await request("/api-test", "POST", preset);
    const failed = await fetch(base + "/api-models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...preset, key: "invalid" }) });
    assert.equal(failed.ok, false);
    assert.match((await failed.json()).error, /401.*金鑰不正確/);
    await request(`/api-presets/${preset.id}`, "DELETE");
    assert.deepEqual(await request("/api-presets"), { presets: [], activeId: null });
    assert.equal((await request("/subscriptions/codex")).loggedIn, true);
    assert.deepEqual(await request("/subscriptions/codex/models"), ["first", "second"]);
    await request("/subscriptions/codex/login", "POST");
    await request("/subscriptions/codex/logout", "POST");
    assert.ok(calls.includes("account/login/start"));
    assert.ok(calls.includes("account/logout"));
  } finally {
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => providerServer.close(() => resolve()))]);
    process.chdir(workspace);
    assert.equal(path.dirname(directory), workspace);
    await rm(directory, { recursive: true });
  }
});
