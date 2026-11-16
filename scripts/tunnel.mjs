import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { projectDirectory } from "../shared/deployment.mjs";

const configuration = path.resolve(projectDirectory, process.env.MIAN_TUNNEL_CONFIG || path.join(homedir(), ".cloudflared/mian.yml"));
const tunnel = spawn(process.env.MIAN_CLOUDFLARED_BIN || "cloudflared", ["tunnel", "--config", configuration, "run"], {
  cwd: projectDirectory, stdio: "inherit", windowsHide: true,
});
process.on("SIGINT", () => tunnel.kill("SIGINT"));
process.on("SIGTERM", () => tunnel.kill("SIGTERM"));
tunnel.on("error", error => { console.error(error.message); process.exitCode = 1; });
// A tunnel should keep running; Task Scheduler restarts unexpected exits.
tunnel.on("exit", code => { process.exitCode = code || 1; });

