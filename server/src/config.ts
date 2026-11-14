import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig, Sandbox } from "./types.js";

const root = path.resolve(process.cwd(), "server", "data");
const file = path.join(root, "config.json");
const defaults: AppConfig = {
  workingDirectory: path.resolve(process.cwd()),
  sandbox: "workspace-write",
  model: "",
  channel: { kind: "codex" },
};

export async function readConfig(): Promise<AppConfig> {
  try {
    return { ...defaults, ...JSON.parse(await readFile(file, "utf8")) };
  } catch {
    return defaults;
  }
}

export async function saveConfig(input: unknown) {
  const value = input as Partial<AppConfig>;
  const sandboxes: Sandbox[] = [
    "read-only",
    "workspace-write",
    "danger-full-access",
  ];
  if (
    typeof value.workingDirectory !== "string" ||
    !path.isAbsolute(value.workingDirectory)
  )
    throw new Error("工作目录必须是绝对路径");
  if (!sandboxes.includes(value.sandbox as Sandbox))
    throw new Error("无效的 sandbox");
  const config: AppConfig = {
    workingDirectory: path.resolve(value.workingDirectory),
    sandbox: value.sandbox as Sandbox,
    model: typeof value.model === "string" ? value.model.trim() : "",
    channel: value.channel ?? (await readConfig()).channel,
  };
  await mkdir(root, { recursive: true });
  await writeFile(file, JSON.stringify(config, null, 2), "utf8");
  return config;
}
