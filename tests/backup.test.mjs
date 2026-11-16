// 验证完整目录备份、日期保留和原始数据不被移动。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { backupData } from "../scripts/backup.mjs";

test("daily backups preserve nested data, retain fourteen days and leave other backups alone", async () => {
  const workspace = process.cwd();
  const temporary = await mkdtemp(path.join(workspace, ".tmp-backup-"));
  const source = path.join(temporary, "data"), destination = path.join(temporary, "daily");
  try {
    await mkdir(path.join(source, "messages", "c1"), { recursive: true });
    await mkdir(path.join(source, "voices"));
    await writeFile(path.join(source, "messages/c1/history.json"), '{"text":"original"}');
    await writeFile(path.join(source, "voices/clip.mp3"), Buffer.from([0, 255, 8, 12]));
    const previous = days => {
      const date = new Date();
      date.setDate(date.getDate() - days);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    for (let day = 1; day <= 17; day++) await mkdir(path.join(destination, previous(day)), { recursive: true });
    await mkdir(path.join(destination, "manual-keep"));
    await writeFile(path.join(destination, "readme.txt"), "keep");
    const first = await backupData({ source, destination });
    assert.equal(first.existing, false);
    assert.equal(await readFile(path.join(first.directory, "messages/c1/history.json"), "utf8"), '{"text":"original"}');
    assert.deepEqual(await readFile(path.join(first.directory, "voices/clip.mp3")), Buffer.from([0, 255, 8, 12]));
    const entries = await readdir(destination);
    assert.equal(entries.filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)).length, 14);
    assert.ok(entries.includes(previous(13)));
    assert.ok(!entries.includes(previous(14)));
    assert.ok(entries.includes("manual-keep"));
    assert.ok(entries.includes("readme.txt"));
    await writeFile(path.join(source, "messages/c1/history.json"), "changed");
    assert.equal((await backupData({ source, destination })).existing, true);
    assert.equal(await readFile(path.join(first.directory, "messages/c1/history.json"), "utf8"), '{"text":"original"}');
    assert.equal(await readFile(path.join(source, "messages/c1/history.json"), "utf8"), "changed");
  } finally {
    assert.equal(path.dirname(temporary), workspace);
    await rm(temporary, { recursive: true, force: true });
  }
});

