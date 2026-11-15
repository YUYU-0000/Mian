import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./config.js";
import type { ChatFile } from "./types.js";
import type { ChatMessage, ContentPart } from "./providers/openai.js";

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const FILE_TOO_LARGE = "單個文件不能超過 20MB。";

const imageTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
};
const textExtensions = new Set(
  "txt md markdown json jsonl csv tsv log yaml yml toml xml html htm css scss sass less js jsx ts tsx mjs cjs py rb go rs java c h cpp hpp cs swift kt kts sh bash zsh ps1 bat cmd sql r vue svelte ini conf config env tex diff patch".split(
    " ",
  ),
);
const extension = (name: string) => path.extname(name).slice(1).toLowerCase();

export function fileMimeType(name: string, supplied = "") {
  return (
    imageTypes[extension(name)] ||
    (textExtensions.has(extension(name))
      ? "text/plain"
      : supplied || "application/octet-stream")
  );
}

export type FileMessage = {
  role: "user" | "assistant";
  content: string;
  files?: Pick<ChatFile, "id">[];
};

export type BackupFile = { conversationId: string; file: ChatFile; content: string };

// 文件内容与票根信息分开保存，分支可直接复制整个会话目录。
export class ChatFiles {
  private readonly images = new Map<string, Promise<string>>();
  constructor(private readonly root = path.join(dataDirectory, "files")) {}

  saveDataImage(conversationId: string, dataUrl: string): Promise<string> {
    const id = `image-${createHash("sha256").update(dataUrl).digest("hex")}`;
    const key = `${conversationId}/${id}`;
    let saved = this.images.get(key);
    if (!saved) {
      saved = (async () => {
        const comma = dataUrl.indexOf(",");
        const mimeType = dataUrl.slice(5, comma).split(";")[0];
        const content = dataUrl.slice(comma + 1);
        const bytes = dataUrl.slice(0, comma).endsWith(";base64") ? Buffer.from(content, "base64") : Buffer.from(decodeURIComponent(content));
        const directory = this.directory(conversationId, id);
        const file: ChatFile = { id, name: `${id}.${mimeType.split("/")[1].replace("+xml", "")}`, mimeType, size: bytes.length, createdAt: new Date().toISOString() };
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "content"), bytes);
        await writeFile(path.join(directory, "metadata.json"), JSON.stringify(file));
        return `/api/conversations/${conversationId}/files/${id}?inline=1`;
      })().catch(error => { this.images.delete(key); throw error; });
      this.images.set(key, saved);
    }
    return saved;
  }

  async export(conversationIds: string[]): Promise<BackupFile[]> {
    const entries: BackupFile[] = [];
    for (const conversationId of conversationIds) {
      let ids: string[];
      try { ids = await readdir(this.directory(conversationId)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        continue;
      }
      for (const id of ids) {
        const stored = await this.get(conversationId, id);
        entries.push({ conversationId, file: stored.file, content: (await readFile(stored.path)).toString("base64") });
      }
    }
    return entries;
  }

  async restore(entries: BackupFile[]) {
    for (const { conversationId, file, content } of entries) {
      const directory = this.directory(conversationId, file.id);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "content"), Buffer.from(content, "base64"));
      await writeFile(path.join(directory, "metadata.json"), JSON.stringify(file));
    }
  }

  private directory(conversationId: string, id = "") {
    if (![conversationId, id].every((value) => /^[\w-]*$/.test(value)))
      throw new Error("文件不存在");
    return path.join(this.root, conversationId, id);
  }

  async save(
    conversationId: string,
    name: string,
    content: Buffer,
    mimeType = "",
    turnId?: string,
  ): Promise<ChatFile> {
    if (content.length > MAX_FILE_SIZE) throw new Error(FILE_TOO_LARGE);
    return this.store(
      conversationId,
      name,
      content.length,
      mimeType,
      (destination) => writeFile(destination, content),
      turnId,
    );
  }

  private async store(
    conversationId: string,
    name: string,
    size: number,
    mimeType: string,
    write: (destination: string) => Promise<void>,
    turnId?: string,
  ): Promise<ChatFile> {
    const filename = path.basename(name.replace(/\\/g, "/"));
    if (!filename) throw new Error("文件名不能為空");
    const file: ChatFile = {
      id: randomUUID(),
      name: filename,
      size,
      mimeType: fileMimeType(filename, mimeType),
      createdAt: new Date().toISOString(),
    };
    const directory = this.directory(conversationId, file.id);
    await mkdir(directory, { recursive: true });
    await write(path.join(directory, "content"));
    await writeFile(
      path.join(directory, "metadata.json"),
      JSON.stringify({ ...file, turnId }),
    );
    return file;
  }

  async get(conversationId: string, id: string) {
    const directory = this.directory(conversationId, id);
    const file = JSON.parse(
      await readFile(path.join(directory, "metadata.json"), "utf8"),
    ) as ChatFile;
    return { file, path: path.join(directory, "content") };
  }

  async copyConversation(source: string, target: string) {
    try {
      await cp(this.directory(source), this.directory(target), {
        recursive: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async apiMessages(
    conversationId: string,
    messages: FileMessage[],
  ): Promise<ChatMessage[]> {
    return Promise.all(
      messages.map(async ({ role, content, files = [] }) => {
        const parts: ContentPart[] = [];
        let text = content;
        for (const { id } of role === "user" ? files : []) {
          const stored = await this.get(conversationId, id);
          const label = `文件：${stored.file.name}（${stored.file.size} bytes）`;
          if (stored.file.mimeType.startsWith("image/")) {
            const bytes = await readFile(stored.path);
            parts.push({
              type: "image_url",
              image_url: {
                url: `data:${stored.file.mimeType};base64,${bytes.toString("base64")}`,
              },
            });
            text += `\n\n${label}`;
          } else if (
            stored.file.mimeType.startsWith("text/") ||
            textExtensions.has(extension(stored.file.name))
          ) {
            text += `\n\n${label}\n${await readFile(stored.path, "utf8")}`;
          } else text += `\n\n${label}`;
        }
        return {
          role,
          content: parts.length ? [{ type: "text", text }, ...parts] : text,
        };
      }),
    );
  }

  async codexPrompt(
    conversationId: string,
    workspace: string,
    text: string,
    ids: string[],
  ) {
    const paths: string[] = [];
    for (const id of ids) {
      const stored = await this.get(conversationId, id);
      const directory = path.join(
        workspace,
        ".mian-uploads",
        conversationId,
        id,
      );
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, stored.file.name);
      await cp(stored.path, destination);
      paths.push(
        `${stored.file.name}（${stored.file.size} bytes）：${destination}`,
      );
    }
    return paths.length
      ? `${text}\n\n使用者附上的文件，可直接讀取：\n${paths.join("\n")}`
      : text;
  }

  async capture(
    conversationId: string,
    turnId: string,
    workspace: string,
    filename: string,
  ) {
    let source: string;
    try {
      source = await realpath(path.resolve(workspace, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const relative = path.relative(await realpath(workspace), source);
    // 只接收工作目录里的实际文件，不跟随指向外面的链接。
    if (
      relative.startsWith(`..${path.sep}`) ||
      relative === ".." ||
      path.isAbsolute(relative)
    )
      return;
    const info = await stat(source);
    if (!info.isFile()) return;
    return this.store(
      conversationId,
      path.basename(source),
      info.size,
      "",
      (destination) => cp(source, destination),
      turnId,
    );
  }
}
