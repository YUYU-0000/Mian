import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

test("Codex defaults outside Mian, migrates old directories and rejects project paths without saving", async () => {
  const original = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "mian-config-"));
  process.chdir(directory);
  try {
    const {
      readConfig,
      saveConfig,
      isProjectDirectory,
      projectDirectory,
      defaultWorkingDirectory,
      PROJECT_DIRECTORY_ERROR,
    } = await import("../server/src/config.ts");
    assert.equal(
      defaultWorkingDirectory,
      path.join(homedir(), "MianWorkspace"),
    );
    assert.equal(
      (await readConfig()).workingDirectory,
      defaultWorkingDirectory,
    );
    assert.equal((await stat(defaultWorkingDirectory)).isDirectory(), true);
    assert.equal(isProjectDirectory(defaultWorkingDirectory), false);
    assert.equal(
      isProjectDirectory(path.resolve(projectDirectory, "../MianWorkspace")),
      false,
    );
    const configFile = path.join(directory, "server/data/config.json");
    await mkdir(path.dirname(configFile), { recursive: true });
    const legacy = {
      workingDirectory: path.join(projectDirectory, "server"),
      sandbox: "read-only" as const,
      model: "keep-model",
      channel: { kind: "api" as const, presetId: "keep-paper" },
    };
    await writeFile(configFile, JSON.stringify(legacy));
    const migrated = await readConfig();
    assert.deepEqual(migrated, {
      ...legacy,
      workingDirectory: defaultWorkingDirectory,
    });
    assert.deepEqual(JSON.parse(await readFile(configFile, "utf8")), migrated);
    for (const forbidden of [
      projectDirectory,
      path.join(projectDirectory, "client"),
      path.join(projectDirectory, "server", "..", "tests"),
      ...(process.platform === "win32" ? [projectDirectory.toUpperCase()] : []),
    ]) {
      assert.equal(isProjectDirectory(forbidden), true);
      await assert.rejects(
        saveConfig({ ...migrated, workingDirectory: forbidden }),
        { message: PROJECT_DIRECTORY_ERROR },
      );
    }
    assert.deepEqual(JSON.parse(await readFile(configFile, "utf8")), migrated);
    const custom = path.join(directory, "custom-workspace");
    await saveConfig({ ...migrated, workingDirectory: custom });
    assert.equal((await stat(custom)).isDirectory(), true);
    assert.deepEqual(await readConfig(), {
      ...migrated,
      workingDirectory: custom,
    });
  } finally {
    process.chdir(original);
    assert.equal(path.dirname(directory), tmpdir());
    await rm(directory, { recursive: true });
  }
});
