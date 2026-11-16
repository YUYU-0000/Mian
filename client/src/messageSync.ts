import { mergeUserGroups, type ChatGroup, type UserGroup } from "../../shared/chatModel.mjs";
import { backendAuthorized, LoginRequired } from "./backend";

export type MessageSnapshot = { groups: ChatGroup[]; exists: boolean; eventSeq: number; streamId: string };
export type MessageApi = {
  loadMessages: (id: string, cached?: (snapshot: MessageSnapshot) => void) => Promise<MessageSnapshot>;
  saveMessages: (id: string, groups: ChatGroup[], initialize?: boolean) => Promise<MessageSnapshot>;
};
const OUTBOX_KEY = "mian.message-outbox.v1";
const synchronizers = new Set<MessageSync>();
export async function flushMessageSyncs() {
  await Promise.all([...synchronizers].map(sync => sync.refresh()));
}

export class MessageSync {
  private pending: UserGroup[];
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private reloadRequested = false;
  private showedCache = false;
  initialized = false;

  constructor(
    private readonly id: string,
    private readonly initial: ChatGroup[],
    private readonly storage: Pick<Storage, "getItem" | "setItem">,
    private readonly api: MessageApi,
    private readonly start: () => void,
    private readonly receive: (snapshot: MessageSnapshot, cached?: boolean) => void,
  ) {
    try { this.pending = JSON.parse(storage.getItem(OUTBOX_KEY) ?? "[]"); }
    catch { this.pending = []; }
    synchronizers.add(this);
  }

  queue(group: UserGroup) {
    this.pending = [...this.pending.filter(item => item.groupId !== group.groupId), group];
    this.saveOutbox();
    this.retry(500);
  }

  refresh(): Promise<void> {
    if (this.running) return this.running;
    clearTimeout(this.timer);
    this.start();
    this.running = this.synchronize().catch(error => {
      if (!(error instanceof LoginRequired)) this.retry(2000);
      throw error;
    }).finally(() => {
      this.running = null;
      if (this.reloadRequested) { this.reloadRequested = false; this.retry(0); }
    });
    return this.running;
  }

  invalidate() {
    if (this.running) this.reloadRequested = true;
    else void this.refresh().catch(() => {});
  }

  private async synchronize() {
    let snapshot = await this.api.loadMessages(this.id, cached => {
      if (this.showedCache || this.initialized || this.disposed) return;
      this.showedCache = true;
      this.receive({ ...cached, groups: mergeUserGroups(cached.groups, this.pending) }, true);
    });
    if (!snapshot.exists && this.initial.length)
      snapshot = await this.api.saveMessages(this.id, this.initial, true);
    this.initialized = true;
    const batch = this.pending;
    if (batch.length) {
      if (!this.disposed) this.receive({ ...snapshot, groups: mergeUserGroups(snapshot.groups, batch) }, true);
      snapshot = await this.api.saveMessages(this.id, batch);
      this.pending = this.pending.filter(group => !batch.includes(group));
      this.saveOutbox();
    }
    if (this.disposed || !backendAuthorized()) return;
    this.receive({ ...snapshot, groups: mergeUserGroups(snapshot.groups, this.pending) });
    if (this.pending.length) this.retry(500);
  }

  private saveOutbox() { this.storage.setItem(OUTBOX_KEY, JSON.stringify(this.pending)); }

  private retry(delay: number) {
    if (this.disposed || !backendAuthorized()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.refresh().catch(() => {}); }, delay);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    synchronizers.delete(this);
  }
}
