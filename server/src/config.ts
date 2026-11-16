import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig, Sandbox } from "./types.js";
import { projectDirectory, dataDirectory, workingDirectory } from "../../shared/deployment.mjs";

export { projectDirectory, dataDirectory };
const file = path.join(dataDirectory, "config.json");
export const defaultWorkingDirectory = workingDirectory;
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
  proactive: { voice: true },
};

export async function readConfig(): Promise<AppConfig> {
  let config: AppConfig;
  try {
    config = { ...defaults, ...JSON.parse(await readFile(file, "utf8")) };
  } catch {
    config = { ...defaults };
  }
  config.proactive = { ...defaults.proactive, ...config.proactive };
  // 工作区只能由部署环境决定，网页与备份不能扩展电脑访问范围。
  config.workingDirectory = defaultWorkingDirectory;
  config.sandbox = "workspace-write";
  if (isProjectDirectory(config.workingDirectory)) throw new Error(PROJECT_DIRECTORY_ERROR);
  await mkdir(config.workingDirectory, { recursive: true });
  await mkdir(path.join(config.workingDirectory, ".tmp"), { recursive: true });
  return config;
}

async function writeConfig(config: AppConfig) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(file, JSON.stringify(config, null, 2), "utf8");
}

export async function saveConfig(input: unknown) {
  const value = input as Partial<AppConfig>;
  const sandboxes: Sandbox[] = ["workspace-write"];
  if (
    typeof value.workingDirectory !== "string" ||
    !path.isAbsolute(value.workingDirectory)
  )
    throw new Error("工作目录必须是绝对路径");
  if (isProjectDirectory(value.workingDirectory))
    throw new Error(PROJECT_DIRECTORY_ERROR);
  if (path.resolve(value.workingDirectory) !== defaultWorkingDirectory)
    throw new Error("工作目錄由伺服器的 MIAN_WORKSPACE_DIR 設定。");
  if (!sandboxes.includes(value.sandbox as Sandbox))
    throw new Error("无效的 sandbox");
  const current = await readConfig();
  const config: AppConfig = {
    workingDirectory: path.resolve(value.workingDirectory),
    sandbox: value.sandbox as Sandbox,
    model: typeof value.model === "string" ? value.model.trim() : "",
    channel: value.channel ?? current.channel,
    proactive: { ...current.proactive, ...value.proactive },
  };
  await mkdir(config.workingDirectory, { recursive: true });
  await writeConfig(config);
  return config;
}
