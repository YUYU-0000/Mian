export const PENDING_STORAGE_KEY = "mian.pending-user-records.v1";

export type PendingUserRecord = {
  id: string;
  text: string;
  time: string;
};

type StorageLike = Pick<Storage, "getItem">;

export function loadPending(storage: StorageLike): PendingUserRecord[] {
  try {
    const raw = storage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is PendingUserRecord =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as PendingUserRecord).id === "string" &&
        typeof (item as PendingUserRecord).text === "string" &&
        Boolean((item as PendingUserRecord).text.trim()) &&
        typeof (item as PendingUserRecord).time === "string",
    );
  } catch {
    return [];
  }
}
