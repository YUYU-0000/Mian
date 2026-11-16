import { spawn } from "node:child_process";
import { appendFile, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { projectDirectory, runtimeDirectory } from "../shared/deployment.mjs";
import { control } from "./control.mjs";

const restart = process.argv.includes("--restart");
const origin = process.env.MIAN_PUBLIC_ORIGIN || "https://mian.crab-bless.com";
const running = await control("status").catch(error => {
  if (error.code === "ENOENT" || error.code === "ECONNREFUSED") return null;
  throw error;
});
if (running && !restart) {
  if (!running.running) await control("resume");
  console.log(`Mian is already running. ${origin}`);
} else {
  if (running) await control("pause");
  const build = spawn(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd run build"] : ["run", "build"], { cwd: projectDirectory, stdio: "inherit", windowsHide: true });
  const code = await new Promise(resolve => { build.on("error", error => { console.error(error.message); resolve(1); }); build.on("exit", resolve); });
  if (code !== 0) {
    if (running) await control("resume");
    process.exitCode = code || 1;
  } else if (running) {
    await control("resume");
    console.log(`Mian restarted. ${origin}`);
  } else {
    const scheduled = process.platform === "win32" && await new Promise(resolve => {
      const task = spawn("powershell.exe", ["-NoProfile", "-Command", "if (Get-ScheduledTask -TaskName Mian-Service -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName Mian-Service; exit 0 } else { exit 3 }"], { stdio: "inherit", windowsHide: true });
      task.once("exit", code => resolve(code === 0));
    });
    if (scheduled) {
      console.log(`Mian started by Task Scheduler. ${origin}`);
    } else {
      await mkdir(runtimeDirectory, { recursive: true });
      const log = path.join(runtimeDirectory, "mian.log");
      await appendFile(log, `\nMian started ${new Date().toISOString()}\n`);
      const output = await open(log, "a");
      const service = spawn(process.execPath, [path.join(projectDirectory, "scripts/service.mjs")], { cwd: projectDirectory, detached: true, windowsHide: true, stdio: ["ignore", output.fd, output.fd] });
      service.unref();
      await output.close();
      console.log(`Mian started in the background. ${origin}`);
    }
  }
}
