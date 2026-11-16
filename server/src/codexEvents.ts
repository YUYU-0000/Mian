import type { ConversationRuntimeRegistry } from "./conversationRuntime.js";
import type { ConversationRuntimeMetadata } from "./types.js";
import { parseCumulativeTokenUsage } from "./tokenUsage.js";

export function handleCodexNotification(
  conversations: ConversationRuntimeRegistry,
  emit: (event: string, ...args: any[]) => boolean,
  method: string,
  params: any,
  codeModeCalls: Map<string, string>,
) {
  const conversationId = resolveConversationId(conversations, params);
  if (!conversationId) {
    if (
      method === "turn/started" ||
      method.startsWith("item/") ||
      method.startsWith("turn/") ||
      method.startsWith("thread/") ||
      method === "model/rerouted" ||
      method === "error"
    )
      emit(
        "log",
        `忽略无法路由到 conversationId 的 app-server 事件: ${method}`,
      );
    return;
  }
  if (method === "turn/started") {
    const turnId = String(params.turn.id);
    conversations.setActiveTurn(conversationId, turnId);
    emit("event", { type: "turn-started", conversationId, turnId });
  } else if (method === "item/agentMessage/delta")
    emit("event", {
      type: "assistant-delta",
      conversationId,
      turnId: params.turnId,
      delta: params.delta,
    });
  else if (method === "item/reasoning/summaryTextDelta")
    emit("event", {
      type: "thinking-delta",
      conversationId,
      turnId: params.turnId,
      itemId: params.itemId,
      delta: params.delta,
    });
  else if (method === "item/plan/delta")
    emit("event", {
      type: "thinking-delta",
      conversationId,
      turnId: params.turnId,
      delta: params.delta,
    });
  else if (method === "rawResponseItem/completed") {
    const tool = codeModeToolFrom(params.item, params.turnId, codeModeCalls);
    if (tool)
      emit("event", {
        type: "tool",
        conversationId,
        turnId: params.turnId,
        tool,
      });
  } else if (method === "item/started" || method === "item/completed") {
    if (params.item?.type === "reasoning") {
      emit("event", {
        type:
          method === "item/started" ? "thinking-started" : "thinking-completed",
        conversationId,
        turnId: params.turnId,
        itemId: params.item.id,
      });
      return;
    }
    const tool = toolFrom(params.item, method === "item/started");
    if (tool)
      emit("event", {
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
    emit("event", {
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
      emit("conversation-metadata", {
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
      emit("conversation-metadata", { conversationId, patch });
  } else if (method === "thread/tokenUsage/updated") {
    const usage = parseCumulativeTokenUsage(params.tokenUsage?.total);
    if (usage.warning)
      emit(
        "log",
        `${usage.warning} for thread ${String(params.threadId || "unknown")}`,
      );
    if (Object.keys(usage.patch).length)
      emit("conversation-metadata", {
        conversationId,
        patch: usage.patch,
      });
  } else if (method === "turn/completed") {
    const turnId = String(params.turn.id);
    for (const key of codeModeCalls.keys())
      if (key.startsWith(`${turnId}:`)) codeModeCalls.delete(key);
    conversations.clearActiveTurn(conversationId, turnId);
    emit("event", {
      type: "turn-completed",
      conversationId,
      turnId,
      status: params.turn.status,
      error: params.turn.error?.message,
    });
  } else if (method === "error" && !params.willRetry) {
    const turnId = conversations.require(conversationId).activeTurnId;
    const message = params.error?.message || params.message || "Codex 错误";
    if (turnId) {
      conversations.clearActiveTurn(conversationId, turnId);
      emit("event", { type: "turn-completed", conversationId, turnId, status: "failed", error: message });
    } else emit("event", {
      type: "error",
      conversationId,
      message,
    });
  }
}

// code-mode 的 exec 只有原始调用和结果通知，没有对应的 item/started 事件。
function codeModeToolFrom(
  item: any,
  turnId: string,
  calls: Map<string, string>,
) {
  const key = `${turnId}:${item.call_id}`;
  const started = item.type === "custom_tool_call" && item.name === "exec";
  if (started) calls.set(key, item.input);
  else if (item.type !== "custom_tool_call_output" || !calls.has(key))
    return null;

  const command = calls.get(key)!;
  const detail = started
    ? ""
    : typeof item.output === "string"
      ? item.output
      : item.output
          .filter((part: { type: string }) => part.type === "input_text")
          .map((part: { text: string }) => part.text)
          .join("\n");
  if (!started) calls.delete(key);
  return {
    id: item.call_id,
    name: "exec",
    rawName: "exec",
    kind: "customToolCall",
    command,
    arguments: command,
    detail,
    result: detail,
    state: started ? "running" : "success",
  };
}

function resolveConversationId(
  conversations: ConversationRuntimeRegistry,
  params: Record<string, unknown> | undefined,
) {
  const threadId = params?.threadId;
  if (typeof threadId === "string") {
    const conversationId = conversations.conversationForThread(threadId);
    if (conversationId) return conversationId;
  }
  const thread = params?.thread;
  if (thread && typeof thread === "object" && "id" in thread) {
    const nestedThreadId = (thread as { id?: unknown }).id;
    if (typeof nestedThreadId === "string") {
      const conversationId =
        conversations.conversationForThread(nestedThreadId);
      if (conversationId) return conversationId;
    }
  }
  const turnValue = params?.turnId;
  if (typeof turnValue === "string") {
    const conversationId = conversations.conversationForTurn(turnValue);
    if (conversationId) return conversationId;
  }
  const turn = params?.turn;
  if (turn && typeof turn === "object" && "id" in turn) {
    const turnId = (turn as { id?: unknown }).id;
    if (typeof turnId === "string") {
      const conversationId = conversations.conversationForTurn(turnId);
      if (conversationId) return conversationId;
    }
  }
  return null;
}

function toolFrom(item: any, started: boolean) {
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
          ? `${item.server}  ${item.tool}`
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
