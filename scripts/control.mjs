// 通过本机控制通道向守护进程发送启动、暂停、状态或备份命令。
import { createConnection } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runtimeDirectory } from "../shared/deployment.mjs";

export async function control(action) {
  const { socket: address, token } = JSON.parse(await readFile(path.join(runtimeDirectory, "control.json"), "utf8"));
  return new Promise((resolve, reject) => {
    const socket = createConnection(address);
    let received = "";
    socket.on("connect", () => socket.write(JSON.stringify({ action, token }) + "\n"));
    socket.on("data", chunk => { received += chunk; });
    socket.on("error", reject);
    socket.on("end", () => {
      const result = JSON.parse(received);
      result.error ? reject(new Error(result.error)) : resolve(result);
    });
  });
}
