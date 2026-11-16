// 验证服务端登录保护、会话、限流与本机免登录边界。
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import express from "express";
import WebSocket from "ws";
import { Auth, authenticatedSockets, isLocalRequest } from "../server/src/auth.js";

// 使用真实 Host 构造隧道请求，fetch 会按 URL 重写 Host。
const fetch = (url: string, options: { method?: string; headers?: Record<string, string>; body?: string; } = {}) => new Promise<Response>((resolve, reject) => {
  const request = httpRequest(url, options, response => {
    const chunks: Buffer[] = [];
    response.on("data", chunk => chunks.push(chunk));
    response.on("end", () => {
      const headers = new Headers();
      for (let i = 0; i < response.rawHeaders.length; i += 2) headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
      resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
    });
  });
  request.on("error", reject);
  request.end(options.body);
});

test("login protects data and sockets, persists lockout, and revokes sessions", async t => {
  const dir = await mkdtemp(path.resolve(".tmp-auth-"));
  let now = Date.now();
  const auth = await new Auth(path.join(dir, "auth.json"), () => now).load();
  const app = express();
  app.use("/api/auth", auth.router());
  app.use("/api", auth.protect);
  app.use("/api", (_request, response) => response.json({ private: true }));
  const server = createServer(app);
  const wss = authenticatedSockets(server, auth);
  wss.on("connection", ws => ws.send("private event"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    server.close(); server.closeAllConnections();
    assert.ok(dir.startsWith(path.resolve(".tmp-auth-")));
    await rm(dir, { recursive: true, force: true });
  });
  const external = { host: "mian.crab-bless.com", "x-forwarded-proto": "https", "cf-connecting-ip": "203.0.113.7", origin: "https://mian.crab-bless.com" };
  const send = (url: string, body: unknown, headers: Record<string, string> = {}, method = "POST") => fetch(base + url, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const secret = "test-password-123";
  assert.equal((await fetch(base + "/api/config")).status, 401, "first run is locked even locally");
  assert.equal((await send("/api/auth/setup", { password: secret }, external)).status, 403);
  assert.equal((await send("/api/auth/setup", { password: "short" })).status, 400);
  assert.equal((await send("/api/auth/setup", { password: secret })).status, 200);
  assert.equal((await fetch(base + "/api/config")).status, 200);
  for (const url of ["/api/config", "/api/conversations", "/api/conversations/c1/files/test", "/api/voice-audio/test.mp3"])
    assert.equal((await fetch(base + url, { headers: external })).status, 401, url);
  assert.equal((await fetch(base + "/api/config", { headers: { host: "evil.example", "x-forwarded-for": "127.0.0.1" } })).status, 401);
  assert.equal((await send("/api/auth/login", { password: secret }, { ...external, origin: "https://evil.example" })).status, 403);
  const rejected = new WebSocket(base.replace("http:", "ws:") + "/ws", { headers: external });
  const denied = await once(rejected, "unexpected-response");
  assert.equal(denied[1].statusCode, 401); denied[1].resume(); rejected.terminate(); rejected.on("error", () => { });
  for (let i = 0; i < 5; i++) assert.equal((await send("/api/auth/login", { password: "wrong" }, external)).status, i === 4 ? 429 : 400);
  assert.equal((await send("/api/auth/login", { password: secret }, external)).status, 429);
  assert.ok(JSON.parse(await readFile(path.join(dir, "auth.json"), "utf8")).lockedUntil > now);
  now += 10 * 60_000 + 1;
  const login = await send("/api/auth/login", { password: secret }, external);
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!;
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Max-Age=2592000", "Path=/"]) assert.ok(cookie.includes(flag), flag);
  const headers = { ...external, cookie: cookie.split(";")[0] };
  assert.equal((await fetch(base + "/api/config", { headers })).status, 200);
  const persisted = await new Auth(path.join(dir, "auth.json"), () => now).load();
  assert.ok(persisted.authenticated({ headers, socket: { remoteAddress: "127.0.0.1" } } as any));
  const ws = new WebSocket(base.replace("http:", "ws:") + "/ws", { headers });
  assert.equal(String((await once(ws, "message"))[0]), "private event");
  const close = once(ws, "close");
  assert.equal((await send("/api/auth/logout-all", {}, headers)).status, 200);
  assert.equal((await close)[0], 4001);
  assert.equal((await fetch(base + "/api/config", { headers })).status, 401);
  const second = await send("/api/auth/login", { password: secret }, external);
  const currentHeaders = { ...external, cookie: second.headers.get("set-cookie")!.split(";")[0] };
  assert.equal((await send("/api/auth/settings", { localBypass: false }, currentHeaders, "PUT")).status, 200);
  assert.equal((await fetch(base + "/api/config")).status, 401);
  const changed = await send("/api/auth/password", { currentPassword: secret, password: "new-password-123" }, currentHeaders);
  assert.equal(changed.status, 200);
  assert.equal((await fetch(base + "/api/config", { headers: currentHeaders })).status, 401);
  const freshHeaders = { ...external, cookie: changed.headers.get("set-cookie")!.split(";")[0] };
  now += 30 * 24 * 60 * 60_000 + 1;
  assert.equal((await fetch(base + "/api/config", { headers: freshHeaders })).status, 401);
  const stored = await readFile(path.join(dir, "auth.json"), "utf8");
  assert.ok(!stored.includes("new-password-123") && !stored.includes(cookie.split(";")[0].split("=")[1]));
});

test("LAN bypass cannot be obtained with forwarded headers or a public Host", () => {
  const local = (address: string, headers: Record<string, string>) => isLocalRequest({ headers, socket: { remoteAddress: address } } as any);
  assert.ok(local("192.168.1.2", { host: "192.168.1.3:5173" }));
  assert.ok(local("::1", { host: "localhost:5173" }));
  assert.equal(local("127.0.0.1", { host: "mian.crab-bless.com" }), false);
  assert.equal(local("203.0.113.2", { host: "localhost:5173" }), false);
  assert.equal(local("127.0.0.1", { host: "localhost:5173", "x-forwarded-for": "127.0.0.1" }), false);
});
