import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./config.js";
import { ChatFiles } from "./chatFiles.js";
import { synthesizeVoice } from "./elevenLabs.js";
import { decodeVoicePeaks } from "./voiceWaveform.js";
import type { SavedVoicePreset } from "./voicePresets.js";
import { splitVoiceText, stripVoiceTags, type VoiceClip, type VoicePart } from "../../shared/voice.mjs";

export class VoiceGeneration {
  private pending = new Map<string, Promise<VoiceClip>>();
  constructor(private files: ChatFiles, private root = path.join(dataDirectory, "voice-cache")) {}

  preview(requestId: string, preset: SavedVoicePreset, text: string, signal: AbortSignal) {
    return this.generate(`preview:${requestId}:${preset.key}:${preset.voice_id}:${preset.model}`, text, preset, signal);
  }

  chat(conversationId: string, messageId: string, text: string, preset: SavedVoicePreset, signal: AbortSignal) {
    return this.generate(`chat:${conversationId}:${messageId}`, text, preset, signal, conversationId);
  }

  previewPath(name: string) {
    if (!/^[a-f0-9]{64}-\d+\.mp3$/.test(name)) throw new Error("音頻不存在。");
    return path.join(this.root, name);
  }

  private generate(scope: string, text: string, preset: SavedVoicePreset, signal: AbortSignal, conversationId?: string) {
    const id = createHash("sha256").update(JSON.stringify([scope, text])).digest("hex");
    let result = this.pending.get(id);
    if (!result) {
      result = this.create(id, text, preset, signal, conversationId);
      this.pending.set(id, result);
    }
    return result;
  }

  private async create(id: string, text: string, preset: SavedVoicePreset, signal: AbortSignal, conversationId?: string): Promise<VoiceClip> {
    const manifest = path.join(this.root, `${id}.json`);
    let saved: { clip?: VoiceClip; error?: string } | undefined;
    try { saved = JSON.parse(await readFile(manifest, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (saved?.clip) return saved.clip;
    if (saved?.error) throw new Error(saved.error);
    await mkdir(this.root, { recursive: true });
    // 先占住消息和内容；中断或重启后不把同一条台词重新送去生成。
    await writeFile(manifest, JSON.stringify({ error: "這段語音未完成，已保留文字。" }));
    try {
      const generated = [];
      for (const part of splitVoiceText(text)) {
        signal.throwIfAborted();
        generated.push(await synthesizeVoice(preset, part, signal));
      }
      signal.throwIfAborted();
      const peaks = await decodeVoicePeaks(generated);
      const parts: VoicePart[] = [];
      for (const [index, { audio, duration }] of generated.entries()) {
        let url: string;
        if (conversationId) {
          const file = await this.files.save(conversationId, "voice.mp3", audio, "audio/mpeg");
          url = `/api/conversations/${conversationId}/files/${file.id}?inline=1`;
        } else {
          const name = `${id}-${index}.mp3`;
          await writeFile(this.previewPath(name), audio);
          url = `/api/voice-audio/${name}`;
        }
        parts.push({ url, duration });
      }
      const clip: VoiceClip = { url: parts[0].url, text: stripVoiceTags(text), parts, peaks,
        duration: parts.reduce((sum, part) => sum + part.duration, 0) };
      await writeFile(manifest, JSON.stringify({ clip }));
      return clip;
    } catch (error) {
      await writeFile(manifest, JSON.stringify({ error: (error as Error).message }));
      throw error;
    }
  }
}
