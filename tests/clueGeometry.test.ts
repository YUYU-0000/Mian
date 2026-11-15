import assert from "node:assert/strict";
import test from "node:test";
import {
  attachPin,
  fitItem,
  pinPosition,
  withoutCard,
  withoutPin,
} from "../client/src/pages/clues/clueGeometry.ts";
import type { ClueWall } from "../client/src/clueTypes.ts";

const wall: ClueWall = {
  cards: [
    {
      id: "card",
      title: "卡片",
      content: "",
      when: "",
      mode: "pinned",
      scenes: [],
      layout: 0,
      order: 0,
      createdAt: "now",
      updatedAt: "now",
      x: 20,
      y: 100,
      w: 84,
      h: 88,
      r: 20,
    },
  ],
  portrait: { x: 160, y: 250, w: 104, h: 126, r: -4 },
  pins: [],
  threads: [],
};
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);

test("pins attach proportionally inside rotated cards and follow movement and resizing", () => {
  const pin = { id: "p", cardId: "card", x: 0.25, y: 0.1 };
  const [x, y] = pinPosition(wall, pin);
  const attached = attachPin(
    wall,
    ["portrait", "card"],
    { ...pin, cardId: null },
    x,
    y,
  );
  assert.equal(attached.cardId, "card");
  near(attached.x, 0.25);
  near(attached.y, 0.1);
  const moved = { ...wall, cards: [{ ...wall.cards[0], x: 60, y: 150 }] };
  const [mx, my] = pinPosition(moved, pin);
  near(mx - x, 40);
  near(my - y, 50);
  const resized = { ...wall, cards: [{ ...wall.cards[0], w: 168, h: 176 }] };
  const [rx, ry] = pinPosition(resized, pin);
  near(rx - 20, (x - 20) * 2);
  near(ry - 100, (y - 100) * 2);
  assert.equal(
    attachPin(wall, ["card", "portrait"], pin, 350, 600).cardId,
    null,
  );
});

test("rotated card bounds stay inside the screen and removal drops connected threads", () => {
  const fitted = fitItem({ x: -80, y: -30, w: 350, h: 120, r: 15 }, 320);
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([x, y]) =>
    pinPosition(
      { ...wall, portrait: fitted },
      { id: "corner", cardId: "portrait", x, y },
    ),
  );
  for (const [x, y] of corners) {
    assert.ok(x >= 5.99 && x <= 314.01);
    assert.ok(y >= 11.99);
  }
  const linked = {
    ...wall,
    pins: [
      { id: "a", cardId: "card", x: 0.5, y: 0.1 },
      { id: "b", cardId: "portrait", x: 0.5, y: 0.1 },
    ],
    threads: [{ from: "a", to: "b" }],
  };
  assert.deepEqual(withoutPin(linked, "a").threads, []);
  const removed = withoutCard(linked, "card");
  assert.deepEqual(removed.cards, []);
  assert.deepEqual(
    removed.pins.map((pin) => pin.id),
    ["b"],
  );
  assert.deepEqual(removed.threads, []);
});
