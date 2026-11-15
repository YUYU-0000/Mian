import type { AppConfig } from "./types.js";
import type { ChatMessage } from "./providers/openai.js";

type Request = (method: string, params: unknown) => Promise<any>;
type Selection = {
  text: string;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
};

// 临时线程的通知只在这里消费，不写入对话或公开的事件流。
export class CodexClueSelection {
  private pending = new Map<string, Selection>();

  async select(
    request: Request,
    config: AppConfig,
    system: string,
    messages: ChatMessage[],
  ) {
    const { thread } = await request("thread/start", {
      cwd: config.workingDirectory,
      model: config.model || null,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions: system,
    });
    let timer: NodeJS.Timeout;
    const completion = new Promise<string>((resolve, reject) => {
      this.pending.set(thread.id, { text: "", resolve, reject });
      timer = setTimeout(() => reject(new Error("線索挑選超時")), 12_000);
    });
    try {
      const [, text] = await Promise.all([
        request("turn/start", {
          threadId: thread.id,
          input: [
            { type: "text", text: JSON.stringify(messages), text_elements: [] },
          ],
          effort: "low",
          summary: "none",
        }),
        completion,
      ]);
      return text;
    } finally {
      clearTimeout(timer!);
      this.pending.delete(thread.id);
      await request("thread/unsubscribe", { threadId: thread.id }).catch(
        () => {},
      );
    }
  }

  receive(method: string, params: any) {
    const selection = this.pending.get(params?.threadId);
    if (!selection) return false;
    if (method === "item/agentMessage/delta") selection.text += params.delta;
    if (method === "item/completed" && params.item?.type === "agentMessage")
      selection.text = params.item.text;
    if (method === "turn/completed") {
      if (params.turn.status === "completed") selection.resolve(selection.text);
      else
        selection.reject(
          new Error(params.turn.error?.message || "線索挑選失敗"),
        );
    }
    if (method === "error")
      selection.reject(new Error(params.error?.message || "線索挑選失敗"));
    return true;
  }

  close(error: Error) {
    for (const selection of this.pending.values()) selection.reject(error);
    this.pending.clear();
  }
}
