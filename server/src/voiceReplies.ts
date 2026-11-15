import { parseReply } from "../../shared/replyProtocol.mjs";
import type { ChatEvent, ReplyFormat } from "../../shared/types.mjs";
import { ChatFiles } from "./chatFiles.js";
import { synthesizeVoice } from "./elevenLabs.js";
import { activeVoicePreset } from "./voicePresets.js";

type VoiceTurn = {
  conversationId: string;
  turnId: string;
  raw: string;
  format?: ReplyFormat;
  controller: AbortController;
  finishing?: Promise<void>;
};

// 两条通道都在完成事件前生成语音，消息只带文件地址与台词。
export class VoiceReplies {
  private turns = new Map<string, VoiceTurn>();
  constructor(private files: ChatFiles, private publish: (event: ChatEvent) => void) {}

  getActiveTurns() {
    return Object.fromEntries([...this.turns.values()].map(turn => [turn.conversationId, turn.turnId]));
  }

  isBusy(conversationId: string) {
    return [...this.turns.values()].some(turn => turn.conversationId === conversationId);
  }

  interrupt(turnId: string, conversationId: string) {
    const turn = this.turns.get(turnId);
    if (!turn?.finishing || turn.conversationId !== conversationId) return false;
    turn.controller.abort();
    return true;
  }

  receive(event: ChatEvent) {
    if (!("turnId" in event)) {
      this.publish(event);
      return;
    }
    if (event.type === "turn-started") {
      this.turns.set(event.turnId, {
        conversationId: event.conversationId!, turnId: event.turnId,
        raw: "", format: event.format, controller: new AbortController(),
      });
    }
    const turn = this.turns.get(event.turnId);
    if (event.type === "assistant-delta" && turn) {
      turn.raw += event.delta;
      turn.format = event.format ?? turn.format;
    }
    if (event.type === "turn-completed" && turn) {
      const voices = parseReply(turn.raw, turn.format, true).voices?.filter(voice => voice.complete) ?? [];
      if (voices.length && ["completed", "success"].includes(event.status)) {
        turn.finishing = (async () => {
          const preset = await activeVoicePreset();
          for (const voice of voices) {
            if (turn.controller.signal.aborted) break;
            try {
              const audio = await synthesizeVoice(preset, voice.text, turn.controller.signal);
              turn.controller.signal.throwIfAborted();
              const file = await this.files.save(turn.conversationId, "voice.mp3", audio, "audio/mpeg", turn.turnId);
              turn.controller.signal.throwIfAborted();
              this.publish({
                type: "voice", conversationId: turn.conversationId, turnId: turn.turnId,
                bubbleId: `${turn.turnId}:${voice.section}:${voice.index}`,
                clip: { url: `/api/conversations/${turn.conversationId}/files/${file.id}?inline=1`, text: voice.text },
              });
            } catch {
              // 没有音频事件的台词在完成后直接作为普通气泡显示。
            }
          }
        })().catch(() => {}).finally(() => {
          this.turns.delete(event.turnId);
          this.publish({ ...event, status: turn.controller.signal.aborted ? "interrupted" : event.status });
        });
        return;
      }
      this.turns.delete(event.turnId);
    }
    this.publish(event);
  }

  async close() {
    for (const turn of this.turns.values()) turn.controller.abort();
    await Promise.all([...this.turns.values()].map(turn => turn.finishing));
  }
}
