import assert from "node:assert/strict";
import test from "node:test";
import { createId } from "../client/src/id.ts";

test("createId works when crypto.randomUUID is unavailable", () => {
  const original = globalThis.crypto;
  let seed = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(bytes: Uint8Array) {
        for (let index = 0; index < bytes.length; index += 1)
          bytes[index] = seed + index + 1;
        seed += 1;
        return bytes;
      },
    },
  });
  try {
    const first = createId();
    const second = createId();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(first, second);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  }
});

test("createId has a non-throwing final fallback", () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: undefined,
  });
  try {
    const first = createId();
    const second = createId();
    assert.match(first, /^local-/);
    assert.notEqual(first, second);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  }
});
