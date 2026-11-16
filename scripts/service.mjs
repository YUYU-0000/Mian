// 守护后端进程，处理异常重启、本机控制请求和停服备份。
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectDirectory, runtimeDirectory } from "../shared/deployment.mjs";
import { backupData } from "./backup.mjs";

await mkdir(runtimeDirectory, { recursive: true });
const address = process.platform === "win32"
  ? `\\\\.\\pipe\\mian-${createHash("sha256").update(runtimeDirectory).digest("hex").slice(0, 16)}`
  : path.join(runtimeDirectory, "control.sock");
const token = randomBytes(32).toString("hex");
let child, exiting, paused = false, stopping = false, restartTimer;
let operations = Promise.resolve();
const start = () => {
  child = spawn(process.execPath, [path.join(projectDirectory, "server/dist/index.js"), "--lan"], {
    cwd: projectDirectory, stdio: ["ignore", "inherit", "inherit", "ipc"], windowsHide: true,
  });
  exiting = new Promise(resolve => child.once("exit", resolve));
  child.once("error", error => { console.error(error.message); process.exitCode = 1; void close(); });
  child.once("exit", code => {
    child = undefined;
    if (!paused && !stopping) {
      console.error(`Mian exited (${code}); restarting in 5 seconds.`);
      restartTimer = setTimeout(start, 5000);
    }
  });
};
const stopChild = async (idle = false) => {
  clearTimeout(restartTimer);
  if (child) { child.send({ type: idle ? "shutdown-when-idle" : "shutdown" }); await exiting; }
};
const server = createServer(socket => {
  let incoming = "";
  socket.on("data", chunk => {
    incoming += chunk;
    if (!incoming.includes("\n")) return;
    socket.removeAllListeners("data");
    const request = JSON.parse(incoming);
    if (request.token !== token) { socket.end(JSON.stringify({ error: "Unauthorized" })); return; }
    const execute = async () => {
      if (request.action === "status") return { running: !!child, pid: child?.pid };
      if (!["pause", "resume", "backup"].includes(request.action)) throw new Error("Unknown action");
      if (request.action === "resume") { paused = false; if (!child) start(); return { running: true }; }
      paused = true;
      await stopChild(request.action === "backup");
      if (request.action === "pause") return { running: false };
      try { return await backupData(); }
      finally { paused = false; if (!stopping) start(); }
    };
    const next = operations.then(execute, execute);
    operations = next;
    void next.then(result => socket.end(JSON.stringify(result)), error => socket.end(JSON.stringify({ error: error.message })));
  });
  socket.on("error", () => { });
});
async function close() {
  if (stopping) return;
  stopping = true;
  await stopChild();
  server.close();
  await rm(path.join(runtimeDirectory, "control.json"), { force: true });
}
server.on("error", error => { console.error(error.message); process.exit(1); });
// Linux 的 socket 会在断电后留下；同一实例由任务计划或 systemd 保证唯一。
if (process.platform !== "win32") await rm(address, { force: true });
server.listen(address, async () => {
  if (process.platform !== "win32") await chmod(address, 0o600);
  await writeFile(path.join(runtimeDirectory, "control.json"), JSON.stringify({ socket: address, token }), { mode: 0o600 });
  start();
});
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
