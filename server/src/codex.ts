import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import type {
  AppConfig,
  ConversationRuntimeMetadata,
  ConversationThreadBinding,
  PendingApproval,
  RpcMessage,
} from "./types.js";
import { ConversationRuntimeRegistry } from "./conversationRuntime.js";
import { parseCumulativeTokenUsage } from "./tokenUsage.js";
import {
  MIAN_PUBLIC_REPLY_CONTEXT_KEY,
  MIAN_PUBLIC_REPLY_PROTOCOL,
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

export type AppServerLifecycleState =
  | "idle"
  | "starting"
  | "ready"
  | "stopping"
  | "exited"
  | "failed";

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
  spawn("codex", ["app-server", "--stdio"], {
    cwd: config.workingDirectory,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
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
  private approvals = new Map<string, PendingApproval>();
  private readonly conversations = new ConversationRuntimeRegistry();
  version = "";
  config?: AppConfig;

  constructor(private readonly spawnAppServer: AppServerSpawner = defaultSpawner) {
    super();
  }

  getThreadId(conversationId: string) {
    return this.conversations.require(conversationId).threadId;
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
    this.approvals.clear();
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
    this.approvals.clear();
    const interruptedConversations = this.conversations
      .clearTransientState()
      .map(([conversationId]) => conversationId);
    for (const conversationId of interruptedConversations)
      this.emit("event", { type: "error", conversationId, message: error.message });
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
    this.approvals.clear();
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
    const params = (msg.params || {}) as Record<string, unknown>;
    const requestId = String(msg.id);
    const conversationId = this.resolveConversationId(params);
    if (!conversationId) {
      this.respondError(msg.id!, -32602, "无法确定权限请求所属的 conversationId");
      return;
    }
    const turnId = String(
      params.turnId ||
        this.conversations.require(conversationId).activeTurnId ||
        "",
    );
    this.approvals.set(requestId, {
      rpcId: msg.id!,
      kind,
      params,
      turnId,
      conversationId,
    });
    const detail =
      kind === "command"
        ? String(params.command || params.reason || "命令执行请求")
        : kind === "file"
          ? String(params.reason || params.grantRoot || "文件修改请求")
          : JSON.stringify(params.permissions || {}, null, 2);
    this.emit("event", {
      type: "approval",
      conversationId,
      turnId,
      approval: {
        requestId,
        kind,
        title:
          kind === "command"
            ? "命令权限请求"
            : kind === "file"
              ? "文件修改请求"
              : "额外权限请求",
        detail,
      },
    });
  }

  private handleNotification(method: string, params: any) {
    const conversationId = this.resolveConversationId(params);
    if (!conversationId) {
      if (
        method === "turn/started" ||
        method.startsWith("item/") ||
        method.startsWith("turn/") ||
        method.startsWith("thread/") ||
        method === "model/rerouted" ||
        method === "error"
      )
        this.emit(
          "log",
          `忽略无法路由到 conversationId 的 app-server 事件: ${method}`,
        );
      return;
    }
    if (method === "turn/started") {
      const turnId = String(params.turn.id);
      this.conversations.setActiveTurn(conversationId, turnId);
      this.emit("event", { type: "turn-started", conversationId, turnId });
    } else if (method === "item/agentMessage/delta")
      this.emit("event", {
        type: "assistant-delta",
        conversationId,
        turnId: params.turnId,
        delta: params.delta,
      });
    else if (method === "item/reasoning/summaryTextDelta")
      this.emit("event", {
        type: "thinking-delta",
        conversationId,
        turnId: params.turnId,
        itemId: params.itemId,
        delta: params.delta,
      });
    else if (method === "item/plan/delta")
      this.emit("event", {
        type: "thinking-delta",
        conversationId,
        turnId: params.turnId,
        delta: params.delta,
      });
    else if (method === "item/started" || method === "item/completed") {
      if (params.item?.type === "reasoning") {
        this.emit("event", {
          type:
            method === "item/started"
              ? "thinking-started"
              : "thinking-completed",
          conversationId,
          turnId: params.turnId,
          itemId: params.item.id,
        });
        return;
      }
      const tool = this.toolFrom(params.item, method === "item/started");
      if (tool)
        this.emit("event", {
          type: "tool",
          conversationId,
          turnId: params.turnId,
          tool,
        });
    } else if (
      method === "item/commandExecution/outputDelta" ||
      method === "item/fileChange/outputDelta" ||
      method === "item/mcpToolCall/progress"
    )
      this.emit("event", {
        type: "tool",
        conversationId,
        turnId: params.turnId,
        tool: {
          id: params.itemId,
          name: "工具运行",
          detail: String(params.delta || params.message || ""),
          state: "running",
        },
      });
    else if (method === "model/rerouted") {
      if (typeof params.toModel === "string" && params.toModel)
        this.emit("conversation-metadata", {
          conversationId,
          patch: { model: params.toModel },
        });
    } else if (method === "thread/settings/updated") {
      const settings = params.threadSettings ?? {};
      const patch: Partial<ConversationRuntimeMetadata> = {};
      if (typeof settings.model === "string") patch.model = settings.model;
      if (typeof settings.effort === "string" || settings.effort === null)
        patch.reasoningEffort = settings.effort;
      const mode = settings.collaborationMode;
      if (typeof mode === "string") patch.collaborationMode = mode;
      else if (mode && typeof mode.mode === "string")
        patch.collaborationMode = mode.mode;
      if (Object.keys(patch).length)
        this.emit("conversation-metadata", { conversationId, patch });
    } else if (method === "thread/tokenUsage/updated") {
      const usage = parseCumulativeTokenUsage(params.tokenUsage?.total);
      if (usage.warning)
        this.emit(
          "log",
          `${usage.warning} for thread ${String(params.threadId || "unknown")}`,
        );
      if (Object.keys(usage.patch).length)
        this.emit("conversation-metadata", {
          conversationId,
          patch: usage.patch,
        });
    } else if (method === "turn/completed") {
      const turnId = String(params.turn.id);
      this.conversations.clearActiveTurn(conversationId, turnId);
      this.emit("event", {
        type: "turn-completed",
        conversationId,
        turnId,
        status: params.turn.status,
        error: params.turn.error?.message,
      });
    } else if (method === "error")
      this.emit("event", {
        type: "error",
        conversationId,
        message: params.error?.message || params.message || "Codex 错误",
      });
  }

  private resolveConversationId(params: Record<string, unknown> | undefined) {
    const threadId = params?.threadId;
    if (typeof threadId === "string") {
      const conversationId = this.conversations.conversationForThread(threadId);
      if (conversationId) return conversationId;
    }
    const thread = params?.thread;
    if (thread && typeof thread === "object" && "id" in thread) {
      const nestedThreadId = (thread as { id?: unknown }).id;
      if (typeof nestedThreadId === "string") {
        const conversationId =
          this.conversations.conversationForThread(nestedThreadId);
        if (conversationId) return conversationId;
      }
    }
    const turnValue = params?.turnId;
    if (typeof turnValue === "string") {
      const conversationId = this.conversations.conversationForTurn(turnValue);
      if (conversationId) return conversationId;
    }
    const turn = params?.turn;
    if (turn && typeof turn === "object" && "id" in turn) {
      const turnId = (turn as { id?: unknown }).id;
      if (typeof turnId === "string") {
        const conversationId = this.conversations.conversationForTurn(turnId);
        if (conversationId) return conversationId;
      }
    }
    return null;
  }

  private toolFrom(item: any, started: boolean) {
    if (
      !item ||
      ![
        "commandExecution",
        "fileChange",
        "mcpToolCall",
        "dynamicToolCall",
        "webSearch",
        "imageView",
      ].includes(item.type)
    )
      return null;
    const name =
      item.type === "commandExecution"
        ? item.command || "命令"
        : item.type === "fileChange"
          ? "文件修改"
          : item.type === "mcpToolCall"
            ? `${item.server} · ${item.tool}`
            : item.tool || item.type;
    let state: "running" | "success" | "failed" | "rejected" = started
      ? "running"
      : "success";
    const raw = String(item.status || "").toLowerCase();
    if (raw.includes("fail") || raw.includes("error")) state = "failed";
    if (raw.includes("declin") || raw.includes("reject")) state = "rejected";
    const detail =
      item.aggregatedOutput ||
      item.error?.message ||
      (item.changes ? JSON.stringify(item.changes, null, 2) : "");
    return {
      id: String(item.id || name),
      name: String(name),
      detail: String(detail || ""),
      state,
      kind: String(item.type),
      rawName: String(item.tool || item.type),
      arguments: item.arguments ?? item.input ?? item.params,
      command: item.command === undefined ? undefined : String(item.command),
      result: String(detail || ""),
    };
  }

  private threadOptions() {
    if (!this.config) throw new Error("尚未连接 Codex");
    return {
      cwd: this.config.workingDirectory,
      sandbox: this.config.sandbox,
      model: this.config.model || null,
      approvalPolicy: "on-request",
    };
  }

  private threadBinding(result: any): ConversationThreadBinding {
    const metadata: Partial<ConversationRuntimeMetadata> = {};
    if (typeof result?.model === "string" && result.model)
      metadata.model = result.model;
    if (typeof result?.reasoningEffort === "string")
      metadata.reasoningEffort = result.reasoningEffort;
    else if (result?.reasoningEffort === null)
      metadata.reasoningEffort = null;
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
      if (existingThreadId && runtime.loaded)
        return existingThreadId;

      let result: any;
      if (existingThreadId) {
        try {
          result = await this.request("thread/resume", {
            threadId: existingThreadId,
            ...this.threadOptions(),
            excludeTurns: true,
          });
        } catch (error) {
          if (!/no rollout found for thread id/i.test((error as Error).message))
            throw error;
          // Empty threads created by older Mian builds could be persisted before
          // Codex wrote a rollout. They have no context to recover, so replace
          // only that conversation's unusable binding and continue its first turn.
          result = await this.request("thread/start", {
            ...this.threadOptions(),
            ephemeral: false,
          });
        }
      } else
        result = await this.request("thread/start", {
          ...this.threadOptions(),
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

  async createConversationThread() {
    if (!this.current || this.lifecycleState !== "ready" || !this.config)
      throw new Error("尚未连接 Codex");
    const result = (await this.request("thread/start", {
      ...this.threadOptions(),
      ephemeral: false,
    })) as any;
    const binding = this.threadBinding(result);
    return binding;
  }

  async forkConversationThread(parentConversationId: string) {
    const parentThreadId = await this.ensureConversationThread(
      parentConversationId,
    );
    const result = (await this.request("thread/fork", {
      threadId: parentThreadId,
      ...this.threadOptions(),
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
      Boolean(runtime.threadOperation) ||
      [...this.approvals.values()].some(
        (approval) => approval.conversationId === conversationId,
      )
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
      // Codex can issue a thread id before the empty thread has a rollout.
      // In that exact state there is no remote record left to archive, so the
      // registry commit may safely remove this conversation. Other archive
      // errors still abort deletion and leave the ticket untouched.
    }
    return { conversationId, threadId };
  }

  forgetConversation(conversationId: string) {
    this.conversations.remove(conversationId);
  }

  async startTurn(text: string, conversationId: string) {
    if (!this.current || this.lifecycleState !== "ready" || !this.config)
      throw new Error("尚未连接 Codex");
    const runtime = this.conversations.require(conversationId);
    if (runtime.activeTurnId || runtime.startingTurn)
      throw new Error("当前会话已有正在运行的 turn");
    runtime.startingTurn = true;
    try {
      const threadId = await this.ensureConversationThread(conversationId);
      const result = (await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text, text_elements: [] }],
        additionalContext: {
          [MIAN_PUBLIC_REPLY_CONTEXT_KEY]: {
            value: MIAN_PUBLIC_REPLY_PROTOCOL,
            kind: "application",
          },
        },
        summary: "auto",
      })) as any;
      const turnId = String(result.turn.id);
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

  decide(requestId: string, allow: boolean, conversationId: string) {
    const approval = this.approvals.get(requestId);
    if (!approval) throw new Error("权限请求已失效");
    if (approval.conversationId !== conversationId)
      throw new Error("权限请求不属于这个会话");
    this.approvals.delete(requestId);
    let result: any;
    if (approval.kind === "command" || approval.kind === "file")
      result = { decision: allow ? "accept" : "decline" };
    else
      result = allow
        ? { permissions: approval.params.permissions || {}, scope: "turn" }
        : { permissions: {}, scope: "turn" };
    this.respond(approval.rpcId, result);
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
    this.approvals.clear();
    this.conversations.clearTransientState();
    this.lastStatus = undefined;
    this.lifecycleState = "idle";
  }
}
