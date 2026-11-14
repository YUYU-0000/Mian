import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// 保持与 npm workspace 相同的数据目录，使用绝对路径标识服务进程。
const server = spawn(
  process.execPath,
  [fileURLToPath(new URL("./server/dist/index.js", import.meta.url)), "--lan"],
  {
    cwd: fileURLToPath(new URL("./server/", import.meta.url)),
    stdio: "inherit",
    windowsHide: true,
  },
);
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
