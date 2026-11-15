import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./config.js";
import { ChatFiles } from "./chatFiles.js";
import { mergeUserGroups, applyReplyEvent, closePendingGroup, type ChatGroup, type UserGroup } from "../../shared/chatModel.mjs";
import type { ChatEvent } from "../../shared/types.mjs";

type State = { groups: ChatGroup[] | null; eventSeq: number };
export type MessageSnapshot = { groups: ChatGroup[]; exists: boolean; eventSeq: number };

// 两个通道共用一份记录，写入按会话串行，流式增量合并后落盘。
export class ConversationMessages {
  private readonly states = new Map<string, State>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly files: ChatFiles, private readonly root = path.join(dataDirectory, "messages")) {}

  private filename(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error("会话不存在");
    return path.join(this.root, `${id}.json`);
  }

  private run<T>(id: string, operation: (state: State) => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      let state = this.states.get(id);
      if (!state) {
        let groups: ChatGroup[] | null;
        try { groups = JSON.parse(await readFile(this.filename(id), "utf8")); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          groups = null;
        }
        state = { groups, eventSeq: 0 };
        this.states.set(id, state);
      }
      return operation(state);
    });
    this.queues.set(id, next);
    return next;
  }

  private snapshot(state: State): MessageSnapshot {
    return { groups: state.groups ?? [], exists: state.groups !== null, eventSeq: state.eventSeq };
  }

  private async imageUrls(id: string, value: unknown): Promise<any> {
    if (typeof value === "string") {
      const pattern = /data:image\/[\w.+-]+(?:;[\w=.-]+)*,[^\s"'<>)]*/g;
      let result = "", end = 0;
      for (const match of value.matchAll(pattern)) {
        result += value.slice(end, match.index) + await this.files.saveDataImage(id, match[0]);
        end = match.index! + match[0].length;
      }
      return result + value.slice(end);
    }
    if (Array.isArray(value)) return Promise.all(value.map(item => this.imageUrls(id, item)));
    if (value && typeof value === "object")
      return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await this.imageUrls(id, item)])));
    return value;
  }

  private async write(id: string, state: State) {
    if (state.groups === null) return;
    const ready = (state.groups ?? []).map(group => group.role === "assistant" && !group.status ? {
      ...group,
      raw: group.raw.replace(/data:image\/[^\s"'<>)]*$/, ""),
      bubbles: group.bubbles.map(text => text.replace(/data:image\/[^\s"'<>)]*$/, "")),
      preToolBubbles: group.preToolBubbles.map(text => text.replace(/data:image\/[^\s"'<>)]*$/, "")),
    } : group);
    const groups: ChatGroup[] = await this.imageUrls(id, ready);
    await mkdir(this.root, { recursive: true });
    const filename = this.filename(id);
    try {
      await writeFile(`${filename}.tmp`, JSON.stringify(groups));
      await rename(`${filename}.tmp`, filename);
    } catch (error) {
      clearTimeout(this.timers.get(id));
      this.timers.set(id, setTimeout(() => {
        this.timers.delete(id);
        void this.flush(id).catch(cause => console.error("[messages]", cause));
      }, 2000));
      throw error;
    }
    if (groups.every(group => group.role === "user" || group.status)) state.groups = groups;
  }

  read(id: string) { return this.run(id, async state => this.snapshot(state)); }

  save(id: string, groups: ChatGroup[], initialize = false) {
    return this.run(id, async state => {
      if (initialize && state.groups !== null) return this.snapshot(state);
      if (initialize && !groups.length) return this.snapshot(state);
      state.groups = initialize ? groups : mergeUserGroups(state.groups ?? [], groups.filter((group): group is UserGroup => group.role === "user"));
      await this.write(id, state);
      return this.snapshot(state);
    });
  }

  submit(id: string, message: UserGroup) {
    return this.run(id, async state => {
      state.groups = closePendingGroup(mergeUserGroups(state.groups ?? [], [message]), message.groupId);
      await this.write(id, state);
      return this.snapshot(state);
    });
  }

  recordEvent(id: string, event: Extract<ChatEvent, { turnId: string }>, seq: number) {
    return this.run(id, async state => {
      state.groups = applyReplyEvent(state.groups ?? [], event, new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }));
      state.eventSeq = seq;
      if (event.type === "turn-completed") {
        clearTimeout(this.timers.get(id));
        this.timers.delete(id);
        await this.write(id, state);
      } else if (!this.timers.has(id)) {
        this.timers.set(id, setTimeout(() => {
          this.timers.delete(id);
          void this.flush(id).catch(error => console.error("[messages]", error));
        }, 250));
      }
    });
  }

  dismissApproval(id: string, requestId: string) {
    return this.run(id, async state => {
      state.groups = (state.groups ?? []).map(group => group.role === "assistant" ? { ...group, approvals: group.approvals.filter(approval => approval.requestId !== requestId) } : group);
      await this.write(id, state);
    });
  }

  flush(id: string) { return this.run(id, state => this.write(id, state)); }

  async copy(source: string, target: string) {
    const { groups } = await this.read(source);
    const copied = JSON.parse(JSON.stringify(groups).replaceAll(`/conversations/${source}/files/`, `/conversations/${target}/files/`));
    await this.save(target, copied, true);
  }

  async export(ids: string[]) {
    return Object.fromEntries(await Promise.all(ids.map(async id => {
      await this.flush(id);
      const snapshot = await this.read(id);
      return [id, snapshot.exists ? JSON.parse(await readFile(this.filename(id), "utf8")) : []];
    })));
  }

  replace(id: string, groups: ChatGroup[]) {
    return this.run(id, async state => {
      state.groups = groups.map(group => group.role === "user" ? { ...group, pending: false } : {
        ...group, status: group.status || "interrupted", approvals: [], activeReasoningItemIds: [],
        preToolComplete: true, preToolBubbleComplete: group.preToolBubbles.map(() => true), bubbleComplete: group.bubbles.map(() => true),
      });
      await this.write(id, state);
    });
  }

  async remove(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    await this.run(id, async () => { await rm(this.filename(id), { force: true }); });
    this.states.delete(id);
  }

  async close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.all([...this.states.keys()].map(id => this.flush(id)));
  }
}
