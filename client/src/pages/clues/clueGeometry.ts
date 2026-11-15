import type { CluePin, ClueWall, WallRect } from "../../clueTypes";
import { PORTRAIT_ID } from "../../../../shared/clues.mjs";

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function rotate(x: number, y: number, degrees: number) {
  const angle = (degrees * Math.PI) / 180;
  return [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ];
}

export function wallItem(wall: ClueWall, id: string): WallRect {
  return id === PORTRAIT_ID
    ? wall.portrait
    : wall.cards.find((card) => card.id === id)!;
}

export function pinPosition(wall: ClueWall, pin: CluePin) {
  if (pin.cardId === null) return [pin.x, pin.y];
  const rect = wallItem(wall, pin.cardId);
  const [x, y] = rotate((pin.x - 0.5) * rect.w, (pin.y - 0.5) * rect.h, rect.r);
  return [rect.x + rect.w / 2 + x, rect.y + rect.h / 2 + y];
}

function relativePosition(rect: WallRect, x: number, y: number) {
  const [dx, dy] = rotate(
    x - rect.x - rect.w / 2,
    y - rect.y - rect.h / 2,
    -rect.r,
  );
  return [dx / rect.w + 0.5, dy / rect.h + 0.5];
}

export function fitItem(rect: WallRect, width: number): WallRect {
  const angle = (rect.r * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle)),
    sin = Math.abs(Math.sin(angle));
  const scale = Math.min(1, (width - 12) / (rect.w * cos + rect.h * sin));
  const w = rect.w * scale,
    h = rect.h * scale;
  const dx = (w * cos + h * sin - w) / 2,
    dy = (h * cos + w * sin - h) / 2;
  return {
    ...rect,
    w,
    h,
    x: clamp(rect.x, 6 + dx, width - w - 6 - dx),
    y: Math.max(12 + dy, rect.y),
  };
}

export function attachPin(
  wall: ClueWall,
  layers: string[],
  pin: CluePin,
  x: number,
  y: number,
): CluePin {
  for (const id of [...layers].reverse()) {
    const [fx, fy] = relativePosition(wallItem(wall, id), x, y);
    if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)
      return { ...pin, cardId: id, x: fx, y: fy };
  }
  return { ...pin, cardId: null, x, y };
}

