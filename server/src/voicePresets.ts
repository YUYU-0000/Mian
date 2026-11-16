// 读取、保存和选择语音预设，沿用现有文件结构与默认值。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./config.js";
import { defaultVoicePreset, type VoicePreset } from "../../shared/voice.mjs";

export type SavedVoicePreset = Omit<VoicePreset, "hasKey"> & { key: string; };
type VoicePresets = { presets: SavedVoicePreset[]; activeId: string; };
const file = path.join(dataDirectory, "voice-presets.json");

export async function readVoicePresets(): Promise<VoicePresets> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { presets: [{ ...defaultVoicePreset, key: "" }], activeId: defaultVoicePreset.id };
    throw error;
  }
}

export async function writeVoicePresets(value: VoicePresets) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

export function publicVoicePresets(value: VoicePresets) {
  return {
    activeId: value.activeId,
    presets: value.presets.map(({ key, ...preset }) => ({ ...preset, hasKey: Boolean(key) })),
  };
}

export async function resolveVoicePreset(input: VoicePreset): Promise<SavedVoicePreset> {
  const saved = (await readVoicePresets()).presets.find(preset => preset.id === input.id);
  return {
    id: input.id,
    note: input.note.trim(),
    key: input.key?.trim() || saved?.key || "",
    voice_id: input.voice_id.trim(),
    voice_name: input.voice_name ?? "",
    model: input.model.trim(),
    words: input.words,
  };
}

export async function activeVoicePreset() {
  const settings = await readVoicePresets();
  const preset = settings.presets.find(item => item.id === settings.activeId);
  if (!preset) throw new Error("請先選擇語音預設。");
  return preset;
}
