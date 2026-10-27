import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ConversationRecord,
  ConversationRuntimeMetadata,
  ConversationThreadBinding,
} from "./types.js";

const root = path.resolve(process.cwd(), "server", "data");
const file = path.join(root, "conversations.json");
export const DEFAULT_CONVERSATION_ID = "c1";

type PersistedConversations = {
  version: 2;
  defaultConversationId: string;
  records: ConversationRecord[];
};

const now = () => new Date().toISOString();

const emptyRuntimeMetadata = (): ConversationRuntimeMetadata => ({
  model: null,
  reasoningEffort: null,
  totalTokens: null,
  uncachedTotalTokens: null,
  collaborationMode: null,
});

function normalizeNullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function defaultConversation(): ConversationRecord {
  const timestamp = now();
  return {
    conversationId: DEFAULT_CONVERSATION_ID,
    threadId: null,
    parentConversationId: null,
    rootNumber: 1,
    branchPath: [],
    branchCounter: 0,
    abbr: "C-01",
    title: "ARCHIVE CHAT",
    frontName: "Mian",
    image: "",
    pinned: true,
    ...emptyRuntimeMetadata(),
    lastActivityAt: null,
    lastMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeConversationRecord(
  value: Partial<ConversationRecord>,
): ConversationRecord | null {
  if (typeof value.conversationId !== "string" || !value.conversationId) return null;
  const timestamp = now();
  return {
    conversationId: value.conversationId,
    threadId: typeof value.threadId === "string" && value.threadId ? value.threadId : null,
    parentConversationId:
      typeof value.parentConversationId === "string" ? value.parentConversationId : null,
    rootNumber: Number.isSafeInteger(value.rootNumber) && Number(value.rootNumber) > 0
      ? Number(value.rootNumber)
      : 1,
    branchPath: Array.isArray(value.branchPath)
      ? value.branchPath.filter((part) => Number.isSafeInteger(part) && part > 0)
      : [],
    branchCounter: Number.isSafeInteger(value.branchCounter) && Number(value.branchCounter) >= 0
      ? Number(value.branchCounter)
      : 0,
    abbr: typeof value.abbr === "string" && value.abbr ? value.abbr : "C-01",
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : "ARCHIVE CHAT",
    frontName: typeof value.frontName === "string" && value.frontName.trim() ? value.frontName.trim() : "Mian",
    image: typeof value.image === "string" ? value.image : "",
    pinned: value.pinned === true,
    model: normalizeNullableText(value.model),
    reasoningEffort: normalizeNullableText(value.reasoningEffort),
    totalTokens:
      typeof value.totalTokens === "number" &&
      Number.isSafeInteger(value.totalTokens) &&
      value.totalTokens >= 0
        ? value.totalTokens
        : null,
    uncachedTotalTokens:
      typeof value.uncachedTotalTokens === "number" &&
      Number.isSafeInteger(value.uncachedTotalTokens) &&
      value.uncachedTotalTokens >= 0
        ? value.uncachedTotalTokens
        : null,
    lastActivityAt: normalizeNullableText(value.lastActivityAt),
    lastMessage: normalizeNullableText(value.lastMessage),
    collaborationMode: normalizeNullableText(value.collaborationMode),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : timestamp,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : timestamp,
  };
}

export class ConversationRegistry {
  private records: ConversationRecord[];
  private persistQueue: Promise<void> = Promise.resolve();

  private constructor(
    records: ConversationRecord[],
    private readonly storageFile = file,
  ) {
    this.records = records;
  }

  static async load(storageFile = file) {
    try {
      const parsed = JSON.parse(await readFile(storageFile, "utf8")) as Partial<PersistedConversations>;
      const records = Array.isArray(parsed.records)
        ? parsed.records.map(normalizeConversationRecord).filter((record): record is ConversationRecord => Boolean(record))
        : [];
      // C-01 is created only for first-run/legacy migration. Once a persisted
      // registry contains other conversations, deleting C-01 must survive a
      // service restart instead of silently recreating it.
      if (records.length === 0) records.push(defaultConversation());
      const registry = new ConversationRegistry(records, storageFile);
      if (parsed.version !== 2)
        await registry.persist().catch((error) =>
          console.error("[conversations:migration]", error),
        );
      return registry;
    } catch {
      return new ConversationRegistry([defaultConversation()], storageFile);
    }
  }

  list() {
    return [...this.records].sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return left.createdAt.localeCompare(right.createdAt);
    });
  }

  defaultConversationId() {
    return (
      this.records.find(
        (record) => record.conversationId === DEFAULT_CONVERSATION_ID,
      )?.conversationId ??
      this.list()[0]?.conversationId ??
      DEFAULT_CONVERSATION_ID
    );
  }

  get(conversationId: string) {
    return this.records.find((record) => record.conversationId === conversationId);
  }

  require(conversationId: string) {
    const record = this.get(conversationId);
    if (!record) throw new Error("对话窗口不存在");
    return record;
  }

  async adoptLegacyThread(threadId: string | null | undefined) {
    if (!threadId) return;
    const record = this.require(this.defaultConversationId());
    if (record.threadId) return;
    record.threadId = threadId;
    record.updatedAt = now();
    await this.persist();
  }

  async createRoot(binding: ConversationThreadBinding) {
    const rootNumber = Math.max(0, ...this.records.map((record) => record.rootNumber)) + 1;
    const number = String(rootNumber).padStart(2, "0");
    const timestamp = now();
    const record: ConversationRecord = {
      conversationId: randomUUID(),
      threadId: binding.threadId,
      parentConversationId: null,
      rootNumber,
      branchPath: [],
      branchCounter: 0,
      abbr: `C-${number}`,
      title: "新建会话",
      frontName: "Mian",
      image: "",
      pinned: false,
      ...emptyRuntimeMetadata(),
      ...binding.metadata,
      lastActivityAt: null,
      lastMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.records.push(record);
    await this.persist();
    return record;
  }

  async createBranch(
    parentConversationId: string,
    binding: ConversationThreadBinding,
  ) {
    const parent = this.require(parentConversationId);
    parent.branchCounter += 1;
    parent.updatedAt = now();
    const branchPath = [...parent.branchPath, parent.branchCounter];
    const rootText = String(parent.rootNumber).padStart(2, "0");
    const pathText = branchPath.map((part) => String(part).padStart(2, "0")).join("-");
    const timestamp = now();
    const record: ConversationRecord = {
      ...parent,
      conversationId: randomUUID(),
      threadId: binding.threadId,
      parentConversationId,
      branchPath,
      branchCounter: 0,
      abbr: `C-${rootText}-${pathText}`,
      title: "新建分支",
      pinned: false,
      ...binding.metadata,
      totalTokens: null,
      uncachedTotalTokens: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.records.push(record);
    await this.persist();
    return record;
  }

  async setThread(
    conversationId: string,
    binding: ConversationThreadBinding,
  ) {
    const record = this.require(conversationId);
    record.threadId = binding.threadId;
    if (Object.keys(binding.metadata).length)
      await this.updateRuntime(conversationId, binding.metadata);
    else {
      record.updatedAt = now();
      await this.persist();
    }
    return record;
  }

  async updateRuntime(
    conversationId: string,
    patch: Partial<ConversationRuntimeMetadata>,
  ) {
    const record = this.require(conversationId);
    if ("model" in patch) record.model = normalizeNullableText(patch.model);
    if ("reasoningEffort" in patch)
      record.reasoningEffort = normalizeNullableText(patch.reasoningEffort);
    if (
      typeof patch.totalTokens === "number" &&
      Number.isSafeInteger(patch.totalTokens) &&
      patch.totalTokens >= 0
    )
      record.totalTokens = patch.totalTokens;
    if (
      typeof patch.uncachedTotalTokens === "number" &&
      Number.isSafeInteger(patch.uncachedTotalTokens) &&
      patch.uncachedTotalTokens >= 0
    )
      record.uncachedTotalTokens = patch.uncachedTotalTokens;
    if ("collaborationMode" in patch)
      record.collaborationMode = normalizeNullableText(patch.collaborationMode);
    record.updatedAt = now();
    await this.persist();
    return record;
  }

  async updateActivity(
    conversationId: string,
    patch: { lastActivityAt?: string; lastMessage?: string },
  ) {
    const record = this.require(conversationId);
    if (typeof patch.lastActivityAt === "string" && patch.lastActivityAt.trim())
      record.lastActivityAt = patch.lastActivityAt;
    if (typeof patch.lastMessage === "string")
      record.lastMessage = normalizeNullableText(patch.lastMessage);
    record.updatedAt = now();
    await this.persist();
    return record;
  }

  async update(
    conversationId: string,
    patch: Partial<Pick<ConversationRecord, "title" | "frontName" | "image" | "pinned">>,
  ) {
    const record = this.require(conversationId);
    if (typeof patch.title === "string" && patch.title.trim()) record.title = patch.title.trim();
    if (typeof patch.frontName === "string" && patch.frontName.trim()) record.frontName = patch.frontName.trim();
    if (typeof patch.image === "string") record.image = patch.image;
    if (typeof patch.pinned === "boolean") {
      if (patch.pinned)
        for (const item of this.records) item.pinned = false;
      record.pinned = patch.pinned;
    }
    record.updatedAt = now();
    await this.persist();
    return record;
  }

  async remove(conversationId: string) {
    if (this.records.length <= 1) throw new Error("最后一个会话不能归档");
    const index = this.records.findIndex(
      (record) => record.conversationId === conversationId,
    );
    if (index < 0) throw new Error("对话窗口不存在");
    const [removed] = this.records.splice(index, 1);
    try {
      await this.persist();
      return removed;
    } catch (error) {
      this.records.splice(index, 0, removed);
      throw error;
    }
  }

  private persist() {
    const write = async () => {
      const value: PersistedConversations = {
        version: 2,
        defaultConversationId: this.defaultConversationId(),
        records: this.records,
      };
      await mkdir(path.dirname(this.storageFile), { recursive: true });
      await writeFile(this.storageFile, JSON.stringify(value, null, 2), "utf8");
    };
    this.persistQueue = this.persistQueue.then(write, write);
    return this.persistQueue;
  }
}
