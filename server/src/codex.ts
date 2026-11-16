import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import path from "node:path";
import { CODEX_PERMISSIONS, codexArguments, codexOverrides } from "./codexSecurity.js";
import type {
  AppConfig,
  ConversationRuntimeMetadata,
  ConversationThreadBinding,
  PendingApproval,
  RpcMessage,
} from "./types.js";
import { ConversationRuntimeRegistry } from "./conversationRuntime.js";
import { CodexClueSelection } from "./codexClueSelection.js";
import type { ChatMessage } from "./providers/openai.js";
import {
  handleCodexNotification,
} from "./codexEvents.js";
import {
  MIAN_PUBLIC_REPLY_CONTEXT_KEY,
  MIAN_PUBLIC_REPLY_PROTOCOL,
  MIAN_TURN_CONTEXT_KEY,
} from "./publicReplyProtocol.js";

type Waiter = {
  instanceId: number;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type ConnectionStatus = {
  state: "ready" | "login-required";
  message: string;
  version: string;
  account?: string;
};

type AppServerLifecycleState =
  "idle" | "starting" | "ready" | "stopping" | "exited" | "failed";

export type AppServerSpawner = (
  config: AppConfig,
) => ChildProcessWithoutNullStreams;

type AppServerInstance = {
  id: number;
  child: ChildProcessWithoutNullStreams;
  retiring: boolean;
  terminated: boolean;
  failureReported: boolean;
  exited: Promise<void>;
  resolveExited: () => void;
};

const defaultSpawner: AppServerSpawner = (config) =>
  spawn(process.env.MIAN_CODEX_BIN || "codex", codexArguments(config), {
    cwd: config.workingDirectory,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, ...(process.env.MIAN_CODEX_HOME ? { CODEX_HOME: process.env.MIAN_CODEX_HOME } : {}) },
  });

const configKey = (config: AppConfig) =>
  JSON.stringify({
    workingDirectory: config.workingDirectory,
    sandbox: config.sandbox,
    model: config.model,
  });

export class CodexBridge extends EventEmitter {
  private current?: AppServerInstance;
  private generation = 0;
  private lifecycleState: AppServerLifecycleState = "idle";
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private pendingConnects = new Map<string, Promise<ConnectionStatus>>();
  private lastStatus?: ConnectionStatus;
  private seq = 1;
  private waiters = new Map<number | string, Waiter>();
  private readonly conversations = new ConversationRuntimeRegistry();
  private readonly clueSelection = new CodexClueSelection();
  private readonly codeModeCalls = new Map<string, string>();
  version = "";
  config?: AppConfig;

  constructor(
    private readonly spawnAppServer: AppServerSpawner = defaultSpawner,
  ) {
    super();
  }

  getThreadId(conversationId: string) {
    return this.conversations.require(conversationId).threadId;
  }

  async readAccount() {
    const { account } = (await this.request("account/read", {
      refreshToken: false,
    })) as {
      account: { type: string; email?: string; planType?: string } | null;
    };
    const status: ConnectionStatus = {
      state: account ? "ready" : "login-required",
      message: account
        ? "Codex app-server 已连接"
        : "app-server 已连接，但 Codex 尚未登录",
      version: this.version,
      account: account?.email || account?.type,
    };
    this.lastStatus = status;
    this.emit("event", { type: "connection", status });
    return {
      loggedIn: !!account,
      account: account?.email || account?.type || "",
      plan: account?.planType || "",
    };
  }

  getActiveTurnId(conversationId: string) {
    return this.conversations.require(conversationId).activeTurnId;
  }

  restoreConversationThreads(
    records: Array<{ conversationId: string; threadId: string | null }>,
  ) {
    this.conversations.restore(records);
  }

  registerConversationThread(
    conversationId: string,
    threadId: string,
    loaded = false,
  ) {
    this.conversations.setThread(conversationId, threadId);
    this.conversations.require(conversationId).loaded = loaded;
  }

  getActiveTurns() {
    return this.conversations.getActiveTurns();
  }

  connect(config: AppConfig): Promise<ConnectionStatus> {
    const key = configKey(config);
    const existing = this.pendingConnects.get(key);
    if (existing) return existing;

    const queued = this.lifecycleQueue.then(() => this.ensureConnected(config));
    let tracked!: Promise<ConnectionStatus>;
    tracked = queued.finally(() => {
      if (this.pendingConnects.get(key) === tracked)
        this.pendingConnects.delete(key);
    });
    this.pendingConnects.set(key, tracked);
    this.lifecycleQueue = tracked.then(
      () => undefined,
      () => undefined,
    );
    return tracked;
  }

  getLifecycleSnapshot() {
    return {
      state: this.lifecycleState,
      instanceId: this.current?.id ?? null,
      pid: this.current?.child.pid ?? null,
      activeTurns: this.getActiveTurns(),
      configKey: this.config ? configKey(this.config) : null,
    };
  }

  private async ensureConnected(config: AppConfig): Promise<ConnectionStatus> {
    const wantedKey = configKey(config);
    const currentIsHealthy =
      this.current !== undefined &&
      !this.current.retiring &&
      this.current.child.exitCode === null &&
      this.current.child.signalCode === null;

    if (
      currentIsHealthy &&
      this.lifecycleState === "ready" &&
      this.config &&
      configKey(this.config) === wantedKey &&
      this.lastStatus
    )
      return this.lastStatus;

    if (this.current && this.conversations.activeTurnCount() > 0)
      throw new Error("当前会话正在运行，暂不能重建 app-server");

    if (this.current) await this.retireCurrent("连接配置已替换");

    this.config = config;
    this.lastStatus = undefined;
    this.lifecycleState = "starting";

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnAppServer(config);
    } catch (error) {
      this.lifecycleState = "failed";
      throw error;
    }

    let resolveExited!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve;
    });
    const instance: AppServerInstance = {
      id: ++this.generation,
      child,
      retiring: false,
      terminated: false,
      failureReported: false,
      exited,
      resolveExited,
    };
    this.current = instance;
    this.codeModeCalls.clear();
    this.conversations.clearTransientState();

    const terminate = (code: number | null, signal: NodeJS.Signals | null) =>
      this.handleTermination(instance, code, signal);
    child.once("exit", terminate);
    child.once("close", terminate);
    child.once("error", (error) => this.handleProcessError(instance, error));
    child.stderr.on("data", (data) => this.emit("log", String(data)));
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      if (!this.isCurrent(instance)) return;
      try {
        this.receive(instance.id, JSON.parse(line));
      } catch {
        this.emit("log", `无法解析 app-server 输出: ${line}`);
      }
    });

    try {
      const init = (await this.request("initialize", {
        clientInfo: {
          name: "mian-chat",
          title: "Mian Chat",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      })) as any;
      if (!this.isCurrent(instance)) throw new Error("app-server 实例已失效");
      this.version = String(init.userAgent || "codex");
      this.notify("initialized");
      const account = (await this.request("account/read", {
        refreshToken: false,
      }).catch(() => null)) as any;
      if (!this.isCurrent(instance)) throw new Error("app-server 实例已失效");
      const status: ConnectionStatus = account?.account
        ? {
            state: "ready",
            message: "Codex app-server 已连接",
            version: this.version,
            account: account.account.email || account.account.type,
          }
        : {
            state: "login-required",
            message: "app-server 已连接，但 Codex 尚未登录",
            version: this.version,
          };
      this.lifecycleState = "ready";
      this.lastStatus = status;
      this.emit("event", { type: "connection", status });
      return status;
    } catch (error) {
      if (this.isCurrent(instance)) {
        this.lifecycleState = "failed";
        await this.retireCurrent("app-server 初始化失败");
        this.lifecycleState = "failed";
      }
      throw error;
    }
  }

  private isCurrent(instance: AppServerInstance) {
    return this.current?.id === instance.id;
  }

  private handleTermination(
    instance: AppServerInstance,
    code: number | null,
    signal: NodeJS.Signals | null,
  ) {
    if (instance.terminated) return;
    instance.terminated = true;
    instance.resolveExited();

    if (!this.isCurrent(instance)) {
      this.emit(
        "log",
        `忽略已退休 app-server #${instance.id} 的退出事件 (${code ?? signal ?? "unknown"})`,
      );
      return;
    }

    this.current = undefined;
    this.rejectWaitersFor(
      instance.id,
      new Error(`app-server 已退出 (${code ?? signal ?? "unknown"})`),
    );
    const interruptedTurns = this.conversations.clearTransientState();
    this.lastStatus = undefined;

    if (instance.retiring) {
      this.lifecycleState = "idle";
      return;
    }

    this.lifecycleState = "exited";
    for (const [conversationId] of interruptedTurns)
      this.emit("event", {
        type: "error",
        conversationId,
        message: `app-server exited (${code ?? signal ?? "unknown"})`,
      });
    if (!instance.failureReported) {
      instance.failureReported = true;
      this.emit("event", {
        type: "connection",
        status: {
          state: "error",
          message: `app-server 已退出 (${code ?? signal ?? "unknown"})`,
        },
      });
    }
  }

  private handleProcessError(instance: AppServerInstance, error: Error) {
    if (!this.isCurrent(instance)) {
      this.emit(
        "log",
        `忽略已退休 app-server #${instance.id} 的错误: ${error.message}`,
      );
      return;
    }

    instance.failureReported = true;
    instance.terminated = true;
    instance.resolveExited();
    this.current = undefined;
    this.lifecycleState = "failed";
    this.lastStatus = undefined;
    this.rejectWaitersFor(instance.id, error);
    const interruptedConversations = this.conversations
      .clearTransientState()
      .map(([conversationId]) => conversationId);
    for (const conversationId of interruptedConversations)
      this.emit("event", {
        type: "error",
        conversationId,
        message: error.message,
      });
    this.emit("event", {
      type: "connection",
      status: { state: "error", message: error.message },
    });
  }

  private async retireCurrent(reason: string) {
    const instance = this.current;
    if (!instance) return;

    instance.retiring = true;
    this.lifecycleState = "stopping";
    this.current = undefined;
    this.rejectWaitersFor(instance.id, new Error(reason));
    this.conversations.clearTransientState();
    instance.child.kill();
    await this.waitForExit(instance);
    this.lifecycleState = "idle";
  }

  private async waitForExit(instance: AppServerInstance) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      instance.exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2_000);
        timer.unref?.();
      }),
    ]);
    if (timer) clearTimeout(timer);
  }

  private receive(instanceId: number, msg: RpcMessage) {
    if (this.current?.id !== instanceId) return;
    if (msg.id !== undefined && !msg.method) {
      const waiter = this.waiters.get(msg.id);
      if (!waiter || waiter.instanceId !== instanceId) return;
      clearTimeout(waiter.timer);
      this.waiters.delete(msg.id);
      msg.error
        ? waiter.reject(new Error(msg.error.message))
        : waiter.resolve(msg.result);
      return;
    }
    if (msg.id !== undefined && msg.method) {
      this.handleServerRequest(msg);
      return;
    }
    if (msg.method) this.handleNotification(msg.method, msg.params as any);
  }

  private handleServerRequest(msg: RpcMessage) {
    const map: Record<string, PendingApproval["kind"]> = {
      "item/commandExecution/requestApproval": "command",
      "item/fileChange/requestApproval": "file",
      "item/permissions/requestApproval": "permissions",
      execCommandApproval: "command",
      applyPatchApproval: "file",
    };
    const kind = map[msg.method!];
    if (!kind) {
      this.respondError(msg.id!, -32601, `客户端未实现请求 ${msg.method}`);
      return;
    }
    this.respond(msg.id!, kind === "permissions" ? { permissions: {}, scope: "turn" } : { decision: "decline" });
    return;
  }

  private handleNotification(method: string, params: any) {
    if (this.clueSelection.receive(method, params)) return;
    handleCodexNotification(
      this.conversations,
      this.emit.bind(this),
      method,
      params,
      this.codeModeCalls,
    );
  }

  private threadOptions(conversationId: string) {
    if (!this.config) throw new Error("尚未连接 Codex");
    // 正式线程沿用固定的默认 baseInstructions，逐轮上下文只交给 turn/start。
    return {
      cwd: path.join(this.config.workingDirectory, conversationId),
      permissions: CODEX_PERMISSIONS,
      runtimeWorkspaceRoots: [this.config.workingDirectory],
      config: codexOverrides(this.config),
      model: this.config.model || null,
      approvalPolicy: "never",
      approvalsReviewer: "user",
    };
  }

  private threadBinding(result: any): ConversationThreadBinding {
    const metadata: Partial<ConversationRuntimeMetadata> = {};
    if (typeof result?.model === "string" && result.model)
      metadata.model = result.model;
    if (typeof result?.reasoningEffort === "string")
      metadata.reasoningEffort = result.reasoningEffort;
    else if (result?.reasoningEffort === null) metadata.reasoningEffort = null;
    return {
      threadId: String(result.thread.id),
      metadata,
    };
  }

  private ensureConversationThread(conversationId: string) {
    const runtime = this.conversations.require(conversationId);
    const pending = runtime.threadOperation;
    if (pending) return pending;

    const operation = (async () => {
      if (!this.current || this.lifecycleState !== "ready" || !this.config)
        throw new Error("尚未连接 Codex");
      const existingThreadId = runtime.threadId;
      if (existingThreadId && runtime.loaded) return existingThreadId;

      let result: any;
      if (existingThreadId) {
        try {
          result = await this.request("thread/resume", {
            threadId: existingThreadId,
            ...this.threadOptions(conversationId),
            excludeTurns: true,
          });
        } catch (error) {
          if (!/no rollout found for thread id/i.test((error as Error).message))
            throw error;
          // 旧空线程尚无记录，只替换当前会话的失效绑定。
          result = await this.request("thread/start", {
            ...this.threadOptions(conversationId),
            ephemeral: false,
          });
        }
      } else
        result = await this.request("thread/start", {
          ...this.threadOptions(conversationId),
          ephemeral: false,
        });
      const binding = this.threadBinding(result);
      const { threadId } = binding;
      this.registerConversationThread(conversationId, threadId, true);
      this.emit("thread", { conversationId, ...binding });
      return threadId;
    })();
    this.conversations.setThreadOperation(conversationId, operation);
    void operation.then(
      () => {
        if (runtime.threadOperation === operation)
          this.conversations.setThreadOperation(conversationId, null);
      },
      () => {
        if (runtime.threadOperation === operation)
          this.conversations.setThreadOperation(conversationId, null);
      },
    );
    return operation;
  }

  async createConversationThread(conversationId: string) {
    if (!this.current || this.lifecycleState !== "ready" || !this.config)
      throw new Error("尚未连接 Codex");
    const result = (await this.request("thread/start", {
      ...this.threadOptions(conversationId),
      ephemeral: false,
    })) as any;
    const binding = this.threadBinding(result);
    return binding;
  }

  async forkConversationThread(
    parentConversationId: string,
    conversationId: string,
  ) {
    const parentThreadId =
      await this.ensureConversationThread(parentConversationId);
    const result = (await this.request("thread/fork", {
      threadId: parentThreadId,
      ...this.threadOptions(conversationId),
      ephemeral: false,
      excludeTurns: true,
    })) as any;
    const binding = this.threadBinding(result);
    return binding;
  }

  isConversationBusy(conversationId: string) {
    const runtime = this.conversations.require(conversationId);
    return (
      Boolean(runtime.activeTurnId) ||
      runtime.startingTurn ||
      Boolean(runtime.threadOperation)
    );
  }

  async archiveConversationThread(conversationId: string) {
    if (this.isConversationBusy(conversationId))
      throw new Error("当前会话仍在运行或等待权限处理");
    const runtime = this.conversations.require(conversationId);
    const threadId = runtime.threadId;
    if (!threadId) return { conversationId, threadId: null };
    if (!this.current || this.lifecycleState !== "ready")
      throw new Error("尚未连接 Codex");
    try {
      await this.request("thread/archive", { threadId });
    } catch (error) {
      if (!/no rollout found for thread id/i.test((error as Error).message))
        throw error;
      // 空线程尚无远程记录，可以直接归档本地票根。
    }
    return { conversationId, threadId };
  }

  forgetConversation(conversationId: string) {
    this.conversations.remove(conversationId);
  }

  selectClues(system: string, messages: ChatMessage[]) {
    return this.clueSelection.select(
      this.request.bind(this),
      this.config!,
      system,
      messages,
    );
  }

  async startTurn(
    text: string,
    conversationId: string,
    clues: string | (() => Promise<string>) = "",
    protocol = MIAN_PUBLIC_REPLY_PROTOCOL,
    localTime = `現在是 ${new Date().toLocaleString("zh-CN", { dateStyle: "full", timeStyle: "short", hour12: false })}`,
  ) {
    if (!this.current || this.lifecycleState !== "ready" || !this.config)
      throw new Error("尚未连接 Codex");
    const runtime = this.conversations.require(conversationId);
    if (runtime.activeTurnId || runtime.startingTurn)
      throw new Error("当前会话已有正在运行的 turn");
    runtime.startingTurn = true;
    try {
      const instructions = typeof clues === "function" ? await clues() : clues;
      const threadId = await this.ensureConversationThread(conversationId);
      const result = (await this.request("turn/start", {
        threadId,
        permissions: CODEX_PERMISSIONS,
        approvalPolicy: "never",
        approvalsReviewer: "user",
        cwd: path.join(this.config.workingDirectory, conversationId),
        input: [{ type: "text", text, text_elements: [] }],
        additionalContext: {
          [MIAN_PUBLIC_REPLY_CONTEXT_KEY]: {
            value: protocol,
            kind: "application",
          },
          [MIAN_TURN_CONTEXT_KEY]: {
            value: [localTime, instructions].filter(Boolean).join("\n\n"),
            kind: "application",
          },
        },
        summary: "auto",
      })) as any;
      const turnId = String(result.turn.id);
      // 完成通知可能早于 RPC 响应，不能把已结束的回合重新标成运行中。
      if (runtime.completedTurnId !== turnId)
        this.conversations.setActiveTurn(conversationId, turnId);
      return { conversationId, threadId, turnId };
    } finally {
      runtime.startingTurn = false;
    }
  }

  async interrupt(turnId: string, conversationId: string) {
    const runtime = this.conversations.require(conversationId);
    const threadId = runtime.threadId;
    if (!threadId) throw new Error("没有活动会话");
    if (runtime.activeTurnId !== turnId)
      throw new Error("当前 turn 不属于这个会话");
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.request("turn/interrupt", { threadId, turnId });
        return;
      } catch (error) {
        if (
          attempt >= 3 ||
          !/no active turn to interrupt/i.test((error as Error).message)
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }

  decide(_requestId: string, _allow: boolean, _conversationId: string) {
    throw new Error("Mian 的工作區權限固定，不能放寬。");
  }

  request(method: string, params?: unknown, timeout = 15_000) {
    const instance = this.current;
    if (!instance || instance.retiring) throw new Error("app-server 未运行");
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiter = this.waiters.get(id);
        if (!waiter || waiter.instanceId !== instance.id) return;
        this.waiters.delete(id);
        reject(new Error(`${method} 超时`));
      }, timeout);
      this.waiters.set(id, {
        instanceId: instance.id,
        resolve,
        reject,
        timer,
      });
      try {
        this.writeTo(instance, { jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.waiters.delete(id);
        reject(error);
      }
    });
  }

  notify(method: string, params?: unknown) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private respond(id: number | string, result: unknown) {
    this.write({ jsonrpc: "2.0", id, result });
  }

  private respondError(id: number | string, code: number, message: string) {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private write(message: RpcMessage) {
    const instance = this.current;
    if (!instance || instance.retiring) throw new Error("app-server 未运行");
    this.writeTo(instance, message);
  }

  private writeTo(instance: AppServerInstance, message: RpcMessage) {
    if (!this.isCurrent(instance) || instance.retiring)
      throw new Error("app-server 实例已失效");
    instance.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private rejectWaitersFor(instanceId: number, error: Error) {
    this.clueSelection.close(error);
    for (const [id, waiter] of this.waiters) {
      if (waiter.instanceId !== instanceId) continue;
      clearTimeout(waiter.timer);
      waiter.reject(error);
      this.waiters.delete(id);
    }
  }

  close() {
    const instance = this.current;
    if (instance) {
      instance.retiring = true;
      this.lifecycleState = "stopping";
      this.current = undefined;
      this.rejectWaitersFor(instance.id, new Error("连接已关闭"));
      instance.child.kill();
    }
    this.conversations.clearTransientState();
    this.lastStatus = undefined;
    this.lifecycleState = "idle";
  }
}
