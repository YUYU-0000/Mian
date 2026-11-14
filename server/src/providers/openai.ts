export type ApiFormat = "openai";
export type ProviderConfig = {
  endpoint: string;
  key: string;
  model: string;
  format: ApiFormat;
};
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type TokenUsage = { totalTokens: number; uncachedTotalTokens: number };
export type CompletionEvent =
  | { type: "text"; text: string; immediate?: boolean }
  | { type: "usage"; usage: TokenUsage };

// 仅使用 Web API，供服务端和手机端共用。
export function shortProviderMessage(message: string) {
  const text = message.replace(/\s+/g, " ").trim();
  const sentences =
    text.match(/.*?(?:[。！？!?]|\.(?=\s|$)|$)/g)?.filter(Boolean) ?? [];
  const brief = sentences
    .slice(0, 2)
    .map((sentence) => sentence.trim())
    .join(" ");
  return brief.length > 240 ? `${brief.slice(0, 239)}…` : brief;
}

class ProviderError extends Error {
  constructor(
    readonly detail: string,
    readonly status: number,
    readonly param?: string,
  ) {
    super(shortProviderMessage(detail));
  }
}

function responseError(body: any, status: number) {
  const error = body?.error ?? body;
  const detail = typeof error === "string" ? error : error?.message;
  return new ProviderError(
    detail || `服務商請求失敗（HTTP ${status}）`,
    status,
    error?.param,
  );
}

async function providerResponse(
  config: ProviderConfig,
  resource: string,
  body?: object,
  signal?: AbortSignal,
) {
  if (config.format !== "openai") throw new Error("暫不支援這個接口格式");
  const response = await fetch(
    `${config.endpoint.replace(/\/+$/, "")}/${resource}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    },
  );
  if (!response.ok) {
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* 部分中转站返回纯文本。 */
    }
    throw responseError(body, response.status);
  }
  return response;
}

export async function providerJson(
  config: ProviderConfig,
  resource: string,
  body?: object,
) {
  const response = await providerResponse(config, resource, body);
  const result = await response.json();
  if (result.error) throw responseError(result, response.status);
  return result;
}

function readUsage(usage: any): TokenUsage | undefined {
  if (!usage) return;
  const total =
    usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens;
  if (!Number.isFinite(total)) return;
  const cached =
    usage.prompt_tokens_details?.cached_tokens ??
    usage.prompt_cache_hit_tokens ??
    0;
  return { totalTokens: total, uncachedTotalTokens: total - cached };
}

function unsupported(error: unknown, field: string) {
  return (
    error instanceof ProviderError &&
    [400, 404, 405, 415, 422, 501].includes(error.status) &&
    (error.param === field || error.detail.toLowerCase().includes(field)) &&
    /not support|unsupported|not allowed|not available|not permitted|unknown|unrecognized|unexpected|false|disabled|不支持|不支援/i.test(
      error.detail,
    )
  );
}

async function* readCompletion(
  response: Response,
): AsyncGenerator<CompletionEvent> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const body = await response.json();
    if (body.error) throw responseError(body, response.status);
    const text = body.choices?.[0]?.message?.content;
    if (text) yield { type: "text", text, immediate: true };
    const usage = readUsage(body.usage);
    if (usage) yield { type: "usage", usage };
    return;
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  let done = false;
  const parse = function* (frame: string): Generator<CompletionEvent> {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data === "[DONE]") {
      done = true;
      return;
    }
    const body = JSON.parse(data);
    if (body.error) throw responseError(body, 400);
    const choice = body.choices?.[0];
    if (choice?.finish_reason) finished = true;
    // reasoning_content 和 tool_calls 不进入正文。
    if (choice?.delta?.content)
      yield { type: "text", text: choice.delta.content };
    const usage = readUsage(body.usage);
    if (usage) yield { type: "usage", usage };
  };
  try {
    while (!done) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let separator: RegExpMatchArray | null;
      while ((separator = buffer.match(/\r?\n\r?\n/))) {
        const index = separator.index!;
        yield* parse(buffer.slice(0, index));
        buffer = buffer.slice(index + separator[0].length);
        if (done) break;
      }
      if (chunk.done) {
        if (buffer.trim()) yield* parse(buffer);
        break;
      }
    }
    if (!done && !finished) throw new Error("服務商連線中斷，回覆尚未完成。");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function* completeChat(
  config: ProviderConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<CompletionEvent> {
  const body = { model: config.model, messages };
  let emitted = false;
  try {
    let response: Response;
    try {
      response = await providerResponse(
        config,
        "chat/completions",
        {
          ...body,
          stream: true,
          stream_options: { include_usage: true },
        },
        signal,
      );
    } catch (error) {
      if (!unsupported(error, "stream_options")) throw error;
      response = await providerResponse(
        config,
        "chat/completions",
        { ...body, stream: true },
        signal,
      );
    }
    for await (const event of readCompletion(response)) {
      emitted = true;
      yield event;
    }
  } catch (error) {
    // 仅在明确不支持流式且尚未输出时重发，避免重复生成。
    if (emitted || signal.aborted || !unsupported(error, "stream")) throw error;
    const response = await providerResponse(
      config,
      "chat/completions",
      { ...body, stream: false },
      signal,
    );
    yield* readCompletion(response);
  }
}
