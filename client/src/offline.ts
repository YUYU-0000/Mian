import { backendAvailable, backendAuthorized, onBackendRecovery, request, BackendUnavailable, LoginRequired } from "./backend";
import { readOffline, writeOffline } from "./offlineStorage";

type QueuedSave = { url: string; method: string; body?: string; keys: string[] };
type Query = { used: () => boolean; refresh: () => Promise<unknown>; publish: (value: unknown, notify: boolean) => void };
const queries = new Map<string, Query>();
const revisions = new Map<string, number>();
let outbox: QueuedSave[] = [];
let loaded: Promise<void> | undefined;
let writes: Promise<unknown> = Promise.resolve();
let flushing: Promise<void> | undefined;
let queuedAt = 0;
const notices = new Set<() => void>();
export const recentlyQueuedSave = () => Date.now() - queuedAt < 1000;
export function onQueuedSave(listener: () => void) {
  notices.add(listener);
  return () => { notices.delete(listener); };
}
const initialize = () => loaded ??= readOffline<QueuedSave[]>("outbox").then(saved => { outbox = saved ?? []; });
const pending = (key: string) => outbox.some(save => save.keys.includes(key));
const revision = (key: string) => revisions.get(key) ?? 0;
function publish(key: string, value: unknown, notify = true) {
  revisions.set(key, revision(key) + 1);
  queries.get(key)?.publish(value, notify);
}

export function readQuery<T>(url: string, transform?: (value: T) => Promise<T>, background = true) {
  let value: T | undefined;
  let hydrated: Promise<void> | undefined;
  let running: Promise<T> | undefined;
  let used = false;
  const listeners = new Set<(value: T) => void>();
  const hydrate = () => hydrated ??= readOffline<T>(url).then(saved => { value ??= saved; });
  const receive = (next: T, notify = true) => {
    value = next;
    if (notify) for (const listener of listeners) listener(next);
  };
  const refresh = (): Promise<T> => running ??= (async () => {
    used = true;
    await initialize();
    await hydrate();
    if (pending(url) && value !== undefined) return value;
    const before = revision(url);
    let next = await request<T>(url);
    if (transform) next = await transform(next);
    // 请求发出以后发生的本地保存优先，旧响应不能覆盖它。
    if (before !== revision(url) || pending(url)) return value!;
    const written = await writeOffline({ [url]: next }, url);
    if (written && before === revision(url) && !pending(url)) publish(url, next);
    return value!;
  })().finally(() => { running = undefined; });
  const read = async () => {
    used = true;
    await hydrate();
    if (value !== undefined) {
      void refresh().catch(() => {});
      return value;
    }
    return refresh();
  };
  read.watch = (receiveValue: (value: T) => void) => {
    let active = true;
    let delivered = false;
    const listener = (next: T) => { delivered = true; receiveValue(next); };
    listeners.add(listener);
    void read().then(next => { if (active && !delivered) receiveValue(next); }).catch(() => {});
    return () => { active = false; listeners.delete(listener); };
  };
  read.refresh = refresh;
  read.peek = async () => { await hydrate(); return value; };
  read.update = async (change: (current: T | undefined) => T | undefined, notify = true) => {
    await initialize();
    await hydrate();
    if (pending(url)) return;
    const next = change(value);
    if (next === undefined) return;
    const before = revision(url) + 1;
    revisions.set(url, before);
    receive(next, false);
    const written = await writeOffline({ [url]: next }, url);
    if (written && before === revision(url) && !pending(url)) publish(url, next, notify);
  };
  read.load = async (cached: (value: T) => void) => {
    await hydrate();
    if (value !== undefined) cached(value);
    return refresh();
  };
  queries.set(url, { used: () => used && background, refresh, publish: (next, notify) => receive(next as T, notify) });
  return read;
}

async function flush() {
  await initialize();
  return flushing ??= (async () => {
    while (outbox.length) {
      if (!backendAuthorized()) throw new LoginRequired();
      const save = outbox[0];
      await request(save.url, { method: save.method, body: save.body });
      const remaining = outbox.slice(1);
      await writeOffline({ outbox: remaining });
      outbox = remaining;
    }
  })().finally(() => { flushing = undefined; });
}

export function queueSave<T>(url: string, method: string, body: unknown,
  prepare: () => Promise<{ updates: Record<string, unknown>; result: T }>, quiet = false): Promise<T> {
  const operation = writes.catch(() => {}).then(async () => {
    if (!backendAuthorized()) throw new LoginRequired();
    await initialize();
    const { updates, result } = await prepare();
    const save = { url, method, body: body === undefined ? undefined : JSON.stringify(body), keys: Object.keys(updates) };
    const next = [...outbox, save];
    const previous = outbox;
    outbox = next;
    for (const key of save.keys) revisions.set(key, revision(key) + 1);
    try { await writeOffline({ ...updates, outbox: next }); }
    catch (error) { outbox = previous; throw error; }
    for (const [key, value] of Object.entries(updates)) publish(key, value, false);
    try {
      if (!backendAvailable()) throw new BackendUnavailable();
      await flush();
    } catch (error) {
      if (error instanceof LoginRequired) throw error;
      if (!quiet) {
        queuedAt = Date.now();
        for (const listener of notices) listener();
      }
      if (!(error instanceof BackendUnavailable)) throw error;
    }
    return result;
  });
  writes = operation;
  return operation;
}

export async function refreshReads() {
  await Promise.allSettled([...queries.values()].filter(query => query.used()).map(query => query.refresh()));
}

export function flushOfflineSaves() {
  const operation = writes.catch(() => {}).then(flush);
  writes = operation;
  return operation;
}

export function startOfflineSync() {
  let recovering: Promise<void> | undefined;
  const recover = () => recovering ??= (async () => {
    if (!backendAuthorized()) return;
    await initialize();
    await request("/api/config");
    try { await flushOfflineSaves(); }
    finally { await refreshReads(); }
  })().catch(() => {}).finally(() => { recovering = undefined; });
  const retry = () => { if (!backendAvailable() || outbox.length) void recover(); };
  const visible = () => { if (document.visibilityState === "visible") void recover(); };
  const stop = onBackendRecovery(() => { void recover(); });
  const timer = window.setInterval(retry, 4000);
  window.addEventListener("online", recover);
  document.addEventListener("visibilitychange", visible);
  void initialize().then(retry);
  return () => {
    stop();
    window.clearInterval(timer);
    window.removeEventListener("online", recover);
    document.removeEventListener("visibilitychange", visible);
  };
}
