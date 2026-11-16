import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, Server } from "node:http";
import { BlockList, isIP } from "node:net";
import path from "node:path";
import { Router, json, type RequestHandler, type Response } from "express";
import { dataDirectory } from "./config.js";
import { WebSocket, WebSocketServer } from "ws";

const MONTH = 30 * 24 * 60 * 60 * 1000;
const LOCK_TIME = 10 * 60 * 1000;
const COOKIE = "__Host-mian";
const cookieOptions = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/" };
const localAddresses = new BlockList();
for (const [address, prefix] of [["127.0.0.0", 8], ["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16]] as const)
  localAddresses.addSubnet(address, prefix, "ipv4");
localAddresses.addAddress("::1", "ipv6");
localAddresses.addSubnet("fc00::", 7, "ipv6");
localAddresses.addSubnet("fe80::", 10, "ipv6");
const addressOf = (value: string) => value.replace(/^::ffff:/, "");
const privateAddress = (value: string) => {
  const address = addressOf(value), family = isIP(address);
  return family !== 0 && localAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
};
const hostname = (request: IncomingMessage) => new URL(`http://${request.headers.host || "invalid"}`).hostname.replace(/^\[|\]$/g, "");

// 免登录只认直连 IP 和本地 Host；隧道的回环连接不能获得本机权限。
export function isLocalRequest(request: IncomingMessage) {
  if (request.headers.forwarded || request.headers["x-forwarded-for"] || request.headers["x-forwarded-proto"] || request.headers["cf-connecting-ip"]) return false;
  const host = hostname(request);
  return privateAddress(request.socket.remoteAddress || "") && (host === "localhost" || privateAddress(host));
}
function isSetupRequest(request: IncomingMessage) {
  const address = addressOf(request.socket.remoteAddress || "");
  return isLocalRequest(request) && (address === "::1" || address === "127.0.0.1");
}
function secureRequest(request: IncomingMessage) {
  if ("encrypted" in request.socket && request.socket.encrypted) return true;
  const address = addressOf(request.socket.remoteAddress || "");
  return (address === "127.0.0.1" || address === "::1") &&
    request.headers.host === new URL(process.env.MIAN_PUBLIC_ORIGIN || "https://mian.crab-bless.com").host &&
    request.headers["x-forwarded-proto"] === "https";
}
function sameOrigin(request: IncomingMessage) {
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  return !origin || origin === `${secureRequest(request) ? "https" : "http"}://${request.headers.host}`;
}
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const passwordHash = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) =>
  scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
type AuthData = {
  password?: { salt: string; hash: string };
  localBypass: boolean;
  sessions: { hash: string; expiresAt: number }[];
  failures: number;
  lockedUntil: number;
};
class AuthError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export class Auth {
  private data: AuthData = { localBypass: true, sessions: [], failures: 0, lockedUntil: 0 };
  private writes: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly file = path.join(dataDirectory, "auth.json"), private readonly now = Date.now) {}

  async load() {
    try { this.data = JSON.parse(await readFile(this.file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return this;
  }
  private async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
  onChange(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  private session(request: IncomingMessage) {
    const token = request.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return token ? this.data.sessions.find(session => session.hash === digest(token) && session.expiresAt > this.now()) : undefined;
  }
  authenticated(request: IncomingMessage) {
    return !!this.data.password && ((this.data.localBypass && isLocalRequest(request)) || !!this.session(request));
  }
  status(request: IncomingMessage) {
    const authenticated = this.authenticated(request);
    return {
      configured: !!this.data.password, authenticated,
      canSetup: isSetupRequest(request), local: isLocalRequest(request),
      localBypass: authenticated ? this.data.localBypass : false,
      expiresAt: authenticated ? this.session(request)?.expiresAt ?? this.now() + MONTH : 0,
    };
  }
  private issue(response: Response) {
    const token = randomBytes(32).toString("base64url"), expiresAt = this.now() + MONTH;
    this.data.sessions = this.data.sessions.filter(session => session.expiresAt > this.now());
    this.data.sessions.push({ hash: digest(token), expiresAt });
    response.cookie(COOKIE, token, { ...cookieOptions, maxAge: MONTH });
    return expiresAt;
  }
  private async setPassword(value: unknown) {
    if (typeof value !== "string" || [...value].length < 10) throw new AuthError("密碼至少十個字，記牢。");
    const salt = randomBytes(16).toString("hex");
    this.data.password = { salt, hash: (await passwordHash(value, salt)).toString("hex") };
    this.data.sessions = [];
    this.data.failures = 0;
    this.data.lockedUntil = 0;
  }
  private async verify(value: unknown) {
    if (this.data.lockedUntil > this.now()) throw new AuthError("先停十分鐘，再敲門。", 429);
    if (this.data.lockedUntil) { this.data.failures = 0; this.data.lockedUntil = 0; }
    const password = this.data.password;
    if (!password) throw new AuthError("先在這台電腦上把門鎖好。", 403);
    const key = await passwordHash(typeof value === "string" ? value : "", password.salt);
    if (!timingSafeEqual(key, Buffer.from(password.hash, "hex"))) {
      this.data.failures++;
      if (this.data.failures >= 5) this.data.lockedUntil = this.now() + LOCK_TIME;
      await this.save();
      throw new AuthError(this.data.lockedUntil ? "先停十分鐘，再敲門。" : "不對，再想想。", this.data.lockedUntil ? 429 : 400);
    }
    this.data.failures = 0;
    this.data.lockedUntil = 0;
  }
  readonly protect: RequestHandler = (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (!sameOrigin(request)) { response.status(403).json({ error: "從自己的門進來。" }); return; }
    if (!this.authenticated(request)) { response.status(401).json({ error: "先敲門。" }); return; }
    next();
  };
  router() {
    const router = Router();
    router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
    router.get("/status", (request, response) => response.json(this.status(request)));
    router.use(json({ limit: "8kb" }));
    router.use((request, response, next) => {
      if (!sameOrigin(request)) { response.status(403).json({ error: "從自己的門進來。" }); return; }
      next();
    });
    const action = (operation: (request: import("express").Request, response: Response) => Promise<unknown>): RequestHandler => (request, response, next) => {
      // 串行验证，连续提交也计入同一把锁；密码与会话一起落盘。
      const result = this.writes.catch(() => {}).then(() => operation(request, response));
      this.writes = result;
      void result.catch(error => {
        if (error instanceof AuthError) {
          if (error.status === 429) response.setHeader("Retry-After", String(Math.ceil((this.data.lockedUntil - this.now()) / 1000)));
          response.status(error.status).json({ error: error.message });
        } else next(error);
      });
    };
    router.post("/setup", action(async (request, response) => {
      if (this.data.password || !isSetupRequest(request)) throw new AuthError("先在這台電腦上把門鎖好。", 403);
      await this.setPassword(request.body.password);
      const expiresAt = this.issue(response);
      await this.save();
      response.json({ ...this.status(request), authenticated: true, expiresAt });
    }));
    router.post("/login", action(async (request, response) => {
      if (!secureRequest(request) && !isSetupRequest(request)) throw new AuthError("用 https 網址來敲門。", 403);
      await this.verify(request.body.password);
      const expiresAt = this.issue(response);
      await this.save();
      response.json({ ...this.status(request), authenticated: true, localBypass: this.data.localBypass, expiresAt });
    }));
    router.use(this.protect);
    router.put("/settings", action(async (request, response) => {
      if (typeof request.body.localBypass !== "boolean") throw new AuthError("門鎖設定不對。");
      this.data.localBypass = request.body.localBypass;
      await this.save();
      this.changed();
      response.json(this.status(request));
    }));
    router.post("/password", action(async (request, response) => {
      await this.verify(request.body.currentPassword);
      await this.setPassword(request.body.password);
      const expiresAt = this.issue(response);
      await this.save();
      this.changed();
      response.json({ ...this.status(request), authenticated: true, localBypass: this.data.localBypass, expiresAt });
    }));
    router.post("/logout-all", action(async (request, response) => {
      this.data.sessions = [];
      await this.save();
      response.clearCookie(COOKIE, cookieOptions);
      this.changed();
      response.json(this.status(request));
    }));
    return router;
  }
}

export function authenticatedSockets(server: Server, auth: Auth) {
  const wss = new WebSocketServer({ noServer: true });
  const requests = new Map<WebSocket, IncomingMessage>();
  server.on("upgrade", (request, socket, head) => {
    if (request.url?.split("?")[0] !== "/ws" || !sameOrigin(request) || !auth.authenticated(request)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => {
      requests.set(ws, request);
      ws.on("close", () => requests.delete(ws));
      wss.emit("connection", ws, request);
    });
  });
  const expire = () => {
    for (const [ws, request] of requests)
      if (!auth.authenticated(request)) ws.close(4001, "login-required");
  };
  const stop = auth.onChange(expire);
  const timer = setInterval(expire, 30_000);
  timer.unref();
  server.on("close", () => { clearInterval(timer); stop(); });
  return wss;
}
