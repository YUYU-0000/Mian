import type { SavedVoicePreset } from "./voicePresets.js";

export async function synthesizeVoice(preset: SavedVoicePreset, text: string, signal?: AbortSignal) {
  if (!preset.key || !preset.voice_id || !preset.model)
    throw new Error("請填寫 TOKEN、VOICE 和 MODEL。");
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(preset.voice_id)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": preset.key, Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: preset.model }),
      signal,
    },
  );
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
  return Buffer.from(await response.arrayBuffer());
}
