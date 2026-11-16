// 暂停服务后完整复制数据，按日期保留最近十四天的自动备份。
import { cp, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { backupDirectory, dataDirectory } from "../shared/deployment.mjs";
import { control } from "./control.mjs";

const dateName = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export async function backupData({ source = dataDirectory, destination = backupDirectory, keep = 14 } = {}) {
  destination = path.resolve(destination);
  await mkdir(destination, { recursive: true });
  const date = new Date();
  const name = dateName(date);
  const target = path.join(destination, name);
  if (await stat(target).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; }))
    return { directory: target, existing: true };
  const temporary = await mkdtemp(path.join(destination, ".copy-"));
  try {
    await cp(source, temporary, { recursive: true, preserveTimestamps: true });
    await rename(temporary, target);
  } catch (error) {
    if (path.dirname(path.resolve(temporary)) !== destination) throw new Error("备份临时路径超出备份目录");
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  const oldest = new Date(date);
  oldest.setDate(date.getDate() - keep + 1);
  const expiredDates = (await readdir(destination, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name) && entry.name < dateName(oldest));
  for (const { name: expired } of expiredDates) {
    const expiredPath = path.resolve(destination, expired);
    if (path.dirname(expiredPath) !== destination) throw new Error("清理路径超出每日备份目录");
    await rm(expiredPath, { recursive: true });
  }
  return { directory: target, existing: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // 运行中由守护进程等回复结束、落盘并暂停服务，再复制完整目录。
  const result = await control("backup").catch(error => {
    if (error.code === "ENOENT" || error.code === "ECONNREFUSED") return backupData();
    throw error;
  });
  console.log(`Mian backup: ${result.directory}`);
}
