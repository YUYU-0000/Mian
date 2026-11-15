import type { ToolEvent } from "./types";

export function visibleToolSummary(tool: ToolEvent): string {
  if (tool.summary && /^[\u3400-\u9fff]{4,12}$/.test(tool.summary))
    return tool.summary;
  const kind = (tool.kind || tool.rawName || "").toLowerCase();
  if (kind.includes("read_file") || kind.includes("readfile"))
    return "读取文件";
  if (kind.includes("write_file") || kind.includes("filechange"))
    return "修改文件";
  if (kind.includes("list_directory") || kind.includes("listdirectory"))
    return "查看目录";
  if (kind.includes("mcp") || kind.includes("dynamictool"))
    return "调用外部工具";
  if (kind.includes("websearch")) return "搜索网页";
  if (kind.includes("imageview")) return "查看图片";
  return "执行命令";
}

function stripTerminalControl(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trim();
}

export function readableToolResult(tool: ToolEvent): string {
  let text = stripTerminalControl(String(tool.result ?? tool.detail ?? ""));
  if (!text) {
    if (tool.state === "running") return "";
    if (tool.state === "success") return "工具已完成，无额外输出";
    if (tool.state === "rejected") return "工具调用已拒绝，无额外输出";
    return "工具执行失败，无额外错误信息";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
    if (typeof parsed === "string") text = parsed;
  } catch {
    parsed = undefined;
  }
  if (/\bGet-Location\b/i.test(tool.command || "")) {
    if (parsed && typeof parsed === "object" && "Path" in parsed) {
      return `当前工作目录：\n${String((parsed as { Path: unknown }).Path)}`;
    }
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^Path$/i.test(line) && !/^-+$/.test(line));
    const path = lines.find((line) => /^[A-Za-z]:\\/.test(line));
    if (path) return `当前工作目录：\n${path}`;
  }
  return text;
}
