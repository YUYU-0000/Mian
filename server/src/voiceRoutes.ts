import { Router } from "express";
import {
  publicVoicePresets, readVoicePresets, resolveVoicePreset, writeVoicePresets,
} from "./voicePresets.js";
import { synthesizeVoice } from "./elevenLabs.js";

export function voiceRoutes() {
  const router = Router();
  router.get("/voice-presets", async (_request, response) => {
    response.json(publicVoicePresets(await readVoicePresets()));
  });
  router.post("/voice-presets", async (request, response) => {
    const preset = await resolveVoicePreset(request.body);
    const settings = await readVoicePresets();
    const index = settings.presets.findIndex(item => item.id === preset.id);
    if (index < 0) settings.presets.push(preset);
    else settings.presets[index] = preset;
    await writeVoicePresets(settings);
    response.json(publicVoicePresets(settings));
  });
  router.post("/voice-presets/:id/use", async (request, response) => {
    const settings = await readVoicePresets();
    if (!settings.presets.some(preset => preset.id === request.params.id))
      throw new Error("這套語音預設已不存在。");
    settings.activeId = request.params.id;
    await writeVoicePresets(settings);
    response.json(publicVoicePresets(settings));
  });
  router.delete("/voice-presets/:id", async (request, response) => {
    const settings = await readVoicePresets();
    if (settings.presets.length <= 1) throw new Error("請保留至少一套語音預設。");
    const index = settings.presets.findIndex(preset => preset.id === request.params.id);
    settings.presets = settings.presets.filter(preset => preset.id !== request.params.id);
    if (settings.activeId === request.params.id)
      settings.activeId = settings.presets[Math.max(0, index - 1)].id;
    await writeVoicePresets(settings);
    response.json(publicVoicePresets(settings));
  });
  router.post("/voice-test", async (request, response) => {
    const controller = new AbortController();
    response.on("close", () => controller.abort());
    const preset = await resolveVoicePreset(request.body);
    const audio = await synthesizeVoice(preset, preset.words.trim() || "陪你等天亮。", controller.signal);
    response.type("audio/mpeg").send(audio);
  });
  router.use((error: Error, _request: import("express").Request, response: import("express").Response, _next: import("express").NextFunction) => {
    response.status(400).json({ error: error.message });
  });
  return router;
}
