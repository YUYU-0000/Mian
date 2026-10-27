import assert from "node:assert/strict";
import test from "node:test";
import { parseCumulativeTokenUsage } from "../server/src/tokenUsage.ts";

test("cumulative token usage excludes cached input exactly once", () => {
  assert.deepEqual(
    parseCumulativeTokenUsage({
      inputTokens: 18_100,
      cachedInputTokens: 17_400,
      outputTokens: 100,
      reasoningOutputTokens: 40,
      totalTokens: 18_200,
    }).patch,
    { totalTokens: 18_200, uncachedTotalTokens: 800 },
  );

  assert.deepEqual(
    parseCumulativeTokenUsage({
      inputTokens: 36_300,
      cachedInputTokens: 34_900,
      outputTokens: 190,
      reasoningOutputTokens: 80,
      totalTokens: 36_490,
    }).patch,
    { totalTokens: 36_490, uncachedTotalTokens: 1_590 },
  );
});

test("reasoning output is not added again and zero cache keeps input plus output", () => {
  assert.equal(
    parseCumulativeTokenUsage({
      inputTokens: 700,
      cachedInputTokens: 0,
      outputTokens: 100,
      reasoningOutputTokens: 75,
      totalTokens: 800,
    }).patch.uncachedTotalTokens,
    800,
  );
});

test("missing cumulative breakdown never fabricates the display value", () => {
  assert.deepEqual(
    parseCumulativeTokenUsage({ totalTokens: 92_883 }).patch,
    { totalTokens: 92_883 },
  );
  assert.deepEqual(parseCumulativeTokenUsage(null).patch, {});
});

test("an impossible cached input value is clamped and reported", () => {
  const parsed = parseCumulativeTokenUsage({
    inputTokens: 100,
    cachedInputTokens: 250,
    outputTokens: 20,
    reasoningOutputTokens: 10,
    totalTokens: 120,
  });

  assert.equal(parsed.patch.uncachedTotalTokens, 0);
  assert.match(parsed.warning ?? "", /cachedInputTokens exceeds inputTokens/);
});
