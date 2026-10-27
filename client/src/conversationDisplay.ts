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
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  if (sameDay) return `Today ${hour}:${minute}`;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}.${month}.${day}`;
}

export function formatLastMessage(value: string | null | undefined) {
  return value?.trim() || "还没有留下第一句话。";
}
