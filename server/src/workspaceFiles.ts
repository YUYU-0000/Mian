import { watch, type FSWatcher } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { ChatFile } from "./types.js";
import type { ChatFiles } from "./chatFiles.js";

// 同时接住补丁工具和命令写出的文件，回复结束时保存快照。
export class WorkspaceFiles {
  private readonly changed = new Set<string>();
  private readonly watcher: FSWatcher;
  private error: Error | null = null;

  constructor(private readonly directory: string) {
    this.watcher = watch(directory, { recursive: true }, (_event, filename) => {
      if (
        filename &&
        !filename
          .split(/[\\/]/)
          .some((part) => [".git", "node_modules"].includes(part))
      )
        this.changed.add(path.resolve(directory, filename));
    });
    this.watcher.on("error", (error) => {
      this.error = error;
    });
  }

  add(paths: string[]) {
    paths.forEach((filename) =>
      this.changed.add(path.resolve(this.directory, filename)),
    );
  }

  close() {
    this.watcher.close();
  }

  async finish(
    files: ChatFiles,
    conversationId: string,
    turnId: string,
  ): Promise<ChatFile[]> {
    this.close();
    if (this.error) throw this.error;
    const captured: ChatFile[] = [];
    for (const filename of this.changed) {
      try {
        const info = await lstat(filename);
        if (info.isDirectory()) {
          for (const name of await readdir(filename))
            if (name !== ".git" && name !== "node_modules")
              this.changed.add(path.join(filename, name));
          continue;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const file = await files.capture(
        conversationId,
        turnId,
        this.directory,
        filename,
      );
      if (file) captured.push(file);
    }
    return captured;
  }
}
