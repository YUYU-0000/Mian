import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ChatFile } from "./types.js";
import type { ChatFiles } from "./chatFiles.js";

type Snapshot = Map<string, { mtimeMs: number; size: number }>;
const excludedDirectories = new Set([".git", "node_modules", ".mian-uploads"]);

export async function prepareConversationWorkspace(
  root: string,
  conversationId: string,
) {
  const directory = path.join(root, conversationId);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function snapshot(directory: string): Promise<Snapshot> {
  const result: Snapshot = new Map();
  const visit = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) await visit(filename);
      } else if (entry.isFile()) {
        const { mtimeMs, size } = await stat(filename);
        result.set(filename, { mtimeMs, size });
      }
    }
  };
  await visit(directory);
  return result;
}

// 每轮开始和结束各取一次快照，只收集新建或修改过的文件。
export class WorkspaceFiles {
  private constructor(
    private readonly directory: string,
    private readonly before: Snapshot,
  ) {}

  static async start(directory: string) {
    return new WorkspaceFiles(directory, await snapshot(directory));
  }

  async finish(
    files: ChatFiles,
    conversationId: string,
    turnId: string,
  ): Promise<ChatFile[]> {
    const after = await snapshot(this.directory);
    const captured: ChatFile[] = [];
    for (const [filename, current] of after) {
      const previous = this.before.get(filename);
      if (
        previous?.mtimeMs === current.mtimeMs &&
        previous.size === current.size
      )
        continue;
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
