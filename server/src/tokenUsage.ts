export type CumulativeTokenUsagePatch = {
  totalTokens?: number;
  uncachedTotalTokens?: number;
};

export type ParsedCumulativeTokenUsage = {
  patch: CumulativeTokenUsagePatch;
  warning?: string;
};

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function parseCumulativeTokenUsage(
  value: unknown,
): ParsedCumulativeTokenUsage {
  const patch: CumulativeTokenUsagePatch = {};
  if (!value || typeof value !== "object") return { patch };

  const total = value as Record<string, unknown>;
  if (isNonNegativeSafeInteger(total.totalTokens))
    patch.totalTokens = total.totalTokens;

  const inputTokens = total.inputTokens;
  const cachedInputTokens = total.cachedInputTokens;
  const outputTokens = total.outputTokens;
  if (
    !isNonNegativeSafeInteger(inputTokens) ||
    !isNonNegativeSafeInteger(cachedInputTokens) ||
    !isNonNegativeSafeInteger(outputTokens)
  )
    return { patch };

  const uncachedTotalTokens = Math.max(
    0,
    inputTokens - cachedInputTokens + outputTokens,
  );
  if (!Number.isSafeInteger(uncachedTotalTokens))
    return {
      patch,
      warning: "Token usage exceeds the safe integer range; display value ignored",
    };

  patch.uncachedTotalTokens = uncachedTotalTokens;
  return cachedInputTokens > inputTokens
    ? {
        patch,
        warning:
          "cachedInputTokens exceeds inputTokens; clamped the displayed cumulative usage",
      }
    : { patch };
}
