import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readConfig, saveConfig } from "./config.js";
import type { Channel } from "./types.js";
import type { ProviderConfig } from "./providers/openai.js";

export type ApiPreset = ProviderConfig & { id: string; note: string };
type Presets = { presets: ApiPreset[] };
const file = path.resolve("server/data/api-presets.json");

export async function readPresets(): Promise<Presets> {
  try {
    const data: Presets = JSON.parse(await readFile(file, "utf8"));
    return {
      presets: data.presets.map((preset) => ({
        ...preset,
        format: preset.format ?? "openai",
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { presets: [] };
    throw error;
  }
}

export async function writePresets(value: Presets) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

export function publicPreset({ key, ...preset }: ApiPreset) {
  return { ...preset, hasKey: Boolean(key), keyHint: key.slice(0, 7) };
}

export async function requirePreset(id: string) {
  const preset = (await readPresets()).presets.find(
    (preset) => preset.id === id,
  );
  if (!preset) throw new Error("這張預設已經不存在，請重新開啟連接中心。");
  return preset;
}

// 空金钥表示继续使用后端已保存的值。
export async function resolvePreset(input: ApiPreset) {
  const saved = input.id ? await requirePreset(input.id) : undefined;
  return {
    ...input,
    key: input.key || saved?.key || "",
    format: input.format ?? saved?.format ?? "openai",
  };
}

export async function readChannel() {
  const { channel } = await readConfig();
  return channel.kind === "codex"
    ? { ...channel, name: "CODEX" }
    : { ...channel, name: (await requirePreset(channel.presetId)).note };
}

export async function selectChannel(channel: Channel) {
  await saveConfig({ ...(await readConfig()), channel });
}
