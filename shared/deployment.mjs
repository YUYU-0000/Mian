import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const environmentFile = path.join(projectDirectory, ".env");
if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
export const dataDirectory = path.resolve(projectDirectory, process.env.MIAN_DATA_DIR || "server/data");
export const workingDirectory = path.resolve(projectDirectory, process.env.MIAN_WORKSPACE_DIR || path.join(homedir(), "MianWorkspace"));
export const runtimeDirectory = path.resolve(projectDirectory, process.env.MIAN_RUNTIME_DIR || ".mian-runtime");
export const backupDirectory = path.resolve(projectDirectory, process.env.MIAN_BACKUP_DIR || path.join(homedir(), ...(process.platform === "win32" ? ["Desktop", "Mian备份", "每日"] : ["MianBackups", "daily"])));
