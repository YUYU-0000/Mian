import { pad2 } from "./format";
const EMPTY_VALUE = "NONE";

export function displayConversationValue(value: string | null | undefined) {
  return value?.trim() || EMPTY_VALUE;
}

export function formatTokenUsage(totalTokens: number | null | undefined) {
  if (
    typeof totalTokens !== "number" ||
    !Number.isFinite(totalTokens) ||
    totalTokens < 0
  )
    return "—";
  if (totalTokens < 1000) return String(Math.floor(totalTokens));
  return `${(totalTokens / 1000).toFixed(1)}K`;
}

export function formatLastActivity(
  value: string | null | undefined,
  current = new Date(),
) {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  const sameDay =
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate();
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  if (sameDay) return `Today ${hour}:${minute}`;
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${date.getFullYear()}.${month}.${day}`;
}

export function formatLastMessage(value: string | null | undefined) {
  return value?.trim() || "还没有留下第一句话。";
}
