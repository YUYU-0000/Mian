import type { SavedVoicePreset } from "./voicePresets.js";
import { parseBuffer } from "music-metadata";
import { estimatedVoiceDuration, stripVoiceTags, type VoiceOption } from "../../shared/voice.mjs";

async function elevenRequest(key: string, endpoint: string, init?: RequestInit) {
  if (!key) throw new Error("請填寫 TOKEN。");
  const response = await fetch(`https://api.elevenlabs.io/${endpoint}`, {
    ...init, headers: { "xi-api-key": key, ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    if (response.headers.get("content-type")?.includes("application/json")) {
      const error = JSON.parse(body);
      message = error.detail?.message ?? error.message ??
        (typeof error.detail === "string" ? error.detail : body);
    }
    throw new Error(message || `ElevenLabs HTTP ${response.status}`);
  }
  return response;
}

export async function voiceModels(key: string): Promise<VoiceOption[]> {
  const models = await (await elevenRequest(key, "v1/models")).json();
  return models.filter((model: { can_do_text_to_speech: boolean }) => model.can_do_text_to_speech)
    .map((model: { model_id: string; name: string }) => ({ id: model.model_id, name: model.name }));
}

export async function voiceList(key: string): Promise<VoiceOption[]> {
  const voices: VoiceOption[] = [];
  const query = new URLSearchParams({ page_size: "100" });
  while (true) {
    const page = await (await elevenRequest(key, `v2/voices?${query}`)).json();
    voices.push(...page.voices.map((voice: { voice_id: string; name: string }) => ({ id: voice.voice_id, name: voice.name })));
    if (!page.has_more) return voices;
    query.set("next_page_token", page.next_page_token);
  }
}

export async function synthesizeVoice(preset: SavedVoicePreset, text: string, signal?: AbortSignal) {
  if (!preset.key || !preset.voice_id) throw new Error("請填寫 TOKEN 和 VOICE。");
  const model = preset.model.trim() || "eleven_v4";
  const spoken = /^eleven_v[34]/.test(model) ? text : stripVoiceTags(text);
  const maximum = estimatedVoiceDuration(text) * 2.5;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await elevenRequest(preset.key,
      `v1/text-to-speech/${encodeURIComponent(preset.voice_id)}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: spoken, model_id: model }), signal,
      });
    const audio = Buffer.from(await response.arrayBuffer());
    const { format } = await parseBuffer(audio, { mimeType: "audio/mpeg" }, { duration: true });
    if (format.duration === undefined) throw new Error("無法讀取音頻時長。");
    if (format.duration <= maximum) return { audio, duration: format.duration };
  }
  throw new Error("語音超出預計時長，已改為文字。");
}
