import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import CluePaper, { PAPER_LAYOUTS } from "./CluePaper";

function EnvelopeDrawing() {
  const shadow = useId();
  return (
    <svg viewBox="0 0 270 140" aria-hidden="true">
      <defs>
        <filter id={shadow} x="-10%" y="-10%" width="120%" height="140%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <rect width="270" height="140" rx="3" fill="var(--env)" />
      <path d="M3 0 H267 L141 80 Q135 84 129 80 Z" fill="var(--inside)" />
      <path d="M2 139 L129 66 Q135 62 141 66 L268 139 Z" fill="var(--low)" />
      <path
        d="M2 139 L129 66 Q135 62 141 66 L268 139"
        fill="none"
        stroke="var(--gold)"
        strokeWidth=".9"
        strokeOpacity=".85"
      />
      <g className="fc">
        <path
          d="M3 0 H267 L141 80 Q135 84 129 80 Z"
          fill="rgba(20,30,40,.4)"
          filter={`url(#${shadow})`}
          transform="translate(0 2.5)"
        />
        <path d="M3 0 H267 L141 80 Q135 84 129 80 Z" fill="var(--flap)" />
        <path
          d="M3 1 L129 80 Q135 84 141 80 L267 1"
          fill="none"
          stroke="var(--gold)"
          strokeWidth=".9"
          strokeOpacity=".85"
        />
      </g>
      <g className="fo">
        <path d="M3 1 L129 -78 Q135 -82 141 -78 L267 1 Z" fill="var(--flap)" />
        <path
          d="M3 1 L129 -78 Q135 -82 141 -78 L267 1"
          fill="none"
          stroke="var(--gold)"
          strokeWidth=".9"
          strokeOpacity=".85"
        />
      </g>
    </svg>
  );
}

const slots = [
  [-88, -100, 0],
  [-104, -106, -3],
  [-72, -110, 2.5],
];
const hidden = [-88, -112, 0];
const transform = ([x, y, r]: number[]) =>
  `translate(${x}px,${y}px) rotate(${r}deg)`;

export default function ClueEnvelope({
  scale,
  ready,
  onOpen,
  onChoose,
}: {
  scale: number;
  ready: boolean;
  onOpen: () => void;
  onChoose: (layout: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [order, setOrder] = useState(PAPER_LAYOUTS.map((_, index) => index));
  const [drag, setDrag] = useState<number | null>(null);
  const [fly, setFly] = useState<"left" | "right" | null>(null);
  const pointer = useRef<{
    x: number;
    y: number;
    dx: number;
    dy: number;
    front: boolean;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  const createdAt = useRef(new Date().toISOString());
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      cancelAnimationFrame(frame.current);
    },
    [],
  );
  const close = (chosen?: number) => {
    setShow(false);
    timer.current = setTimeout(() => {
      setOpen(false);
      if (chosen !== undefined) onChoose(chosen);
    }, 260);
  };
  const toggle = () => {
    if (open) {
      close();
      return;
    }
    onOpen();
    setOrder(PAPER_LAYOUTS.map((_, index) => index));
    setDrag(null);
    setFly(null);
    setOpen(true);
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => setShow(true));
    });
  };
  const swipe = (direction: number) => {
    setDrag(null);
    if (direction > 0) {
      setFly("left");
      timer.current = setTimeout(() => {
        setOrder((list) => [...list.slice(1), list[0]]);
        setFly(null);
      }, 200);
    } else {
      setFly("right");
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() => {
          setOrder((list) => [list.at(-1)!, ...list.slice(0, -1)]);
          setFly(null);
        });
      });
    }
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (fly) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const paper = (event.target as Element).closest<HTMLElement>(".pp");
    pointer.current = {
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      dy: 0,
      front: paper?.dataset.layout === String(order[0]),
    };
  };
  const move = (event: PointerEvent) => {
    const start = pointer.current;
    if (!start) return;
    start.dx = event.clientX - start.x;
    start.dy = event.clientY - start.y;
    if (Math.abs(start.dx) > 4 && Math.abs(start.dx) > Math.abs(start.dy))
      setDrag(start.dx / scale);
  };
  const up = (cancelled = false) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start) return;
    setDrag(null);
    if (cancelled) return;
    if (Math.abs(start.dx) > 40 && Math.abs(start.dx) > Math.abs(start.dy)) {
      swipe(start.dx < 0 ? 1 : -1);
      return;
    }
    if (Math.hypot(start.dx, start.dy) < 6)
      close(start.front ? order[0] : undefined);
  };

  return (
    <>
      <div
        className={`envc${show ? " open" : ""}`}
        role="button"
        tabIndex={ready ? 0 : -1}
        aria-label="新增卡片"
        aria-disabled={!ready}
        onClick={() => ready && toggle()}
        onKeyDown={(event) => {
          if (ready && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <EnvelopeDrawing />
        <div className="elab">
          <i>NEW CARD</i>
          <b>新增卡片</b>
        </div>
      </div>
      {open && (
        <div
          className={`ov on${show ? " show" : ""}`}
          role="dialog"
          aria-label="選擇紙片"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => up()}
          onPointerCancel={() => up(true)}
        >
          <div className="dim" />
          <div className="stage">
            {PAPER_LAYOUTS.map((layout, index) => {
              const position = order.indexOf(index);
              let slot = show ? (slots[position] ?? hidden) : hidden;
              let opacity = show && position < 3 ? 1 : 0;
              let zIndex = 8 - position;
              const style: CSSProperties = {};
              if (position === 0 && drag !== null)
                slot = [-88 + drag, -100 - Math.abs(drag) * 0.04, drag / 22];
              if (fly === "left" && position === 0) {
                slot = [-328, -108, -10];
                opacity = 0.9;
              }
              if (fly === "right" && position === 7) {
                slot = [152, -108, 10];
                opacity = 1;
                zIndex = 9;
                style.transition = "none";
              }
              return (
                <div
                  key={index}
                  className={`pp${position === 0 && drag !== null ? " drag" : ""}${fly === "left" && position === 0 ? " fly" : ""}`}
                  data-layout={index}
                  aria-label={layout.cn}
                  role="button"
                  tabIndex={position === 0 ? 0 : -1}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") swipe(1);
                    else if (event.key === "ArrowRight") swipe(-1);
                    else if (event.key === "Enter") close(index);
                  }}
                  style={{
                    ...style,
                    transform: transform(slot),
                    opacity,
                    zIndex,
                  }}
                >
                  <CluePaper
                    width={176}
                    height={185}
                    preview
                    card={{
                      title: "標題",
                      content: "写在这里的内容，会照着这张纸的版式排。",
                      mode: "pinned",
                      when: "",
                      layout: index,
                      createdAt: createdAt.current,
                    }}
                  />
                </div>
              );
            })}
            <div className="pick">
              <div className="t">
                <b>{PAPER_LAYOUTS[order[0]].cn}</b>
                <i>{PAPER_LAYOUTS[order[0]].en}</i>
              </div>
              <em>左右滑換一張　點一下貼到牆上</em>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
