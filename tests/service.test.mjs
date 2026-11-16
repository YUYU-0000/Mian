// 验证守护进程的崩溃重启、暂停和完整备份流程。
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

test("supervisor restarts a crashed server and pauses it for a complete backup", { timeout: 30_000 }, async () => {
  const workspace = process.cwd();
  const temporary = await mkdtemp(path.join(tmpdir(), "mian-service-"));
  Object.assign(process.env, {
    MIAN_DATA_DIR: path.join(temporary, "data"),
    MIAN_WORKSPACE_DIR: path.join(temporary, "workspace"),
    MIAN_RUNTIME_DIR: path.join(temporary, "runtime"),
    MIAN_BACKUP_DIR: path.join(temporary, "backups"),
    MIAN_PORT: "0", MIAN_HOST: "127.0.0.1",
  });
  await mkdir(process.env.MIAN_DATA_DIR, { recursive: true });
  await writeFile(path.join(process.env.MIAN_DATA_DIR, "marker.txt"), "complete-copy");
  const { control } = await import("../scripts/control.mjs");
  const service = spawn(process.execPath, ["scripts/service.mjs"], { cwd: workspace, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  service.stderr.on("data", chunk => { logs += chunk; });
  const ready = () => new Promise((resolve, reject) => {
    const output = chunk => {
      if (String(chunk).includes("Mian: http")) { service.stdout.off("data", output); service.off("exit", exited); resolve(); }
    };
    const exited = () => reject(new Error(logs));
    service.stdout.on("data", output);
    service.once("exit", exited);
  });
  try {
    await ready();
    const first = await control("status");
    const restarted = ready();
    process.kill(first.pid, "SIGKILL");
    await restarted;
    assert.notEqual((await control("status")).pid, first.pid);
    const restored = ready();
    const backup = await control("backup");
    await restored;
    assert.equal(await readFile(path.join(backup.directory, "marker.txt"), "utf8"), "complete-copy");
    assert.equal((await control("status")).running, true);
    await control("pause");
    assert.equal((await control("status")).running, false);
  } finally {
    await control("pause").catch(() => { });
    const exited = once(service, "exit");
    service.kill("SIGTERM");
    await exited;
    assert.equal(path.dirname(temporary), tmpdir());
    await rm(temporary, { recursive: true, force: true });
  }
});
