import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { AppConfig, Sandbox } from "./types.js";

export const dataDirectory = path.resolve(process.cwd(), "server", "data");
const file = path.join(dataDirectory, "config.json");
export const projectDirectory = fileURLToPath(
  new URL("../..", import.meta.url),
);
export const defaultWorkingDirectory = path.join(homedir(), "MianWorkspace");
export const PROJECT_DIRECTORY_ERROR =
  "工作目錄不能設在 Mian 專案裡面，請換一個資料夾。";

export function isProjectDirectory(directory: string) {
  const relative = path.relative(projectDirectory, path.resolve(directory));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

const defaults: AppConfig = {
  workingDirectory: defaultWorkingDirectory,
  sandbox: "workspace-write",
  model: "",
  channel: { kind: "codex" },
};

export async function readConfig(): Promise<AppConfig> {
  let config: AppConfig;
  try {
    config = { ...defaults, ...JSON.parse(await readFile(file, "utf8")) };
  } catch {
    config = { ...defaults };
  }
  // 老配置迁出项目目录，保留模型、权限和当前通道。
  if (isProjectDirectory(config.workingDirectory)) {
    config.workingDirectory = defaultWorkingDirectory;
    await writeConfig(config);
  }
  await mkdir(config.workingDirectory, { recursive: true });
  return config;
}

async function writeConfig(config: AppConfig) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(file, JSON.stringify(config, null, 2), "utf8");
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
  if (isProjectDirectory(value.workingDirectory))
    throw new Error(PROJECT_DIRECTORY_ERROR);
  if (!sandboxes.includes(value.sandbox as Sandbox))
    throw new Error("无效的 sandbox");
  const config: AppConfig = {
    workingDirectory: path.resolve(value.workingDirectory),
    sandbox: value.sandbox as Sandbox,
    model: typeof value.model === "string" ? value.model.trim() : "",
    channel: value.channel ?? (await readConfig()).channel,
  };
  await mkdir(config.workingDirectory, { recursive: true });
  await writeConfig(config);
  return config;
}
