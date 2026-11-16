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
import { tmpdir } from "node:os";
import path from "node:path";

test("data path ignores cwd and browser settings cannot expand Codex access", async () => {
  const original = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "mian-config-"));
  process.chdir(directory);
  process.env.MIAN_DATA_DIR = path.join(directory, "server/data");
  process.env.MIAN_WORKSPACE_DIR = path.join(directory, "workspace");
  try {
    const {
      readConfig,
      saveConfig,
      isProjectDirectory,
      projectDirectory,
      defaultWorkingDirectory,
      PROJECT_DIRECTORY_ERROR,
      dataDirectory,
    } = await import("../server/src/config.ts");
    assert.equal(
      defaultWorkingDirectory,
      path.join(directory, "workspace"),
    );
    assert.equal(dataDirectory, path.join(directory, "server/data"));
    process.chdir(original);
    assert.equal(dataDirectory, path.join(directory, "server/data"));
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
      sandbox: "workspace-write",
      proactive: { voice: true },
    });
    assert.deepEqual(JSON.parse(await readFile(configFile, "utf8")), legacy);
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
    assert.deepEqual(JSON.parse(await readFile(configFile, "utf8")), legacy);
    const custom = path.join(directory, "custom-workspace");
    await assert.rejects(saveConfig({ ...migrated, workingDirectory: custom }), /MIAN_WORKSPACE_DIR/);
    await assert.rejects(saveConfig({ ...migrated, sandbox: "danger-full-access" }), /sandbox/);
    await saveConfig(migrated);
    assert.deepEqual(await readConfig(), migrated);
  } finally {
    process.chdir(original);
    delete process.env.MIAN_DATA_DIR;
    delete process.env.MIAN_WORKSPACE_DIR;
    assert.equal(path.dirname(directory), tmpdir());
    await rm(directory, { recursive: true });
  }
});
