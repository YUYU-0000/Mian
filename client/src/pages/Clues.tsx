import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Clue } from "../clueTypes";
import { createId } from "../id";
import { notify } from "../components/Notify";
import CluePaper from "./clues/CluePaper";
import ClueEnvelope from "./clues/ClueEnvelope";
import ClueSheet from "./clues/ClueSheet";
import { useClueWall } from "./clues/useClueWall";
import { useWallGestures } from "./clues/useWallGestures";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  fitItem,
  pinPosition,
  PORTRAIT_ID,
  wallItem,
  withoutCard,
} from "./clues/clueGeometry";
import "./clues.css";

export default function Clues({ onBack }: { onBack: () => void }) {
  const root = useRef<HTMLElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 390, height: 844 });
  const [raised, setRaised] = useState<string[]>([]);
  const [card, setCard] = useState<Clue | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const { wall, current, update, persist } = useClueWall();
  const { width, height } = size;
  const closedScale = Math.min(0.8, (width - 128) / 270);
  const openScale = Math.min(1, (width - 40) / 214, (height - 80) / 262);
  const sheetWidth = Math.min(width - 28, 440, ((height - 56) * 3.2) / 4.2);
  const dockHeight = 140 * closedScale + 64;
  const ids = wall ? [PORTRAIT_ID, ...wall.cards.map((item) => item.id)] : [];
  const layers = [
    ...ids.filter((id) => !raised.includes(id)),
    ...raised.filter((id) => ids.includes(id)),
  ];
  const raise = (id: string) =>
    setRaised((list) => [...list.filter((item) => item !== id), id]);
  const gestures = useWallGestures({
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
    open: setCard,
  });

  useLayoutEffect(() => {
    const element = root.current!;
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const loaded = wall !== null;
  useLayoutEffect(() => {
    if (!loaded) return;
    update((data) => ({
      ...data,
      cards: data.cards.map((item) => ({ ...item, ...fitItem(item, width) })),
      portrait: fitItem(data.portrait, width),
    }));
  }, [width, loaded]);

  const choose = (layout: number) => {
    const now = new Date().toISOString();
    const data = current.current!;
    const next: Clue = {
      id: createId(),
      title: "標題",
      content: "",
      when: "",
      scenes: [],
      mode: "pinned",
      layout,
      order: Math.max(-1, ...data.cards.map((item) => item.order)) + 1,
      createdAt: now,
      updatedAt: now,
      ...fitItem(
        {
          x: 20 + Math.random() * (width - CARD_WIDTH - 40),
          y: scroll.current!.scrollTop + 150 + Math.random() * 120,
          w: CARD_WIDTH,
          h: CARD_HEIGHT,
          r: Math.round(Math.random() * 10 - 5),
        },
        width,
      ),
    };
    update((value) => ({ ...value, cards: [...value.cards, next] }));
    raise(next.id);
    setLanded(next.id);
    setCard(next);
    void persist().catch(() => {});
  };
  const saveCard = async (draft: Clue) => {
    const next = {
      ...current.current!,
      cards: current.current!.cards.map((item) =>
        item.id === draft.id ? draft : item,
      ),
    };
    await persist(next);
    update(() => next);
    notify.ok("線索已保存");
  };
  const tearCard = async (id: string) => {
    const next = withoutCard(current.current!, id);
    await persist(next);
    update(() => next);
  };
  const positions = wall
    ? new Map(wall.pins.map((pin) => [pin.id, pinPosition(wall, pin)]))
    : new Map<string, number[]>();
  const bottom = wall
    ? Math.max(
        wall.portrait.y + wall.portrait.h,
        ...wall.cards.map((item) => item.y + item.h),
        ...[...positions.values()].map((point) => point[1]),
      )
    : 0;
  const boardHeight = Math.max(height, bottom + dockHeight + 80);
  const style = {
    "--kc": closedScale.toFixed(3),
    "--k": openScale.toFixed(3),
    "--sy": `${height / 2 - 14 * openScale}px`,
    "--shw": `${sheetWidth}px`,
    "--shh": `${(sheetWidth * 4.2) / 3.2}px`,
  } as CSSProperties;

  return (
    <main
      className="clues-page"
      ref={root}
      style={style}
      onPointerMove={gestures.move}
      onPointerUp={(event) => gestures.finish(event)}
      onPointerCancel={(event) => gestures.finish(event, true)}
    >
      <div className="wall" ref={scroll}>
        <div
          className="board"
          ref={board}
          style={{ height: boardHeight }}
          onPointerDown={(event) => {
            if (!(event.target as Element).closest(".item,.pin"))
              gestures.setEditing(null);
          }}
        >
          <div className="items">
            {wall &&
              layers.map((id) => {
                const item = wallItem(wall, id),
                  portrait = id === PORTRAIT_ID;
                return (
                  <div
                    key={id}
                    className={`item ${portrait ? "portrait" : "card"}${gestures.editing === id ? " edit" : ""}${landed === id ? " land" : ""}`}
                    data-id={id}
                    role="button"
                    tabIndex={0}
                    aria-label={portrait ? "彼方肖像" : (item as Clue).title}
                    style={
                      {
                        left: item.x,
                        top: item.y,
                        width: item.w,
                        height: item.h,
                        transform: `rotate(${item.r}deg)`,
                        "--r": `${item.r}deg`,
                      } as CSSProperties
                    }
                    onPointerDown={(event) => gestures.start(event, "item", id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !portrait)
                        setCard(item as Clue);
                    }}
                    onAnimationEnd={() => {
                      if (landed === id) setLanded(null);
                    }}
                  >
                    <div className="in">
                      {portrait ? (
                        <>
                          <div className="ph" />
                          <div className="ft">
                            <span>彼方肖像</span>
                            <span>Mian</span>
                          </div>
                        </>
                      ) : (
                        <CluePaper
                          card={item as Clue}
                          width={item.w}
                          height={item.h}
                        />
                      )}
                    </div>
                    <div
                      className="handle"
                      aria-label="調整大小"
                      onPointerDown={(event) =>
                        gestures.start(event, "resize", id)
                      }
                    />
                  </div>
                );
              })}
          </div>
          <svg className="threads" aria-hidden="true">
            {wall?.threads.map((thread) => {
              const a = positions.get(thread.from)!,
                b = positions.get(thread.to)!;
              const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
              const mx = (a[0] + b[0]) / 2,
                my = (a[1] + b[1]) / 2 + Math.min(12, length * 0.035);
              return (
                <g key={`${thread.from}:${thread.to}`}>
                  <path
                    d={`M${a[0]} ${a[1]} Q${mx} ${my} ${b[0]} ${b[1]}`}
                    fill="none"
                    stroke="var(--thread)"
                    strokeWidth="1"
                  />
                  <path
                    d={`M${a[0] + 0.7} ${a[1] + 0.5} Q${mx + 0.7} ${my + 0.8} ${b[0] + 0.7} ${b[1] + 0.5}`}
                    fill="none"
                    stroke="var(--thread)"
                    strokeWidth=".6"
                    strokeOpacity=".55"
                  />
                </g>
              );
            })}
          </svg>
          <div className="pins">
            {wall?.pins.map((pin) => {
              const [x, y] = positions.get(pin.id)!;
              return (
                <div
                  key={pin.id}
                  data-pin={pin.id}
                  className={`pin${gestures.selected === pin.id ? " sel" : ""}${gestures.pressed === pin.id ? " press" : ""}${gestures.removing === pin.id ? " out" : ""}`}
                  style={{ left: x, top: y }}
                  role="button"
                  aria-label="圖釘"
                  onPointerDown={(event) =>
                    gestures.start(event, "pin", pin.id)
                  }
                >
                  <svg aria-hidden="true">
                    <circle className="ring" cx="12" cy="12" r="8.5" />
                    <circle className="prog" cx="12" cy="12" r="7.6" />
                  </svg>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="head">
        <div
          className="back-btn clues-back"
          onClick={onBack}
          role="button"
          tabIndex={0}
          aria-label="返回主界面"
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onBack();
            }
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M10 4L2 12L10 20"
              stroke="var(--icon-bg-4)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="9" cy="12" r="1.4" fill="var(--icon-bg-4)" />
            <path
              d="M18 8.5L13.5 12L18 15.5"
              stroke="var(--icon-bg-4)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="right-decor">
          <div className="archive-en">CLUE WALL</div>
          <div className="decor-line" />
          <div className="archive-cn">線索</div>
        </div>
      </div>
      <div className="halo h-back" />
      <div className="halo h-title" />
      <div className="dock">
        <div className="halo h-env" />
        <div className="tray">
          <div className="st-lr">
            <div className="st-tb">
              <div className="st-t">
                Pins<small>圖釘</small>
              </div>
              <div className="st-l">by yuyu</div>
              <div
                className="tp"
                role="button"
                aria-label="拖出圖釘"
                onPointerDown={(event) => {
                  if (wall) gestures.newPin(event);
                }}
              />
              <div className="st-r">for mian</div>
              <div className="st-b">tie them with thread</div>
            </div>
          </div>
        </div>
      </div>
      <ClueEnvelope
        scale={openScale}
        ready={loaded}
        onOpen={() => gestures.setEditing(null)}
        onChoose={choose}
      />
      {gestures.ghost && (
        <div
          className="ghost"
          style={{ left: gestures.ghost.x, top: gestures.ghost.y }}
        />
      )}
      {card && (
        <ClueSheet
          key={card.id}
          card={card}
          onSave={saveCard}
          onTear={tearCard}
          onClose={() => setCard(null)}
        />
      )}
    </main>
  );
}
