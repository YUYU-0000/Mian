import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import { createId } from "../../id";
import type { Clue, CluePin, ClueWall, WallRect } from "../../clueTypes";
import { PORTRAIT_ID, removePin } from "../../../../shared/clues.mjs";
import {
  attachPin,
  clamp,
  fitItem,
  rotate,
  wallItem,
} from "./clueGeometry";

type Gesture = {
  kind: "item" | "resize" | "rotate" | "pin" | "new-pin";
  id: string;
  x: number;
  y: number;
  original: WallRect | CluePin;
  moved: boolean;
  long: boolean;
  gone: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
type Props = {
  current: RefObject<ClueWall | null>;
  board: RefObject<HTMLDivElement | null>;
  root: RefObject<HTMLElement | null>;
  width: number;
  height: number;
  dockHeight: number;
  layers: string[];
  raise: (id: string) => void;
  update: (change: (wall: ClueWall) => ClueWall) => ClueWall;
  persist: () => Promise<unknown>;
  open: (card: Clue) => void;
  beforeStart: () => void;
};

export function useWallGestures({
  current,
  board,
  root,
  width,
  height,
  dockHeight,
  layers,
  raise,
  update,
  persist,
  open,
  beforeStart,
}: Props) {
  const gesture = useRef<Gesture | null>(null);
  const tapped = useRef<string | null>(null);
  const removalTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  useEffect(
    () => () => {
      clearTimeout(gesture.current?.timer);
      clearTimeout(removalTimer.current);
    },
    [],
  );
  const save = () => {
    void persist().catch(() => {});
  };
  const point = (event: PointerEvent) => {
    const rect = board.current!.getBoundingClientRect();
    return [
      clamp(event.clientX - rect.left, 8, width - 8),
      Math.max(12, event.clientY - rect.top),
    ];
  };
  const changeItem = (id: string, rect: WallRect) =>
    update((wall) =>
      id === PORTRAIT_ID
        ? { ...wall, portrait: rect }
        : {
            ...wall,
            cards: wall.cards.map((card) =>
              card.id === id
                ? { ...card, ...rect, updatedAt: new Date().toISOString() }
                : card,
            ),
          },
    );

  const start = (
    event: PointerEvent<HTMLElement>,
    kind: Gesture["kind"],
    id: string,
  ) => {
    beforeStart();
    event.stopPropagation();
    tapped.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    const wall = current.current!;
    const active: Gesture = {
      kind,
      id,
      x: event.clientX,
      y: event.clientY,
      original:
        kind === "pin"
          ? wall.pins.find((pin) => pin.id === id)!
          : kind === "new-pin"
            ? { id, cardId: null, x: 0, y: 0 }
            : { ...wallItem(wall, id) },
      moved: false,
      long: false,
      gone: false,
    };
    gesture.current = active;
    if (kind === "item" || kind === "resize" || kind === "rotate") raise(id);
    if (kind === "item")
      active.timer = setTimeout(() => {
        active.long = true;
        setEditing(id);
      }, 500);
    if (kind === "pin") {
      setPressed(id);
      active.timer = setTimeout(() => {
        active.gone = true;
        setPressed(null);
        setRemoving(id);
        removalTimer.current = setTimeout(() => {
          update((data) => removePin(data, id));
          setSelected((value) => (value === id ? null : value));
          setRemoving(null);
          save();
        }, 200);
      }, 1000);
    }
    if (kind === "new-pin") {
      const rect = root.current!.getBoundingClientRect();
      setGhost({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
  };

  const move = (event: PointerEvent) => {
    const active = gesture.current;
    if (!active || active.gone) return;
    const dx = event.clientX - active.x,
      dy = event.clientY - active.y;
    const threshold = active.kind === "pin" ? 6 : active.kind === "item" ? 10 : 4;
    if (!active.moved && Math.hypot(dx, dy) < threshold)
      return;
    active.moved = true;
    clearTimeout(active.timer);
    setPressed(null);
    if (active.kind === "item") {
      const rect = active.original as WallRect;
      changeItem(
        active.id,
        fitItem({ ...rect, x: rect.x + dx, y: rect.y + dy }, width),
      );
    } else if (active.kind === "resize") {
      const rect = active.original as WallRect;
      const [rx, ry] = rotate(dx, dy, -rect.r);
      changeItem(
        active.id,
        fitItem(
          {
            ...rect,
            w: clamp(Math.round(rect.w + rx), 56, width - 16),
            h: clamp(Math.round(rect.h + ry), 56, 360),
          },
          width,
        ),
      );
    } else if (active.kind === "rotate") {
      const rect = active.original as WallRect;
      const boardRect = board.current!.getBoundingClientRect();
      const cx = boardRect.left + rect.x + rect.w / 2;
      const cy = boardRect.top + rect.y + rect.h / 2;
      const startAngle = Math.atan2(active.y - cy, active.x - cx);
      const angle =
        (rect.r * Math.PI) / 180 +
        Math.atan2(event.clientY - cy, event.clientX - cx) -
        startAngle;
      const r = (Math.atan2(Math.sin(angle), Math.cos(angle)) * 180) / Math.PI;
      changeItem(active.id, { ...rect, r: Math.abs(r) <= 3 ? 0 : r });
    } else if (active.kind === "pin") {
      const [x, y] = point(event);
      update((wall) => ({
        ...wall,
        pins: wall.pins.map((pin) =>
          pin.id === active.id ? { ...pin, cardId: null, x, y } : pin,
        ),
      }));
    } else {
      const rect = root.current!.getBoundingClientRect();
      setGhost({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
  };

  const finish = (event: PointerEvent, cancelled = false) => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    clearTimeout(active.timer);
    setPressed(null);
    setGhost(null);
    if (active.gone) return;
    if (cancelled) {
      if (active.kind === "pin")
        update((wall) => ({
          ...wall,
          pins: wall.pins.map((pin) =>
            pin.id === active.id ? (active.original as CluePin) : pin,
          ),
        }));
      if (
        active.kind === "item" ||
        active.kind === "resize" ||
        active.kind === "rotate"
      )
        changeItem(active.id, active.original as WallRect);
      return;
    }
    if (active.kind === "new-pin") {
      const y = event.clientY - root.current!.getBoundingClientRect().top;
      if (y < 12 || y > height - dockHeight) return;
      const [x, by] = point(event);
      update((wall) => ({
        ...wall,
        pins: [
          ...wall.pins,
          attachPin(wall, layers, active.original as CluePin, x, by),
        ],
      }));
      save();
    } else if (active.kind === "pin") {
      if (active.moved) {
        const [x, y] = point(event);
        update((wall) => ({
          ...wall,
          pins: wall.pins.map((pin) =>
            pin.id === active.id ? attachPin(wall, layers, pin, x, y) : pin,
          ),
        }));
        save();
      } else if (selected && selected !== active.id) {
        update((wall) => {
          const threads = wall.threads.filter(
            (thread) =>
              !(
                (thread.from === selected && thread.to === active.id) ||
                (thread.to === selected && thread.from === active.id)
              ),
          );
          return {
            ...wall,
            threads:
              threads.length === wall.threads.length
                ? [...threads, { from: selected, to: active.id }]
                : threads,
          };
        });
        setSelected(null);
        save();
      } else setSelected(selected === active.id ? null : active.id);
    } else if (active.moved) save();
    else if (
      active.kind === "item" &&
      !active.long &&
      !editing &&
      active.id !== PORTRAIT_ID
    )
      open(current.current!.cards.find((card) => card.id === active.id)!);
  };

  return {
    editing,
    setEditing,
    selected,
    pressed,
    removing,
    ghost,
    start,
    move,
    finish,
    prepareClick: (id: string) => {
      tapped.current = id;
    },
    activate: (id: string) => {
      if (tapped.current !== id || editing || id === PORTRAIT_ID) return;
      tapped.current = null;
      open(current.current!.cards.find((card) => card.id === id)!);
    },
    newPin: (event: PointerEvent<HTMLElement>) =>
      start(event, "new-pin", createId()),
  };
}
