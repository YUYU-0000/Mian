// 固定 Codex 的工作区与工具权限，生成不经过 shell 的启动参数。
import path from "node:path";
import type { AppConfig } from "./types.js";

export const CODEX_PERMISSIONS = "mian-workspace";
export const CODEX_READ_PERMISSIONS = "mian-read";

export function codexOverrides(config: AppConfig): Record<string, unknown> {
  const root = config.workingDirectory;
  const profile = (access: "read" | "write") => ({
    filesystem: { ":root": "deny", ":minimal": "read", [root]: access },
    network: { enabled: false },
  });
  return {
    default_permissions: CODEX_PERMISSIONS,
    permissions: { [CODEX_PERMISSIONS]: profile("write"), [CODEX_READ_PERMISSIONS]: profile("read") },
    approval_policy: "never",
    approvals_reviewer: "user",
    // 不加载工作区可写的配置、个人 MCP、插件、钩子或宿主文件工具。
    projects: { [root]: { trust_level: "untrusted" } },
    mcp_servers: {},
    "features.apps": false,
    "features.connectors": false,
    "features.plugins": false,
    "features.hooks": false,
    "features.codex_hooks": false,
    "features.plugin_hooks": false,
    "features.browser_use": false,
    "features.in_app_browser": false,
    "features.computer_use": false,
    "features.js_repl": false,
    "features.memory_tool": false,
    "features.skip_host_skill_discovery": true,
    "features.skill_mcp_dependency_install": false,
    "features.multi_agent": false,
    "features.remote_control": false,
    "features.use_legacy_landlock": false,
    "features.view_image": false,
    web_search: "disabled",
    project_doc_max_bytes: 0,
    "shell_environment_policy.inherit": "core",
    "shell_environment_policy.set": { TEMP: path.join(root, ".tmp"), TMP: path.join(root, ".tmp"), TMPDIR: path.join(root, ".tmp") },
    ...(process.platform === "win32" ? { "windows.sandbox": "mxc" } : {}),
  };
}

// TOML 内联表用于 argv，不经过 shell，Windows 路径保留转义。
function toml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function codexArguments(config: AppConfig) {
  return ["app-server", "--stdio", ...Object.entries(codexOverrides(config)).flatMap(([key, value]) => ["-c", `${key}=${toml(value)}`])];
}
